import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";

export const documentEncoder = new TextEncoder();

type OoxmlFixtureFormat = "docx" | "xlsx" | "pptx";

const ooxmlMainParts: Record<OoxmlFixtureFormat, { part: string; contentType: string }> = {
  docx: {
    part: "word/document.xml",
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  },
  xlsx: {
    part: "xl/workbook.xml",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  },
  pptx: {
    part: "ppt/presentation.xml",
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
  },
};

export function ooxmlContentTypesFor(format: OoxmlFixtureFormat): string {
  const main = ooxmlMainParts[format];
  return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/${main.part}" ContentType="${main.contentType}"/></Types>`;
}

export function ooxmlPackageRelationshipsFor(format: OoxmlFixtureFormat): string {
  const main = ooxmlMainParts[format];
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${main.part}"/></Relationships>`;
}

export const ooxmlContentTypes = ooxmlContentTypesFor("docx");
export const ooxmlPackageRelationships = ooxmlPackageRelationshipsFor("docx");

export async function zipDocument(entries: Record<string, string>): Promise<Uint8Array> {
  const writer = new ZipWriter(new BlobWriter("application/zip"), { useWebWorkers: false });
  for (const [name, content] of Object.entries(entries)) {
    await writer.add(name, new TextReader(content), { useWebWorkers: false, level: 6 });
  }
  return new Uint8Array(await (await writer.close()).arrayBuffer());
}

export async function encryptedZipDocument(entries: Record<string, string>): Promise<Uint8Array> {
  const writer = new ZipWriter(new BlobWriter("application/zip"), { useWebWorkers: false });
  for (const [name, content] of Object.entries(entries)) {
    await writer.add(name, new TextReader(content), {
      useWebWorkers: false,
      level: 6,
      password: "local-test-password",
    });
  }
  return new Uint8Array(await (await writer.close()).arrayBuffer());
}

export function minimalPdfSource(text: string, extraCatalog = ""): string {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R ${extraCatalog} >>`,
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(source.length);
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = source.length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  return `${source}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

export function minimalPdf(text: string, extraCatalog = ""): Uint8Array {
  return documentEncoder.encode(minimalPdfSource(text, extraCatalog));
}

export async function normalDocumentFixtures() {
  return [
    {
      name: "notes.txt",
      mediaType: "text/plain",
      bytes: documentEncoder.encode("Hello TXT"),
      expectedText: "Hello TXT",
    },
    {
      name: "report.pdf",
      mediaType: "application/pdf",
      bytes: minimalPdf("Hello PDF"),
      expectedText: "Hello PDF",
    },
    {
      name: "sample.docx",
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: await zipDocument({
        "[Content_Types].xml": ooxmlContentTypesFor("docx"),
        "_rels/.rels": ooxmlPackageRelationshipsFor("docx"),
        "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello DOCX</w:t></w:r></w:p></w:body></w:document>`,
      }),
      expectedText: "Hello DOCX",
    },
    {
      name: "sample.xlsx",
      mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: await zipDocument({
        "[Content_Types].xml": ooxmlContentTypesFor("xlsx"),
        "_rels/.rels": ooxmlPackageRelationshipsFor("xlsx"),
        "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>`,
        "xl/sharedStrings.xml": `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Hello XLSX</t></si></sst>`,
        "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>`,
      }),
      expectedText: "Hello XLSX",
    },
    {
      name: "sample.pptx",
      mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      bytes: await zipDocument({
        "[Content_Types].xml": ooxmlContentTypesFor("pptx"),
        "_rels/.rels": ooxmlPackageRelationshipsFor("pptx"),
        "ppt/presentation.xml": `<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`,
        "ppt/slides/slide1.xml": `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Hello PPTX</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
      }),
      expectedText: "Hello PPTX",
    },
  ];
}
