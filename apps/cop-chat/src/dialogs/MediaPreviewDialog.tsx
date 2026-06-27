import clsx from "clsx";
import { MapPin, Video, X } from "lucide-react";
import type { MatrixLocationShare } from "@cop/messaging/types";
import { DocumentThumb } from "../components/DocumentThumb";
import { StaticLocationMap, centerLocationInCop, formatCoordinates } from "../components/LocationPreview";
import { useModalFocus } from "../hooks/useModalFocus";

export interface MediaPreviewItem {
  byteSizeLabel?: string;
  caption?: string;
  contentType?: string;
  kind: "document" | "file" | "image" | "location" | "video";
  location?: MatrixLocationShare;
  posterUrl?: string;
  title: string;
  url?: string;
}

export default function MediaPreviewDialog({ item, onClose }: { item: MediaPreviewItem; onClose: () => void }) {
  const modal = useModalFocus<HTMLElement>(onClose);
  return (
    <div className="preview-backdrop" onClick={onClose} role="presentation">
      <section
        ref={modal.dialogRef}
        className="preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Náhled ${item.title}`}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={modal.onDialogKeyDown}
      >
        <header>
          <span>
            <strong>{item.title}</strong>
            <small>{mediaKindLabel(item.kind)}</small>
          </span>
          <button className="round-icon" onClick={onClose} type="button" aria-label="Zavřít">
            <X size={20} />
          </button>
        </header>
        <div className={clsx("preview-stage", item.kind)}>
          {item.kind === "image" && item.url ? <img alt={item.title} src={item.url} /> : null}
          {item.kind === "video" && item.url ? <video controls src={item.url} /> : null}
          {item.kind === "video" && !item.url && item.posterUrl ? (
            <div className="preview-video-poster">
              <img alt={item.title} src={item.posterUrl} />
              <span><Video size={22} /> Demo náhled videa</span>
            </div>
          ) : null}
          {item.kind === "location" && item.location ? (
            <div className="large-map">
              <StaticLocationMap location={item.location} large />
              <div className="large-map-copy">
                <strong>{formatCoordinates(item.location)}</strong>
                <small>{item.caption ?? "Sdílená poloha"}</small>
              </div>
              <button className="map-center-button" onClick={() => centerLocationInCop(item.location!)} type="button">
                <MapPin size={17} />
                Vycentrovat mapu
              </button>
            </div>
          ) : null}
          {((item.kind !== "image" && item.kind !== "video" && item.kind !== "location") || (!item.url && !item.posterUrl)) && item.kind !== "location" ? (
            <div className="document-preview">
              <DocumentThumb fileName={item.title} large />
              <span>{item.contentType ?? "Soubor"}</span>
              {item.byteSizeLabel ? <small>{item.byteSizeLabel}</small> : null}
            </div>
          ) : null}
        </div>
        {item.caption ? <p>{item.caption}</p> : null}
      </section>
    </div>
  );
}

function mediaKindLabel(kind: MediaPreviewItem["kind"]): string {
  if (kind === "image") {
    return "Fotografie";
  }
  if (kind === "video") {
    return "Video";
  }
  if (kind === "location") {
    return "Poloha";
  }
  if (kind === "document") {
    return "Dokument";
  }
  return "Soubor";
}
