import { ZipReader } from "@zip.js/zip.js/lib/zip-core-reader.js";
import { SaxesParser, type SaxesTagNS } from "saxes";
import { extractText, getDocumentProxy } from "unpdf";

export type DocumentFormat = "text" | "pdf" | "docx" | "xlsx" | "pptx";

export type DocumentExtractionInput = {
  bytes: Uint8Array;
  name: string;
  mediaType: string;
};

export type DocumentExtractionResult = {
  format: DocumentFormat;
  text: string;
};

const MAX_OUTPUT_CHARS = 200_000;
const MAX_PDF_PAGES = 200;
const MAX_PDF_OBJECTS = 10_000;
const MAX_ZIP_ENTRIES = 512;
const MAX_ZIP_EXPANDED_BYTES = 32 * 1024 * 1024;
const MAX_ZIP_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_ZIP_RATIO = 100;
const MAX_XML_DEPTH = 64;
const MAX_XML_ELEMENTS = 100_000;
const MAX_XML_ATTRIBUTES = 200_000;
const MAX_XML_ATTRIBUTES_PER_ELEMENT = 128;
const MAX_SHEET_ROWS = 100_000;
const MAX_SHEET_CELLS = 50_000;
const MAX_PRESENTATION_SLIDES = 500;
const PARSE_DEADLINE_MS = 5_000;

const OOXML_MIME: Record<Exclude<DocumentFormat, "text" | "pdf">, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const OOXML_PACKAGE: Record<Exclude<DocumentFormat, "text" | "pdf">, {
  mainPart: string;
  mainContentType: string;
}> = {
  docx: {
    mainPart: "word/document.xml",
    mainContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  },
  xlsx: {
    mainPart: "xl/workbook.xml",
    mainContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  },
  pptx: {
    mainPart: "ppt/presentation.xml",
    mainContentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
  },
};

const OOXML_OFFICE_DOCUMENT_RELATIONSHIP =
  "http://schemas.openxmlformats.org/officedocument/2006/relationships/officedocument";
const OOXML_SAFE_RELATIONSHIP_PREFIXES = [
  "http://schemas.openxmlformats.org/officedocument/2006/relationships/",
  "http://schemas.openxmlformats.org/package/2006/relationships/metadata/",
] as const;

const PDF_FORBIDDEN_NAMES = new Set([
  "aa",
  "acroform",
  "embeddedfile",
  "embeddedfiles",
  "encrypt",
  "filespec",
  "javascript",
  "js",
  "launch",
  "openaction",
  "objstm",
  "richmedia",
  "submitform",
  "xfa",
]);

export class DocumentIngestError extends Error {
  readonly name = "DocumentIngestError";

  constructor(
    readonly code: string,
    readonly transient = false,
  ) {
    super(code);
  }
}

export async function extractDocumentText(input: DocumentExtractionInput): Promise<DocumentExtractionResult> {
  const startedAt = Date.now();
  const bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array();
  if (!bytes.byteLength) throw permanent("document_empty");
  const format = classifyDocument(input.name, input.mediaType, bytes);
  let text: string;
  if (format === "text") text = extractUtf8Text(bytes);
  else if (format === "pdf") text = await extractPdfText(bytes, startedAt);
  else text = await extractOoxmlText(bytes, format, startedAt);
  assertDeadline(startedAt);
  return { format, text: normalizeExtractedText(text) };
}

function classifyDocument(nameValue: unknown, mediaTypeValue: unknown, bytes: Uint8Array): DocumentFormat {
  const name = typeof nameValue === "string" ? nameValue.trim().toLowerCase() : "";
  const mediaType = typeof mediaTypeValue === "string"
    ? mediaTypeValue.split(";", 1)[0].trim().toLowerCase()
    : "";
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  if (extension === ".pdf") {
    if (mediaType && mediaType !== "application/pdf" && mediaType !== "application/octet-stream") {
      throw permanent("document_type_mismatch");
    }
    if (!startsWithAscii(bytes, "%PDF-")) throw permanent("pdf_invalid_magic");
    return "pdf";
  }
  for (const format of ["docx", "xlsx", "pptx"] as const) {
    if (extension !== `.${format}`) continue;
    if (mediaType && mediaType !== OOXML_MIME[format] && mediaType !== "application/octet-stream") {
      throw permanent("document_type_mismatch");
    }
    if (!hasZipMagic(bytes)) throw permanent("ooxml_invalid_magic");
    return format;
  }
  if ([".txt", ".md", ".csv", ".json", ".xml"].includes(extension)) {
    if (
      mediaType
      && mediaType !== "application/octet-stream"
      && mediaType !== "application/json"
      && mediaType !== "application/xml"
      && !mediaType.startsWith("text/")
    ) throw permanent("document_type_mismatch");
    return "text";
  }
  throw permanent("document_type_unsupported");
}

function extractUtf8Text(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes).replace(/^\uFEFF/u, "");
  } catch {
    throw permanent("text_invalid_utf8");
  }
}

async function extractPdfText(bytes: Uint8Array, startedAt: number): Promise<string> {
  const source = new TextDecoder("latin1").decode(bytes);
  let objectCount = 0;
  for (const _match of source.matchAll(/\b\d+\s+\d+\s+obj\b/gu)) {
    objectCount += 1;
    if (objectCount > MAX_PDF_OBJECTS) throw permanent("pdf_object_limit");
  }
  for (const match of source.matchAll(/\/((?:#[0-9A-Fa-f]{2}|[A-Za-z])+)/gu)) {
    const decoded = match[1].replace(/#([0-9A-Fa-f]{2})/gu, (_value, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
    const normalized = decoded.toLowerCase();
    if (normalized === "encrypt") throw permanent("pdf_encrypted");
    if (PDF_FORBIDDEN_NAMES.has(normalized)) throw permanent("pdf_active_content");
  }
  assertDeadline(startedAt);

  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  try {
    pdf = await getDocumentProxy(bytes, {
      isEvalSupported: false,
      useSystemFonts: false,
      maxImageSize: 16_777_216,
      disableStream: true,
      disableRange: true,
    } as never);
    if (pdf.numPages < 1 || pdf.numPages > MAX_PDF_PAGES) throw permanent("pdf_page_limit");
    const [hasJavaScript, actions, attachments, openAction] = await Promise.all([
      pdf.hasJSActions(),
      pdf.getJSActions(),
      pdf.getAttachments(),
      pdf.getOpenAction(),
    ]);
    if (
      hasJavaScript
      || hasEntries(actions)
      || hasEntries(attachments)
      || openAction !== null
    ) throw permanent("pdf_active_content");
    assertDeadline(startedAt);
    const result = await extractText(pdf, { mergePages: true });
    if (result.text.length > MAX_OUTPUT_CHARS) throw permanent("document_output_limit");
    return result.text;
  } catch (error) {
    if (error instanceof DocumentIngestError) throw error;
    const name = error instanceof Error ? error.name : "";
    if (name === "PasswordException") throw permanent("pdf_encrypted");
    throw permanent("pdf_malformed");
  } finally {
    const destroyable = pdf as (typeof pdf & { destroy?: () => Promise<void> }) | undefined;
    await destroyable?.destroy?.().catch(() => undefined);
  }
}

async function extractOoxmlText(
  bytes: Uint8Array,
  format: Exclude<DocumentFormat, "text" | "pdf">,
  startedAt: number,
): Promise<string> {
  const reader = new ZipReader(new ByteArrayReader(bytes) as never, {
    checkOverlappingEntry: true,
    checkOverlappingEntryOnly: false,
  });
  const xmlParts = new Map<string, string>();
  const names = new Set<string>();
  const fileNames = new Set<string>();
  let declaredExpanded = 0;
  let actualExpanded = 0;
  let entryCount = 0;
  try {
    for await (const entry of reader.getEntriesGenerator()) {
      assertDeadline(startedAt);
      entryCount += 1;
      if (entryCount > MAX_ZIP_ENTRIES) throw permanent("ooxml_entry_limit");
      const name = normalizeZipEntryName(entry.filename);
      const nameKey = name.toLowerCase();
      if (names.has(nameKey)) throw permanent("ooxml_duplicate_entry");
      names.add(nameKey);
      if (entry.directory) continue;
      fileNames.add(nameKey);
      if (entry.encrypted) throw permanent("ooxml_encrypted");
      if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
        throw permanent("ooxml_compression_unsupported");
      }
      if (isForbiddenOoxmlEntry(nameKey)) throw permanent("ooxml_active_content");
      if (isNestedArchiveName(nameKey)) throw permanent("ooxml_nested_archive");
      if (entry.uncompressedSize > MAX_ZIP_ENTRY_BYTES) throw permanent("ooxml_entry_size_limit");
      declaredExpanded += entry.uncompressedSize;
      if (declaredExpanded > MAX_ZIP_EXPANDED_BYTES) throw permanent("ooxml_expanded_size_limit");
      if (
        entry.uncompressedSize > 0
        && (entry.compressedSize <= 0 || entry.uncompressedSize / entry.compressedSize > MAX_ZIP_RATIO)
      ) throw permanent("ooxml_compression_ratio_limit");

      const captureXml = nameKey.endsWith(".xml") || nameKey.endsWith(".rels");
      const chunks: Uint8Array[] = [];
      const magic: number[] = [];
      let entryBytes = 0;
      const writable = new WritableStream<Uint8Array>({
        write(chunk) {
          const value = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
          entryBytes += value.byteLength;
          actualExpanded += value.byteLength;
          if (entryBytes > MAX_ZIP_ENTRY_BYTES || actualExpanded > MAX_ZIP_EXPANDED_BYTES) {
            throw permanent("ooxml_expanded_size_limit");
          }
          for (const byte of value) {
            if (magic.length >= 4) break;
            magic.push(byte);
          }
          if (captureXml) chunks.push(value.slice());
        },
      });
      await entry.getData(writable as never, {
        checkSignature: true,
        checkOverlappingEntry: true,
        useCompressionStream: true,
        useWebWorkers: false,
      });
      if (magic[0] === 0x50 && magic[1] === 0x4b && (magic[2] === 0x03 || magic[2] === 0x05 || magic[2] === 0x07)) {
        throw permanent("ooxml_nested_archive");
      }
      if (captureXml) {
        const content = decodeXmlBytes(concatBytes(chunks, entryBytes));
        validateXmlSecurity(content, startedAt);
        xmlParts.set(nameKey, content);
      }
    }
  } catch (error) {
    if (error instanceof DocumentIngestError) throw error;
    throw permanent("ooxml_malformed");
  } finally {
    await reader.close().catch(() => undefined);
  }

  validateOoxmlPackage(xmlParts, fileNames, format, startedAt);
  requireOoxmlParts(xmlParts, format);
  if (format === "docx") return extractWordText(xmlParts.get("word/document.xml")!, startedAt);
  if (format === "pptx") return extractPresentationText(xmlParts, startedAt);
  return extractWorkbookText(xmlParts, startedAt);
}

class ByteArrayReader {
  readonly size: number;

  constructor(private readonly bytes: Uint8Array) {
    this.size = bytes.byteLength;
  }

  async readUint8Array(index: number, length: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(index) || !Number.isSafeInteger(length) || index < 0 || length < 0) {
      throw permanent("ooxml_malformed");
    }
    return this.bytes.slice(index, index + length);
  }

  createReadable(options: { offset?: number; size?: number; chunkSize?: number } = {}): ReadableStream<Uint8Array> {
    const reader = this;
    const offset = options.offset ?? 0;
    const size = options.size ?? this.size - offset;
    const chunkSize = options.chunkSize ?? 64 * 1024;
    let position = 0;
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (position >= size) {
          controller.close();
          return;
        }
        const length = Math.min(chunkSize, size - position);
        controller.enqueue(await reader.readUint8Array(offset + position, length));
        position += length;
        if (position >= size) controller.close();
      },
    });
  }
}

function validateXmlSecurity(xml: string, startedAt: number): void {
  parseXml(xml, startedAt, {
    open(tag) {
      if (tag.local.toLowerCase() !== "relationship") return;
      const targetMode = attribute(tag, "TargetMode").toLowerCase();
      const type = attribute(tag, "Type").toLowerCase();
      const target = attribute(tag, "Target").toLowerCase();
      if (targetMode === "external") throw permanent("ooxml_external_relationship");
      if (/oleobject|package|attachedtemplate|vbaproject|activex/u.test(`${type} ${target}`)) {
        throw permanent("ooxml_active_content");
      }
    },
  });
}

function validateOoxmlPackage(
  xmlParts: Map<string, string>,
  fileNames: Set<string>,
  format: Exclude<DocumentFormat, "text" | "pdf">,
  startedAt: number,
): void {
  const contract = OOXML_PACKAGE[format];
  const contentTypes = xmlParts.get("[content_types].xml");
  const rootRelationships = xmlParts.get("_rels/.rels");
  if (!contentTypes || !rootRelationships || !fileNames.has(contract.mainPart)) {
    throw permanent("ooxml_required_part_missing");
  }

  let mainContentTypeCount = 0;
  parseXml(contentTypes, startedAt, {
    open(tag) {
      if (tag.local !== "Default" && tag.local !== "Override") return;
      const contentType = attribute(tag, "ContentType").trim().toLowerCase();
      if (!contentType) throw permanent("ooxml_content_type_invalid");
      if (isForbiddenOoxmlContentType(contentType)) throw permanent("ooxml_active_content");
      if (tag.local !== "Override") return;
      const partName = normalizeOoxmlPartName(attribute(tag, "PartName"));
      if (partName !== contract.mainPart) return;
      mainContentTypeCount += 1;
      if (contentType !== contract.mainContentType) throw permanent("ooxml_package_mismatch");
    },
  });
  if (mainContentTypeCount !== 1) throw permanent("ooxml_package_mismatch");

  let mainRelationshipCount = 0;
  for (const [name, xml] of xmlParts) {
    if (!name.endsWith(".rels")) continue;
    const base = ooxmlRelationshipBase(name);
    parseXml(xml, startedAt, {
      open(tag) {
        if (tag.local.toLowerCase() !== "relationship") return;
        const targetMode = attribute(tag, "TargetMode").trim().toLowerCase();
        const type = attribute(tag, "Type").trim().toLowerCase();
        const target = attribute(tag, "Target");
        if (targetMode === "external") throw permanent("ooxml_external_relationship");
        if (!type || !OOXML_SAFE_RELATIONSHIP_PREFIXES.some((prefix) => type.startsWith(prefix))) {
          throw permanent("ooxml_relationship_invalid");
        }
        if (/oleobject|package|attachedtemplate|vbaproject|activex|customui/u.test(type)) {
          throw permanent("ooxml_active_content");
        }
        const resolvedTarget = resolveOoxmlRelationshipTarget(base, target);
        if (!fileNames.has(resolvedTarget)) throw permanent("ooxml_relationship_invalid");
        if (name !== "_rels/.rels" || type !== OOXML_OFFICE_DOCUMENT_RELATIONSHIP) return;
        mainRelationshipCount += 1;
        if (resolvedTarget !== contract.mainPart) throw permanent("ooxml_package_mismatch");
      },
    });
  }
  if (mainRelationshipCount !== 1) throw permanent("ooxml_package_mismatch");
}

function isForbiddenOoxmlContentType(value: string): boolean {
  return /macroenabled|vbaproject|activex|oleobject|\.package(?:\+|$)|vnd\.ms-office/u.test(value);
}

function normalizeOoxmlPartName(value: string): string {
  const normalized = value.startsWith("/") ? value.slice(1) : value;
  return normalizeZipEntryName(normalized).toLowerCase();
}

function ooxmlRelationshipBase(name: string): string {
  if (name === "_rels/.rels") return "";
  const marker = "/_rels/";
  const markerIndex = name.lastIndexOf(marker);
  if (markerIndex >= 0 && name.endsWith(".rels")) return name.slice(0, markerIndex);
  if (name.startsWith("_rels/") && name.endsWith(".rels")) return "";
  throw permanent("ooxml_relationship_invalid");
}

function resolveOoxmlRelationshipTarget(base: string, value: string): string {
  if (!value || value.includes("\\") || value.includes("\0") || /[?#]/u.test(value)) {
    throw permanent("ooxml_relationship_invalid");
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw permanent("ooxml_relationship_invalid");
  }
  const segments = decoded.startsWith("/") ? [] : base.split("/").filter(Boolean);
  for (const segment of decoded.replace(/^\/+/, "").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) throw permanent("ooxml_relationship_invalid");
      segments.pop();
      continue;
    }
    if (segment.length > 255 || /[\u0000-\u001f\u007f]/u.test(segment)) {
      throw permanent("ooxml_relationship_invalid");
    }
    segments.push(segment);
  }
  if (!segments.length) throw permanent("ooxml_relationship_invalid");
  return segments.join("/").normalize("NFC").toLowerCase();
}

function extractWordText(xml: string, startedAt: number): string {
  const output: string[] = [];
  let capture = false;
  let current = "";
  parseXml(xml, startedAt, {
    open(tag) {
      if (tag.local === "t") {
        capture = true;
        current = "";
      } else if (tag.local === "tab") output.push("\t");
      else if (tag.local === "br" || tag.local === "cr") output.push("\n");
    },
    text(value) {
      if (capture) current += value;
    },
    close(tag) {
      if (tag.local === "t" && capture) {
        output.push(current);
        capture = false;
      } else if (tag.local === "p") output.push("\n");
    },
  });
  return boundedJoin(output);
}

function extractPresentationText(xmlParts: Map<string, string>, startedAt: number): string {
  const slides = [...xmlParts.entries()]
    .filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/u.test(name))
    .sort(([left], [right]) => naturalNameCompare(left, right));
  if (slides.length > MAX_PRESENTATION_SLIDES) throw permanent("pptx_slide_limit");
  const output: string[] = [];
  for (const [, xml] of slides) {
    let capture = false;
    let current = "";
    parseXml(xml, startedAt, {
      open(tag) {
        if (tag.local === "t") {
          capture = true;
          current = "";
        }
      },
      text(value) {
        if (capture) current += value;
      },
      close(tag) {
        if (tag.local === "t" && capture) {
          output.push(current);
          capture = false;
        } else if (tag.local === "p") output.push("\n");
      },
    });
  }
  return boundedJoin(output);
}

function extractWorkbookText(xmlParts: Map<string, string>, startedAt: number): string {
  const sharedStrings: string[] = [];
  const sharedXml = xmlParts.get("xl/sharedstrings.xml");
  if (sharedXml) {
    let inItem = false;
    let capture = false;
    let current = "";
    let item = "";
    parseXml(sharedXml, startedAt, {
      open(tag) {
        if (tag.local === "si") {
          inItem = true;
          item = "";
        } else if (inItem && tag.local === "t") {
          capture = true;
          current = "";
        }
      },
      text(value) {
        if (capture) current += value;
      },
      close(tag) {
        if (tag.local === "t" && capture) {
          item += current;
          capture = false;
        } else if (tag.local === "si" && inItem) {
          sharedStrings.push(item);
          inItem = false;
        }
      },
    });
  }

  const sheets = [...xmlParts.entries()]
    .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(name))
    .sort(([left], [right]) => naturalNameCompare(left, right));
  const output: string[] = [];
  let rowCount = 0;
  let cellCount = 0;
  for (const [name, xml] of sheets) {
    output.push(`[${name.slice(name.lastIndexOf("/") + 1, -4)}]\n`);
    let cell: { ref: string; type: string; value: string; inline: string } | undefined;
    let capture: "v" | "t" | undefined;
    parseXml(xml, startedAt, {
      open(tag) {
        if (tag.local === "row") {
          rowCount += 1;
          if (rowCount > MAX_SHEET_ROWS) throw permanent("xlsx_row_limit");
        } else if (tag.local === "c") {
          cellCount += 1;
          if (cellCount > MAX_SHEET_CELLS) throw permanent("xlsx_cell_limit");
          cell = { ref: attribute(tag, "r"), type: attribute(tag, "t"), value: "", inline: "" };
        } else if (cell && (tag.local === "v" || tag.local === "t")) capture = tag.local;
      },
      text(value) {
        if (!cell || !capture) return;
        if (capture === "v") cell.value += value;
        else cell.inline += value;
      },
      close(tag) {
        if (tag.local === capture) capture = undefined;
        if (tag.local !== "c" || !cell) return;
        const raw = cell.type === "inlineStr" ? cell.inline : cell.value;
        const value = cell.type === "s" ? sharedStrings[Number.parseInt(raw, 10)] || "" : raw;
        output.push(`${cell.ref || "cell"}\t${value}\n`);
        cell = undefined;
      },
    });
  }
  return boundedJoin(output);
}

type XmlHandlers = {
  open?: (tag: SaxesTagNS) => void;
  text?: (text: string) => void;
  close?: (tag: SaxesTagNS) => void;
};

function parseXml(xml: string, startedAt: number, handlers: XmlHandlers): void {
  if (/<!DOCTYPE/iu.test(xml)) throw permanent("xml_doctype_forbidden");
  let depth = 0;
  let elements = 0;
  let attributes = 0;
  const parser = new SaxesParser({ xmlns: true });
  parser.on("doctype", () => { throw permanent("xml_doctype_forbidden"); });
  parser.on("error", () => { throw permanent("xml_malformed"); });
  parser.on("opentag", (tag) => {
    const elementAttributes = Object.keys(tag.attributes).length;
    depth += 1;
    elements += 1;
    attributes += elementAttributes;
    if (depth > MAX_XML_DEPTH) throw permanent("xml_depth_limit");
    if (elementAttributes > MAX_XML_ATTRIBUTES_PER_ELEMENT) throw permanent("xml_attribute_limit");
    if (elements > MAX_XML_ELEMENTS || attributes > MAX_XML_ATTRIBUTES) throw permanent("xml_node_limit");
    if ((elements & 255) === 0) assertDeadline(startedAt);
    handlers.open?.(tag);
  });
  parser.on("text", (text) => handlers.text?.(text));
  parser.on("cdata", (text) => handlers.text?.(text));
  parser.on("closetag", (tag) => {
    handlers.close?.(tag);
    depth -= 1;
  });
  try {
    parser.write(xml).close();
  } catch (error) {
    if (error instanceof DocumentIngestError) throw error;
    throw permanent("xml_malformed");
  }
}

function requireOoxmlParts(
  xmlParts: Map<string, string>,
  format: Exclude<DocumentFormat, "text" | "pdf">,
): void {
  if (!xmlParts.has("[content_types].xml") || !xmlParts.has("_rels/.rels")) {
    throw permanent("ooxml_required_part_missing");
  }
  if (format === "docx" && !xmlParts.has("word/document.xml")) throw permanent("ooxml_required_part_missing");
  if (format === "xlsx") {
    if (!xmlParts.has("xl/workbook.xml") || ![...xmlParts.keys()].some((name) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(name))) {
      throw permanent("ooxml_required_part_missing");
    }
  }
  if (format === "pptx") {
    if (!xmlParts.has("ppt/presentation.xml") || ![...xmlParts.keys()].some((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name))) {
      throw permanent("ooxml_required_part_missing");
    }
  }
}

function normalizeZipEntryName(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 1_024 || value.includes("\\") || value.includes("\0")) {
    throw permanent("ooxml_path_invalid");
  }
  const normalized = value.replace(/^\.\//u, "");
  if (normalized.startsWith("/") || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw permanent("ooxml_path_invalid");
  }
  return normalized;
}

function isForbiddenOoxmlEntry(name: string): boolean {
  return name.endsWith(".bin")
    || name.includes("/activex/")
    || name.includes("/embeddings/")
    || name.includes("oleobject")
    || name.includes("vbaproject")
    || name.includes("customui/");
}

function isNestedArchiveName(name: string): boolean {
  return /\.(?:zip|7z|rar|gz|bz2|xz|docx|xlsx|pptx|docm|xlsm|pptm)$/u.test(name);
}

function decodeXmlBytes(bytes: Uint8Array): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes).replace(/^\uFEFF/u, "");
    const declaration = text.match(/^\s*<\?xml[^>]*encoding=["']([^"']+)["']/iu)?.[1]?.toLowerCase();
    if (declaration && declaration !== "utf-8" && declaration !== "utf8") throw permanent("xml_encoding_unsupported");
    return text;
  } catch (error) {
    if (error instanceof DocumentIngestError) throw error;
    throw permanent("xml_invalid_utf8");
  }
}

function attribute(tag: SaxesTagNS, localName: string): string {
  for (const value of Object.values(tag.attributes)) {
    if (typeof value !== "string" && value.local === localName) return value.value || "";
  }
  return "";
}

function concatBytes(chunks: Uint8Array[], total: number): Uint8Array {
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function normalizeExtractedText(value: string): string {
  const normalized = value
    .replace(/\r\n?/gu, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/gu, ""))
    .join("\n")
    .trim();
  if (normalized.length > MAX_OUTPUT_CHARS) throw permanent("document_output_limit");
  return normalized;
}

function boundedJoin(values: string[]): string {
  let chars = 0;
  for (const value of values) {
    chars += value.length;
    if (chars > MAX_OUTPUT_CHARS) throw permanent("document_output_limit");
  }
  return values.join("");
}

function naturalNameCompare(left: string, right: string): number {
  const leftDigits = left.match(/(\d+)\.xml$/u)?.[1];
  const rightDigits = right.match(/(\d+)\.xml$/u)?.[1];
  if (leftDigits && rightDigits) {
    const leftNumber = BigInt(leftDigits);
    const rightNumber = BigInt(rightDigits);
    if (leftNumber < rightNumber) return -1;
    if (leftNumber > rightNumber) return 1;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertDeadline(startedAt: number): void {
  if (Date.now() - startedAt > PARSE_DEADLINE_MS) throw new DocumentIngestError("document_parse_deadline", true);
}

function startsWithAscii(bytes: Uint8Array, value: string): boolean {
  return value.length <= bytes.length && [...value].every((char, index) => bytes[index] === char.charCodeAt(0));
}

function hasZipMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
    && (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08);
}

function hasEntries(value: unknown): boolean {
  if (value instanceof Map) return value.size > 0;
  return Boolean(value && typeof value === "object" && Object.keys(value).length > 0);
}

function permanent(code: string): DocumentIngestError {
  return new DocumentIngestError(code, false);
}
