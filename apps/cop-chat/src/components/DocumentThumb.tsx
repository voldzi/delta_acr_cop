import clsx from "clsx";
import { AttachmentKindIcon, attachmentKindTitle, inferChatAttachmentPreviewKind } from "./AttachmentPreview";

export function DocumentThumb({ contentType, fileName, large = false }: { contentType?: string; fileName: string; large?: boolean }) {
  const dotIndex = fileName.lastIndexOf(".");
  const extension = dotIndex > 0 && dotIndex < fileName.length - 1
    ? fileName.slice(dotIndex + 1, dotIndex + 5).toUpperCase()
    : "FILE";
  const kind = inferChatAttachmentPreviewKind(fileName, contentType);
  return (
    <span className={clsx("document-thumb", `is-${kind}`, large && "large")} title={attachmentKindTitle(kind)}>
      <AttachmentKindIcon kind={kind} size={large ? 38 : 22} />
      <small>{extension}</small>
    </span>
  );
}
