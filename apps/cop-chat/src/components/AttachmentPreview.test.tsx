// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  createChatAttachmentPreviewDescriptor,
  inferChatAttachmentPreviewKind
} from "./AttachmentPreview";

describe("AttachmentPreview descriptor extraction", () => {
  it("detects common professional document formats", () => {
    expect(inferChatAttachmentPreviewKind("zprava.pdf", "application/pdf")).toBe("pdf");
    expect(inferChatAttachmentPreviewKind("plan.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("docx");
    expect(inferChatAttachmentPreviewKind("tabulka.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("spreadsheet");
    expect(inferChatAttachmentPreviewKind("brief.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation")).toBe("presentation");
    expect(inferChatAttachmentPreviewKind("model.archimate", "application/xml")).toBe("archi");
    expect(inferChatAttachmentPreviewKind("stary-plan.doc", "application/msword")).toBe("docx");
  });

  it("creates a CSV table preview", async () => {
    const descriptor = await createChatAttachmentPreviewDescriptor({
      blob: new Blob(["name,value\nA,1\nB,2"], { type: "text/csv" }),
      contentType: "text/csv",
      fileName: "data.csv"
    });

    expect(descriptor).toMatchObject({
      headers: ["name", "value"],
      kind: "csv",
      rows: [["A", "1"], ["B", "2"]]
    });
  });

  it("extracts Word paragraphs from DOCX", async () => {
    const blob = await zipBlob({
      "word/document.xml": `
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p><w:r><w:t>První odstavec</w:t></w:r></w:p>
            <w:p><w:r><w:t>Druhý odstavec</w:t></w:r></w:p>
          </w:body>
        </w:document>`
    });

    const descriptor = await createChatAttachmentPreviewDescriptor({
      blob,
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      fileName: "zapis.docx"
    });

    expect(descriptor).toMatchObject({
      kind: "docx",
      paragraphs: [
        { index: 1, text: "První odstavec" },
        { index: 2, text: "Druhý odstavec" }
      ]
    });
  });

  it("extracts spreadsheet rows from XLSX", async () => {
    const blob = await zipBlob({
      "xl/sharedStrings.xml": `
        <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
          <si><t>Název</t></si><si><t>Hodnota</t></si><si><t>Teplota</t></si>
        </sst>`,
      "xl/workbook.xml": `
        <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
          <sheets><sheet name="Měření" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets>
        </workbook>`,
      "xl/worksheets/sheet1.xml": `
        <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
          <sheetData>
            <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
            <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>31</v></c></row>
          </sheetData>
        </worksheet>`
    });

    const descriptor = await createChatAttachmentPreviewDescriptor({
      blob,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileName: "mereni.xlsx"
    });

    expect(descriptor).toMatchObject({
      kind: "spreadsheet",
      sheets: [{ name: "Měření", rows: [["Název", "Hodnota"], ["Teplota", "31"]] }]
    });
  });

  it("extracts slide text from PPTX", async () => {
    const blob = await zipBlob({
      "ppt/slides/slide1.xml": `
        <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Situace</a:t></a:r></a:p><a:p><a:r><a:t>Body zásahu</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
        </p:sld>`
    });

    const descriptor = await createChatAttachmentPreviewDescriptor({
      blob,
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      fileName: "brief.pptx"
    });

    expect(descriptor).toMatchObject({
      kind: "presentation",
      slides: [{ slideNumber: 1, title: "Situace", text: ["Body zásahu"] }]
    });
  });

  it("extracts ArchiMate model summary", async () => {
    const descriptor = await createChatAttachmentPreviewDescriptor({
      blob: new Blob([`
        <model xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
          <elements>
            <element identifier="e1" xsi:type="ApplicationComponent"><name>COP</name></element>
            <element identifier="e2" xsi:type="ApplicationService"><name>Chat</name></element>
          </elements>
          <relationships>
            <relationship identifier="r1" source="e1" target="e2" xsi:type="ServingRelationship"><name>poskytuje</name></relationship>
          </relationships>
          <views><view identifier="v1"><name>Architektura</name></view></views>
        </model>`], { type: "application/xml" }),
      contentType: "application/xml",
      fileName: "cop.archimate"
    });

    expect(descriptor).toMatchObject({
      kind: "archi",
      model: {
        elements: [
          { id: "e1", name: "COP", type: "Application Component" },
          { id: "e2", name: "Chat", type: "Application Service" }
        ],
        relationships: [{ id: "r1", name: "poskytuje", sourceId: "e1", targetId: "e2", type: "Serving Relationship" }],
        views: [{ id: "v1", name: "Architektura", type: "view" }]
      }
    });
  });

  it("shows a clear unsupported state for legacy binary Office formats", async () => {
    const descriptor = await createChatAttachmentPreviewDescriptor({
      blob: new Blob(["legacy-binary"], { type: "application/msword" }),
      contentType: "application/msword",
      fileName: "zapis.doc"
    });

    expect(descriptor).toMatchObject({
      kind: "unsupported",
      reason: expect.stringContaining("starší binární Office formát")
    });
  });
});

async function zipBlob(entries: Record<string, string>): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  Object.entries(entries).forEach(([path, content]) => zip.file(path, content));
  return zip.generateAsync({ type: "blob" });
}
