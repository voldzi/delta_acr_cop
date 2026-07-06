import {
  AlertCircle,
  Archive,
  Braces,
  FileAudio,
  FileCode2,
  FileImage,
  FileText,
  FileVideo,
  Network,
  Presentation,
  Table2
} from "lucide-react";

export type ChatAttachmentPreviewKind =
  | "archi"
  | "archive"
  | "audio"
  | "csv"
  | "docx"
  | "html"
  | "image"
  | "json"
  | "markdown"
  | "pdf"
  | "presentation"
  | "spreadsheet"
  | "text"
  | "unsupported"
  | "video"
  | "xml";

type AttachmentFallbackKind = "document" | "file" | "image" | "location" | "video";

export function inferChatAttachmentPreviewKind(
  fileName: string,
  contentType?: string,
  fallbackKind?: AttachmentFallbackKind
): ChatAttachmentPreviewKind {
  const ext = fileExtension(fileName);
  const mime = (contentType ?? "").toLowerCase();
  if (fallbackKind === "image" || mime.startsWith("image/")) return "image";
  if (fallbackKind === "video" || mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.includes("pdf") || ext === "pdf") return "pdf";
  if (["docx", "docm", "doc", "dot"].includes(ext) || mime.includes("wordprocessingml") || mime.includes("msword"))
    return "docx";
  if (["xlsx", "xlsm", "xls", "xlt"].includes(ext) || mime.includes("spreadsheetml") || mime.includes("ms-excel"))
    return "spreadsheet";
  if (
    ["pptx", "pptm", "ppt", "pps", "pot"].includes(ext) ||
    mime.includes("presentationml") ||
    mime.includes("powerpoint")
  )
    return "presentation";
  if (["archimate", "archi"].includes(ext) || mime.includes("archimate")) return "archi";
  if (ext === "csv" || mime.includes("csv")) return "csv";
  if (ext === "json" || mime.includes("json")) return "json";
  if (ext === "xml" || mime.includes("xml")) return "xml";
  if (["html", "htm"].includes(ext) || mime.includes("html")) return "html";
  if (["md", "markdown"].includes(ext) || mime.includes("markdown")) return "markdown";
  if (mime.startsWith("text/") || ["log", "txt"].includes(ext)) return "text";
  if (["zip", "7z", "rar"].includes(ext) || mime.includes("zip") || mime.includes("archive")) return "archive";
  return "unsupported";
}

export function attachmentKindTitle(kind: ChatAttachmentPreviewKind): string {
  switch (kind) {
    case "archi":
      return "ArchiMate";
    case "archive":
      return "Archiv";
    case "audio":
      return "Audio";
    case "csv":
      return "CSV";
    case "docx":
      return "Word";
    case "html":
      return "HTML";
    case "image":
      return "Obrázek";
    case "json":
      return "JSON";
    case "markdown":
      return "Markdown";
    case "pdf":
      return "PDF";
    case "presentation":
      return "Prezentace";
    case "spreadsheet":
      return "Tabulka";
    case "text":
      return "Text";
    case "video":
      return "Video";
    case "xml":
      return "XML";
    default:
      return "Soubor";
  }
}

export function AttachmentKindIcon({ kind, size = 22 }: { kind: ChatAttachmentPreviewKind; size?: number }) {
  const Icon = attachmentIconComponent(kind);
  return <Icon size={size} aria-hidden="true" />;
}

export function fileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > -1
    ? fileName
        .slice(dotIndex + 1)
        .trim()
        .toLowerCase()
    : "";
}

function attachmentIconComponent(kind: ChatAttachmentPreviewKind) {
  if (kind === "spreadsheet" || kind === "csv") return Table2;
  if (kind === "presentation") return Presentation;
  if (kind === "archi") return Network;
  if (kind === "archive") return Archive;
  if (kind === "json") return Braces;
  if (kind === "xml" || kind === "html") return FileCode2;
  if (kind === "image") return FileImage;
  if (kind === "video") return FileVideo;
  if (kind === "audio") return FileAudio;
  if (kind === "unsupported") return AlertCircle;
  return FileText;
}
