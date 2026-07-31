import { describe, expect, it } from "vitest";
import {
  extractDocumentText,
} from "../src/services/document-ingest";
import {
  documentEncoder as encoder,
  encryptedZipDocument as encryptedZip,
  minimalPdf,
  ooxmlContentTypes as contentTypes,
  ooxmlContentTypesFor,
  ooxmlPackageRelationships as packageRelationships,
  ooxmlPackageRelationshipsFor,
  zipDocument as zip,
} from "./document-fixtures";

function replaceAscii(bytes: Uint8Array, source: string, replacement: string): Uint8Array {
  expect(replacement).toHaveLength(source.length);
  const result = bytes.slice();
  const needle = encoder.encode(source);
  const value = encoder.encode(replacement);
  for (let index = 0; index <= result.length - needle.length; index += 1) {
    if (!needle.every((byte, offset) => result[index + offset] === byte)) continue;
    result.set(value, index);
    index += needle.length - 1;
  }
  return result;
}

describe("document parser", () => {
  it("extracts deterministic UTF-8 text", async () => {
    const result = await extractDocumentText({
      bytes: encoder.encode("alpha\r\nbeta\u0000gamma"),
      name: "notes.txt",
      mediaType: "text/plain",
    });
    expect(result).toEqual({ format: "text", text: "alpha\nbetagamma" });
  });

  it("extracts a conservatively gated PDF", async () => {
    const result = await extractDocumentText({
      bytes: minimalPdf("Hello PDF"),
      name: "report.pdf",
      mediaType: "application/pdf",
    });
    expect(result.format).toBe("pdf");
    expect(result.text).toContain("Hello PDF");
  });

  it("extracts DOCX, XLSX, and PPTX text", async () => {
    const docx = await zip({
      "[Content_Types].xml": contentTypes,
      "_rels/.rels": packageRelationships,
      "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello DOCX</w:t></w:r></w:p></w:body></w:document>`,
    });
    const xlsx = await zip({
      "[Content_Types].xml": ooxmlContentTypesFor("xlsx"),
      "_rels/.rels": ooxmlPackageRelationshipsFor("xlsx"),
      "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>`,
      "xl/sharedStrings.xml": `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Hello XLSX</t></si></sst>`,
      "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>`,
    });
    const pptx = await zip({
      "[Content_Types].xml": ooxmlContentTypesFor("pptx"),
      "_rels/.rels": ooxmlPackageRelationshipsFor("pptx"),
      "ppt/presentation.xml": `<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`,
      "ppt/slides/slide1.xml": `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Hello PPTX</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    });

    await expect(extractDocumentText({ bytes: docx, name: "sample.docx", mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }))
      .resolves.toMatchObject({ format: "docx", text: "Hello DOCX" });
    await expect(extractDocumentText({ bytes: xlsx, name: "sample.xlsx", mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }))
      .resolves.toMatchObject({ format: "xlsx", text: expect.stringContaining("Hello XLSX") });
    await expect(extractDocumentText({ bytes: pptx, name: "sample.pptx", mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }))
      .resolves.toMatchObject({ format: "pptx", text: "Hello PPTX" });
  });

  it.each([
    ["javascript", minimalPdf("unsafe", "/OpenAction << /S /JavaScript /JS (app.alert(1)) >>"), "unsafe.pdf", "application/pdf", "pdf_active_content"],
    ["launch", minimalPdf("unsafe", "/OpenAction << /S /Launch /F (calc.exe) >>"), "unsafe.pdf", "application/pdf", "pdf_active_content"],
    ["escaped launch", minimalPdf("unsafe", "/OpenAction << /S /Lau#6ech /F (calc.exe) >>"), "unsafe.pdf", "application/pdf", "pdf_active_content"],
    ["embedded", minimalPdf("unsafe", "/Names << /EmbeddedFiles 6 0 R >>"), "unsafe.pdf", "application/pdf", "pdf_active_content"],
    ["object stream", minimalPdf("unsafe", "/ObjStm 6 0 R"), "unsafe.pdf", "application/pdf", "pdf_active_content"],
    ["encrypted", minimalPdf("unsafe", "/Encrypt 6 0 R"), "unsafe.pdf", "application/pdf", "pdf_encrypted"],
  ])("permanently rejects PDF %s", async (_label, bytes, name, mediaType, code) => {
    await expect(extractDocumentText({ bytes, name, mediaType })).rejects.toMatchObject({
      name: "DocumentIngestError",
      code,
      transient: false,
    });
  });

  it.each([
    ["macro", { "[Content_Types].xml": contentTypes, "_rels/.rels": packageRelationships, "word/document.xml": "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"/>", "word/vbaProject.bin": "macro" }, "ooxml_active_content"],
    ["ActiveX", { "[Content_Types].xml": contentTypes, "_rels/.rels": packageRelationships, "word/document.xml": "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"/>", "word/activeX/activeX1.xml": "<activeX/>" }, "ooxml_active_content"],
    ["OLE object", { "[Content_Types].xml": contentTypes, "_rels/.rels": packageRelationships, "word/document.xml": "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"/>", "word/embeddings/oleObject1.bin": "ole" }, "ooxml_active_content"],
    ["embedded package", { "[Content_Types].xml": contentTypes, "_rels/.rels": packageRelationships, "word/document.xml": "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"/>", "word/embeddings/package1.dat": "package" }, "ooxml_active_content"],
    ["external relationship", { "[Content_Types].xml": contentTypes, "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" TargetMode="External" Target="https://example.test/"/></Relationships>`, "word/document.xml": "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"/>" }, "ooxml_external_relationship"],
    ["doctype", { "[Content_Types].xml": contentTypes, "_rels/.rels": packageRelationships, "word/document.xml": `<!DOCTYPE x [<!ENTITY boom "unsafe">]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:t>&boom;</w:t></w:document>` }, "xml_doctype_forbidden"],
    ["nested archive", { "[Content_Types].xml": contentTypes, "_rels/.rels": packageRelationships, "word/document.xml": "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"/>", "word/media/hidden.zip": "PK\\u0003\\u0004" }, "ooxml_nested_archive"],
  ])("permanently rejects OOXML %s", async (_label, entries, code) => {
    const bytes = await zip(entries);
    await expect(extractDocumentText({
      bytes,
      name: "unsafe.docx",
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    })).rejects.toMatchObject({ name: "DocumentIngestError", code, transient: false });
  });

  it("permanently rejects OOXML path traversal", async () => {
    const valid = await zip({
      "[Content_Types].xml": contentTypes,
      "_rels/.rels": packageRelationships,
      "word/document.xml": "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"/>",
    });
    const traversing = replaceAscii(valid, "word/document.xml", "../x/document.xml");
    await expect(extractDocumentText({
      bytes: traversing,
      name: "unsafe.docx",
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    })).rejects.toMatchObject({ code: "ooxml_path_invalid", transient: false });
  });

  it("requires a macro-free main content type and matching root relationship", async () => {
    const macroContentTypes = contentTypes.replace(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
      "application/vnd.ms-word.document.macroEnabled.main+xml",
    );
    const macroTyped = await zip({
      "[Content_Types].xml": macroContentTypes,
      "_rels/.rels": packageRelationships,
      "word/document.xml": "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"/>",
    });
    await expect(extractDocumentText({
      bytes: macroTyped,
      name: "unsafe.docx",
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    })).rejects.toMatchObject({ code: "ooxml_active_content", transient: false });

    const mismatchedRoot = await zip({
      "[Content_Types].xml": contentTypes,
      "_rels/.rels": ooxmlPackageRelationshipsFor("xlsx"),
      "word/document.xml": "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"/>",
      "xl/workbook.xml": "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"/>",
    });
    await expect(extractDocumentText({
      bytes: mismatchedRoot,
      name: "unsafe.docx",
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    })).rejects.toMatchObject({ code: "ooxml_package_mismatch", transient: false });
  });

  it("rejects unsafe internal relationship targets and per-element XML attribute amplification", async () => {
    const escapingRelationship = await zip({
      "[Content_Types].xml": contentTypes,
      "_rels/.rels": packageRelationships,
      "word/document.xml": "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"/>",
      "word/_rels/document.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../../outside.png"/></Relationships>`,
    });
    await expect(extractDocumentText({
      bytes: escapingRelationship,
      name: "unsafe.docx",
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    })).rejects.toMatchObject({ code: "ooxml_relationship_invalid", transient: false });

    const attributes = Array.from({ length: 129 }, (_value, index) => ` a${index}="x"`).join("");
    const attributeBomb = await zip({
      "[Content_Types].xml": contentTypes,
      "_rels/.rels": packageRelationships,
      "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"${attributes}/>`,
    });
    await expect(extractDocumentText({
      bytes: attributeBomb,
      name: "unsafe.docx",
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    })).rejects.toMatchObject({ code: "xml_attribute_limit", transient: false });
  });

  it("permanently rejects OOXML compression bombs", async () => {
    const bytes = await zip({
      "[Content_Types].xml": contentTypes,
      "_rels/.rels": packageRelationships,
      "word/document.xml": "A".repeat(100_000),
    });
    await expect(extractDocumentText({
      bytes,
      name: "unsafe.docx",
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    })).rejects.toMatchObject({ code: "ooxml_compression_ratio_limit", transient: false });
  });

  it("permanently rejects encrypted and corrupt OOXML", async () => {
    const entries = {
      "[Content_Types].xml": contentTypes,
      "_rels/.rels": packageRelationships,
      "word/document.xml": "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"/>",
    };
    const encrypted = await encryptedZip(entries);
    await expect(extractDocumentText({
      bytes: encrypted,
      name: "encrypted.docx",
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    })).rejects.toMatchObject({ code: "ooxml_encrypted", transient: false });

    const valid = await zip(entries);
    await expect(extractDocumentText({
      bytes: valid.slice(0, valid.length - 20),
      name: "corrupt.docx",
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    })).rejects.toMatchObject({ code: "ooxml_malformed", transient: false });
  });

  it("rejects mismatched and malformed input without downgrading", async () => {
    await expect(extractDocumentText({
      bytes: encoder.encode("not a pdf"),
      name: "fake.pdf",
      mediaType: "application/pdf",
    })).rejects.toMatchObject({ code: "pdf_invalid_magic", transient: false });
    await expect(extractDocumentText({
      bytes: encoder.encode("%PDF-1.4\nbroken\n%%EOF"),
      name: "corrupt.pdf",
      mediaType: "application/pdf",
    })).rejects.toMatchObject({ code: "pdf_malformed", transient: false });
    await expect(extractDocumentText({
      bytes: new Uint8Array([0xff, 0xfe, 0xfd]),
      name: "bad.txt",
      mediaType: "text/plain",
    })).rejects.toMatchObject({ code: "text_invalid_utf8", transient: false });
  });
});
