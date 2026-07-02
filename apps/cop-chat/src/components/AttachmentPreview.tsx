import React from "react";
import {
  AlertCircle,
  Download,
  ExternalLink,
  FileAudio,
  FileText,
  Loader2
} from "lucide-react";
import type { MatrixLocationShare } from "@cop/messaging/types";
import {
  AttachmentKindIcon,
  attachmentKindTitle,
  type ChatAttachmentPreviewKind,
  fileExtension,
  inferChatAttachmentPreviewKind
} from "./AttachmentKind";
import { ChatPdfViewer } from "./ChatPdfViewer";

export { AttachmentKindIcon, attachmentKindTitle, inferChatAttachmentPreviewKind } from "./AttachmentKind";
export type { ChatAttachmentPreviewKind } from "./AttachmentKind";

type PreviewBase = {
  contentType?: string;
  downloadName?: string;
  sourceUrl?: string;
  title: string;
  truncated?: boolean;
};

export type ChatAttachmentPreviewDescriptor =
  | (PreviewBase & { kind: "pdf"; sourceBlob?: Blob; sourceUrl: string })
  | (PreviewBase & { kind: "image"; sourceUrl: string })
  | (PreviewBase & { kind: "video"; sourceUrl: string })
  | (PreviewBase & { kind: "audio"; sourceUrl: string })
  | (PreviewBase & { kind: "text" | "markdown" | "json" | "xml" | "html"; content: string; language?: string })
  | (PreviewBase & { kind: "csv"; headers?: string[]; rows: string[][] })
  | (PreviewBase & { kind: "docx"; paragraphs: Array<{ index: number; text: string }> })
  | (PreviewBase & { kind: "spreadsheet"; sheets: Array<{ name: string; rows: string[][]; truncated?: boolean }> })
  | (PreviewBase & { kind: "presentation"; slides: Array<{ slideNumber: number; title?: string; text: string[] }> })
  | (PreviewBase & { kind: "archi"; model: ChatArchiPreviewModel })
  | (PreviewBase & { kind: "archive"; files: Array<{ name: string; size?: number }> })
  | (PreviewBase & { kind: "unsupported"; reason: string });

export interface ChatArchiPreviewModel {
  elements: Array<{ id: string; name: string; type: string }>;
  relationships: Array<{ id: string; name?: string; sourceId?: string; targetId?: string; type: string }>;
  views: Array<{ id: string; name: string; type?: string }>;
}

export interface ChatMediaPreviewItem {
  byteSizeLabel?: string;
  caption?: string;
  contentType?: string;
  downloadName?: string;
  kind: "document" | "file" | "image" | "location" | "video";
  loadBlob?: () => Promise<Blob>;
  location?: MatrixLocationShare;
  posterUrl?: string;
  title: string;
  url?: string;
}

export interface ResolvedAttachmentPreview {
  blob?: Blob;
  objectUrl?: string;
  url?: string;
}

const maxStructuredPreviewBytes = 25 * 1024 * 1024;
const maxTextPreviewBytes = 1_500_000;
const maxRows = 40;
const maxColumns = 14;

export async function createChatAttachmentPreviewDescriptor({
  blob,
  contentType,
  fileName,
  sourceUrl
}: {
  blob?: Blob;
  contentType?: string;
  fileName: string;
  sourceUrl?: string;
}): Promise<ChatAttachmentPreviewDescriptor> {
  const kind = inferChatAttachmentPreviewKind(fileName, contentType);
  const base = {
    contentType,
    downloadName: fileName,
    ...(sourceUrl ? { sourceUrl } : {}),
    title: fileName
  };
  const legacyOfficeFormat = legacyOfficePreviewFormat(fileName, contentType);

  if (legacyOfficeFormat) {
    return unsupportedDescriptor(base, `${legacyOfficeFormat} je starší binární Office formát. V chatu jej lze stáhnout; plný náhled vyžaduje serverovou konverzi.`);
  }

  if ((kind === "pdf" || kind === "image" || kind === "video" || kind === "audio") && sourceUrl) {
    return {
      ...base,
      kind,
      ...(kind === "pdf" && blob ? { sourceBlob: blob } : {}),
      sourceUrl
    };
  }

  if (!blob) {
    return unsupportedDescriptor(base, "Náhled bude dostupný po stažení přílohy.");
  }

  if (blob.size > maxStructuredPreviewBytes && !["text", "markdown", "json", "xml", "html", "csv"].includes(kind)) {
    return unsupportedDescriptor(base, "Soubor je pro bezpečný náhled v prohlížeči příliš velký. Lze jej stáhnout.");
  }

  try {
    if (kind === "text" || kind === "markdown" || kind === "json" || kind === "xml" || kind === "html") {
      const content = await readBlobText(blob, maxTextPreviewBytes);
      return { ...base, content, kind, language: kind, truncated: blob.size > maxTextPreviewBytes };
    }
    if (kind === "csv") {
      const content = await readBlobText(blob, maxTextPreviewBytes);
      const rows = parseCsv(content).slice(0, maxRows);
      const [headers, ...bodyRows] = rows;
      return { ...base, headers, kind, rows: bodyRows, truncated: rows.length >= maxRows || blob.size > maxTextPreviewBytes };
    }
    if (kind === "docx") {
      return { ...base, kind, paragraphs: await extractDocxParagraphs(blob) };
    }
    if (kind === "spreadsheet") {
      return { ...base, kind, sheets: await extractXlsxSheets(blob) };
    }
    if (kind === "presentation") {
      return { ...base, kind, slides: await extractPptxSlides(blob) };
    }
    if (kind === "archi") {
      return { ...base, kind, model: await extractArchiModel(blob) };
    }
    if (kind === "archive") {
      return { ...base, kind, files: await extractArchiveFiles(blob) };
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Náhled se nepodařilo připravit.";
    return unsupportedDescriptor(base, reason);
  }

  return unsupportedDescriptor(base, "Tento typ přílohy zatím nelze zobrazit přímo v chatu.");
}

export function ChatAttachmentPreview({
  descriptor,
  error,
  loading,
  onDownload
}: {
  descriptor: ChatAttachmentPreviewDescriptor | null;
  error?: string | null;
  loading: boolean;
  onDownload?: () => void;
}) {
  if (loading) {
    return (
      <div className="chat-doc-preview state">
        <Loader2 className="spin" size={24} />
        <strong>Připravuji náhled</strong>
        <small>Soubor se bezpečně načítá ze šifrovaného chatu.</small>
      </div>
    );
  }

  if (error) {
    return (
      <div className="chat-doc-preview state error">
        <AlertCircle size={24} />
        <strong>Náhled nelze zobrazit</strong>
        <small>{error}</small>
      </div>
    );
  }

  if (!descriptor) {
    return (
      <div className="chat-doc-preview state">
        <FileText size={24} />
        <strong>Soubor</strong>
        <small>Náhled není připravený.</small>
      </div>
    );
  }

  if (descriptor.kind === "pdf") {
    return <PdfPreview descriptor={descriptor} onDownload={onDownload} />;
  }
  if (descriptor.kind === "image") {
    return <img alt={descriptor.title} src={descriptor.sourceUrl} />;
  }
  if (descriptor.kind === "video") {
    return <video controls playsInline src={descriptor.sourceUrl} />;
  }
  if (descriptor.kind === "audio") {
    return (
      <div className="chat-doc-preview state">
        <FileAudio size={32} />
        <strong>{descriptor.title}</strong>
        <audio controls src={descriptor.sourceUrl} />
      </div>
    );
  }

  return (
    <section className={`chat-doc-preview is-${descriptor.kind}`}>
      <PreviewHeader descriptor={descriptor} onDownload={onDownload} />
      <div className="chat-doc-preview__body">{renderDescriptorBody(descriptor)}</div>
    </section>
  );
}

function PdfPreview({ descriptor, onDownload }: { descriptor: Extract<ChatAttachmentPreviewDescriptor, { kind: "pdf" }>; onDownload?: () => void }) {
  return (
    <section className="chat-doc-preview is-pdf">
      <PreviewHeader descriptor={descriptor} onDownload={onDownload} />
      <ChatPdfViewer fileName={descriptor.title} onDownload={onDownload} sourceBlob={descriptor.sourceBlob} sourceUrl={descriptor.sourceUrl} />
    </section>
  );
}

function PreviewHeader({ descriptor, onDownload }: { descriptor: ChatAttachmentPreviewDescriptor; onDownload?: () => void }) {
  return (
    <header className="chat-doc-preview__header">
      <span className="chat-doc-preview__icon">
        <AttachmentKindIcon kind={descriptor.kind} />
      </span>
      <span>
        <strong>{descriptor.title}</strong>
        <small>{attachmentKindTitle(descriptor.kind)}{descriptor.contentType ? ` · ${descriptor.contentType}` : ""}</small>
      </span>
      <span className="chat-doc-preview__actions">
        {descriptor.sourceUrl ? (
          <button onClick={() => window.open(descriptor.sourceUrl, "_blank", "noopener,noreferrer")} type="button" aria-label="Otevřít v nové záložce">
            <ExternalLink size={16} />
          </button>
        ) : null}
        {onDownload ? (
          <button onClick={onDownload} type="button" aria-label="Stáhnout">
            <Download size={16} />
          </button>
        ) : null}
      </span>
    </header>
  );
}

function renderDescriptorBody(descriptor: ChatAttachmentPreviewDescriptor): React.ReactNode {
  switch (descriptor.kind) {
    case "text":
    case "markdown":
    case "json":
    case "xml":
    case "html":
      return <pre className={`chat-doc-preview__text is-${descriptor.kind}`}>{descriptor.content || "Soubor neobsahuje zobrazitelný text."}</pre>;
    case "csv":
      return <TablePreview headers={descriptor.headers} rows={descriptor.rows} />;
    case "docx":
      return descriptor.paragraphs.length ? (
        <div className="chat-doc-preview__paragraphs">
          {descriptor.paragraphs.map((paragraph) => (
            <article key={`${paragraph.index}-${paragraph.text.slice(0, 32)}`}>
              <span>{paragraph.index}</span>
              <p>{paragraph.text}</p>
            </article>
          ))}
        </div>
      ) : <EmptyPreview />;
    case "spreadsheet":
      return descriptor.sheets.length ? (
        <div className="chat-doc-preview__sheets">
          {descriptor.sheets.map((sheet) => (
            <section key={sheet.name}>
              <h3>{sheet.name}</h3>
              <TablePreview rows={sheet.rows} />
              {sheet.truncated ? <small>List je zkrácený pro rychlý náhled.</small> : null}
            </section>
          ))}
        </div>
      ) : <EmptyPreview />;
    case "presentation":
      return descriptor.slides.length ? (
        <div className="chat-doc-preview__slides">
          {descriptor.slides.map((slide) => (
            <section key={slide.slideNumber}>
              <span>Slide {slide.slideNumber}</span>
              <h3>{slide.title ?? slide.text[0] ?? "Prezentace"}</h3>
              <ul>{slide.text.slice(slide.title ? 0 : 1).map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ul>
            </section>
          ))}
        </div>
      ) : <EmptyPreview />;
    case "archi":
      return <ArchiPreview model={descriptor.model} />;
    case "archive":
      return (
        <div className="chat-doc-preview__archive">
          {descriptor.files.map((file) => (
            <span key={file.name}>
              <FileText size={16} />
              <strong>{file.name}</strong>
              {file.size !== undefined ? <small>{formatPreviewBytes(file.size)}</small> : null}
            </span>
          ))}
        </div>
      );
    case "unsupported":
      return (
        <div className="chat-doc-preview__unsupported">
          <AlertCircle size={28} />
          <strong>{descriptor.reason}</strong>
          <small>{descriptor.contentType ?? "Neznámý typ souboru"}</small>
        </div>
      );
    default:
      return <EmptyPreview />;
  }
}

function TablePreview({ headers, rows }: { headers?: string[]; rows: string[][] }) {
  if (!rows.length && !headers?.length) return <EmptyPreview />;
  return (
    <div className="chat-doc-preview__table-wrap">
      <table className="chat-doc-preview__table">
        {headers?.length ? <thead><tr>{headers.map((cell, index) => <th key={`${index}-${cell}`}>{cell}</th>)}</tr></thead> : null}
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ArchiPreview({ model }: { model: ChatArchiPreviewModel }) {
  return (
    <div className="chat-doc-preview__archi">
      <div className="chat-doc-preview__stats">
        <PreviewStat label="Prvky" value={model.elements.length} />
        <PreviewStat label="Vazby" value={model.relationships.length} />
        <PreviewStat label="Pohledy" value={model.views.length} />
      </div>
      {model.relationships.length ? (
        <section className="chat-doc-preview__archi-map">
          <h3>Mapa modelu</h3>
          {model.relationships.slice(0, 12).map((relationship) => (
            <article key={relationship.id}>
              <span>{elementName(model, relationship.sourceId)}</span>
              <strong>{relationship.name || relationship.type}</strong>
              <span>{elementName(model, relationship.targetId)}</span>
            </article>
          ))}
        </section>
      ) : null}
      <section className="chat-doc-preview__archi-list">
        {model.elements.slice(0, 30).map((element) => (
          <article key={element.id}>
            <strong>{element.name}</strong>
            <small>{element.type} · {element.id}</small>
          </article>
        ))}
      </section>
    </div>
  );
}

function PreviewStat({ label, value }: { label: string; value: number }) {
  return (
    <span>
      <strong>{value}</strong>
      <small>{label}</small>
    </span>
  );
}

function EmptyPreview() {
  return <div className="chat-doc-preview__empty">Náhled neobsahuje žádný zobrazitelný obsah.</div>;
}

function unsupportedDescriptor(base: PreviewBase, reason: string): ChatAttachmentPreviewDescriptor {
  return {
    ...base,
    kind: "unsupported",
    reason
  };
}

function legacyOfficePreviewFormat(fileName: string, contentType?: string): string | null {
  const ext = fileExtension(fileName);
  const mime = (contentType ?? "").toLowerCase();
  if (["docx", "docm", "xlsx", "xlsm", "pptx", "pptm"].includes(ext)) return null;
  if (["doc", "dot"].includes(ext)) return "Word";
  if (["xls", "xlt"].includes(ext)) return "Excel";
  if (["ppt", "pps", "pot"].includes(ext)) return "PowerPoint";
  if (!ext && mime.includes("msword")) return "Word";
  if (!ext && mime.includes("ms-excel")) return "Excel";
  if (!ext && mime.includes("powerpoint")) return "PowerPoint";
  return null;
}

async function readBlobText(blob: Blob, maxBytes = maxTextPreviewBytes): Promise<string> {
  const chunk = blob.size > maxBytes ? blob.slice(0, maxBytes, blob.type) : blob;
  return chunk.text();
}

async function loadZip(blob: Blob) {
  const { default: JSZip } = await import("jszip");
  return JSZip.loadAsync(blob);
}

async function extractDocxParagraphs(blob: Blob): Promise<Array<{ index: number; text: string }>> {
  const zip = await loadZip(blob);
  const xml = await zip.file("word/document.xml")?.async("text");
  if (!xml) throw new Error("Word dokument neobsahuje hlavní text.");
  const doc = parseXml(xml);
  return elementsByLocalName(doc, "p")
    .map((paragraph, index) => ({
      index: index + 1,
      text: elementsByLocalName(paragraph, "t").map((node) => node.textContent ?? "").join("")
    }))
    .map((paragraph) => ({ ...paragraph, text: paragraph.text.replace(/\s+/g, " ").trim() }))
    .filter((paragraph) => paragraph.text.length > 0)
    .slice(0, 80);
}

async function extractPptxSlides(blob: Blob): Promise<Array<{ slideNumber: number; title?: string; text: string[] }>> {
  const zip = await loadZip(blob);
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name))
    .sort((left, right) => slideNumberFromPath(left) - slideNumberFromPath(right))
    .slice(0, 20);
  const slides = await Promise.all(slideNames.map(async (name) => {
    const xml = await zip.file(name)?.async("text");
    const text = xml ? elementsByLocalName(parseXml(xml), "t").map((node) => node.textContent?.trim() ?? "").filter(Boolean) : [];
    const [title, ...rest] = text;
    return {
      slideNumber: slideNumberFromPath(name),
      ...(title ? { title } : {}),
      text: rest.length ? rest : text
    };
  }));
  return slides.filter((slide) => slide.text.length || slide.title);
}

async function extractXlsxSheets(blob: Blob): Promise<Array<{ name: string; rows: string[][]; truncated?: boolean }>> {
  const zip = await loadZip(blob);
  const sharedStrings = await readSharedStrings(zip);
  const sheetNames = await readWorkbookSheetNames(zip);
  const sheetPaths = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(name))
    .sort((left, right) => sheetNumberFromPath(left) - sheetNumberFromPath(right))
    .slice(0, 6);

  const sheets = await Promise.all(sheetPaths.map(async (path, index) => {
    const xml = await zip.file(path)?.async("text");
    if (!xml) return { name: sheetNames[index] ?? `List ${index + 1}`, rows: [] };
    const doc = parseXml(xml);
    const rows = elementsByLocalName(doc, "row").slice(0, maxRows).map((row) => sheetRowValues(row, sharedStrings));
    return {
      name: sheetNames[index] ?? `List ${index + 1}`,
      rows: rows.filter((row) => row.some((cell) => cell.trim().length > 0)),
      truncated: elementsByLocalName(doc, "row").length > maxRows
    };
  }));
  return sheets.filter((sheet) => sheet.rows.length > 0);
}

async function extractArchiveFiles(blob: Blob): Promise<Array<{ name: string; size?: number }>> {
  const zip = await loadZip(blob);
  return Object.values(zip.files)
    .filter((file) => !file.dir)
    .slice(0, 80)
    .map((file) => ({ name: file.name }));
}

async function extractArchiModel(blob: Blob): Promise<ChatArchiPreviewModel> {
  const text = await readPossibleXmlFromBlob(blob);
  const doc = parseXml(text);
  const elements = elementsByLocalName(doc, "element")
    .map((node) => ({
      id: node.getAttribute("identifier") ?? node.getAttribute("id") ?? "",
      name: childText(node, "name") || node.getAttribute("name") || "Prvek",
      type: simplifyType(node.getAttribute("xsi:type") ?? node.getAttribute("type") ?? node.localName)
    }))
    .filter((element) => element.id || element.name)
    .slice(0, 200);
  const relationships = elementsByLocalName(doc, "relationship")
    .map((node, index) => ({
      id: node.getAttribute("identifier") ?? node.getAttribute("id") ?? `relationship-${index + 1}`,
      name: childText(node, "name") || node.getAttribute("name") || undefined,
      sourceId: node.getAttribute("source") ?? node.getAttribute("sourceId") ?? undefined,
      targetId: node.getAttribute("target") ?? node.getAttribute("targetId") ?? undefined,
      type: simplifyType(node.getAttribute("xsi:type") ?? node.getAttribute("type") ?? node.localName)
    }))
    .slice(0, 200);
  const views = elementsByLocalName(doc, "view")
    .map((node, index) => ({
      id: node.getAttribute("identifier") ?? node.getAttribute("id") ?? `view-${index + 1}`,
      name: childText(node, "name") || node.getAttribute("name") || "Pohled",
      type: simplifyType(node.getAttribute("xsi:type") ?? node.getAttribute("type") ?? node.localName)
    }))
    .slice(0, 80);
  return { elements, relationships, views };
}

async function readPossibleXmlFromBlob(blob: Blob): Promise<string> {
  const text = await readBlobText(blob, maxTextPreviewBytes);
  if (text.trimStart().startsWith("<")) {
    return text;
  }
  const zip = await loadZip(blob);
  const candidate = Object.keys(zip.files).find((name) => /\.(archimate|xml)$/iu.test(name) && !zip.files[name]?.dir);
  const xml = candidate ? await zip.file(candidate)?.async("text") : undefined;
  if (!xml) throw new Error("ArchiMate model neobsahuje čitelný XML obsah.");
  return xml;
}

async function readSharedStrings(zip: Awaited<ReturnType<typeof loadZip>>): Promise<string[]> {
  const xml = await zip.file("xl/sharedStrings.xml")?.async("text");
  if (!xml) return [];
  return elementsByLocalName(parseXml(xml), "si").map((node) => elementsByLocalName(node, "t").map((part) => part.textContent ?? "").join(""));
}

async function readWorkbookSheetNames(zip: Awaited<ReturnType<typeof loadZip>>): Promise<string[]> {
  const xml = await zip.file("xl/workbook.xml")?.async("text");
  if (!xml) return [];
  return elementsByLocalName(parseXml(xml), "sheet").map((node) => node.getAttribute("name") ?? "").filter(Boolean);
}

function sheetRowValues(row: Element, sharedStrings: string[]): string[] {
  const values: string[] = [];
  elementsByLocalName(row, "c").slice(0, maxColumns).forEach((cell) => {
    const ref = cell.getAttribute("r");
    const columnIndex = ref ? columnIndexFromCellRef(ref) : values.length;
    while (values.length < columnIndex) values.push("");
    values[columnIndex] = cellValue(cell, sharedStrings);
  });
  return values.slice(0, maxColumns);
}

function cellValue(cell: Element, sharedStrings: string[]): string {
  const type = cell.getAttribute("t");
  if (type === "inlineStr") {
    return elementsByLocalName(cell, "t").map((node) => node.textContent ?? "").join("");
  }
  const value = childText(cell, "v");
  if (type === "s") {
    const index = Number.parseInt(value, 10);
    return Number.isFinite(index) ? sharedStrings[index] ?? "" : "";
  }
  return value;
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      cell += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((values) => values.some((value) => value.length > 0));
}

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Soubor neobsahuje platné XML pro náhled.");
  }
  return doc;
}

function elementsByLocalName(root: ParentNode, localName: string): Element[] {
  return Array.from(root.querySelectorAll("*")).filter((node): node is Element => node.localName === localName);
}

function childText(root: ParentNode, localName: string): string {
  return elementsByLocalName(root, localName).map((node) => node.textContent ?? "").join("").trim();
}

function slideNumberFromPath(path: string): number {
  return Number.parseInt(path.match(/slide(\d+)\.xml$/u)?.[1] ?? "0", 10);
}

function sheetNumberFromPath(path: string): number {
  return Number.parseInt(path.match(/sheet(\d+)\.xml$/u)?.[1] ?? "0", 10);
}

function columnIndexFromCellRef(ref: string): number {
  const letters = ref.match(/^[A-Z]+/iu)?.[0]?.toUpperCase() ?? "";
  return Math.max(0, letters.split("").reduce((acc, letter) => acc * 26 + letter.charCodeAt(0) - 64, 0) - 1);
}

function simplifyType(type: string): string {
  return type.replace(/^.*:/u, "").replace(/([a-z])([A-Z])/gu, "$1 $2").trim();
}

function elementName(model: ChatArchiPreviewModel, id?: string): string {
  if (!id) return "neuvedeno";
  return model.elements.find((element) => element.id === id)?.name ?? id;
}

function formatPreviewBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount >= 10 || unit === 0 ? Math.round(amount) : amount.toFixed(1)} ${units[unit]}`;
}
