import clsx from "clsx";
import { FileText } from "lucide-react";

export function DocumentThumb({ fileName, large = false }: { fileName: string; large?: boolean }) {
  const dotIndex = fileName.lastIndexOf(".");
  const extension = dotIndex > 0 && dotIndex < fileName.length - 1
    ? fileName.slice(dotIndex + 1, dotIndex + 5).toUpperCase()
    : "FILE";
  return (
    <span className={clsx("document-thumb", large && "large")}>
      <FileText size={large ? 38 : 22} />
      <small>{extension}</small>
    </span>
  );
}
