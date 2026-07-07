import React from "react";
import clsx from "clsx";
import { MapPin, Navigation, Video, X } from "lucide-react";
import {
  ChatAttachmentPreview,
  createChatAttachmentPreviewDescriptor,
  inferChatAttachmentPreviewKind,
  type ChatAttachmentPreviewDescriptor,
  type ChatMediaPreviewItem,
  type ResolvedAttachmentPreview
} from "../components/AttachmentPreview";
import {
  StaticLocationMap,
  centerLocationInCop,
  formatCoordinates,
  navigateToLocationInCop
} from "../components/LocationPreview";
import { useModalFocus } from "../hooks/useModalFocus";

export type MediaPreviewItem = ChatMediaPreviewItem;

export default function MediaPreviewDialog({ item, onClose }: { item: MediaPreviewItem; onClose: () => void }) {
  const modal = useModalFocus<HTMLElement>(onClose);
  const { descriptor, error, loading, resolved, triggerDownload } = useAttachmentPreviewDescriptor(item);
  const resolvedUrl = resolved.url ?? item.url;
  return (
    <div className="preview-backdrop" onClick={onClose} role="presentation">
      <section
        ref={modal.dialogRef}
        className={clsx(
          "preview-dialog",
          (item.kind === "document" || item.kind === "file") && "with-document-preview"
        )}
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
            <small>
              {[mediaKindLabel(item.kind), item.byteSizeLabel, item.contentType].filter(Boolean).join(" · ")}
            </small>
          </span>
          <button className="round-icon" onClick={onClose} type="button" aria-label="Zavřít">
            <X size={20} />
          </button>
        </header>
        <div className={clsx("preview-stage", item.kind)}>
          {item.kind === "image" && resolvedUrl ? <img alt={item.title} src={resolvedUrl} /> : null}
          {item.kind === "video" && resolvedUrl ? <video controls playsInline src={resolvedUrl} /> : null}
          {item.kind === "video" && !resolvedUrl && item.posterUrl ? (
            <div className="preview-video-poster">
              <img alt={item.title} src={item.posterUrl} />
              <span>
                <Video size={22} /> Demo náhled videa
              </span>
            </div>
          ) : null}
          {item.kind === "location" && item.location ? (
            <div className="large-map">
              <StaticLocationMap location={item.location} large />
              <div className="large-map-copy">
                <strong>{formatCoordinates(item.location)}</strong>
                <small>{item.caption ?? "Sdílená poloha"}</small>
              </div>
              <div className="large-map-actions">
                <button className="map-center-button" onClick={() => centerLocationInCop(item.location!)} type="button">
                  <MapPin size={17} />
                  Vycentrovat mapu
                </button>
                <button
                  className="map-center-button primary"
                  onClick={() => navigateToLocationInCop(item.location!)}
                  type="button"
                >
                  <Navigation size={17} />
                  Navigovat
                </button>
              </div>
            </div>
          ) : null}
          {item.kind !== "image" && item.kind !== "video" && item.kind !== "location" ? (
            <ChatAttachmentPreview
              descriptor={descriptor}
              error={error}
              loading={loading}
              onDownload={triggerDownload}
            />
          ) : null}
          {(item.kind === "image" || item.kind === "video") && !resolvedUrl && !item.posterUrl ? (
            <ChatAttachmentPreview
              descriptor={descriptor}
              error={error}
              loading={loading}
              onDownload={triggerDownload}
            />
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

function useAttachmentPreviewDescriptor(item: MediaPreviewItem): {
  descriptor: ChatAttachmentPreviewDescriptor | null;
  error: string | null;
  loading: boolean;
  resolved: ResolvedAttachmentPreview;
  triggerDownload: () => void;
} {
  const [resolved, setResolved] = React.useState<ResolvedAttachmentPreview>(() => (item.url ? { url: item.url } : {}));
  const [descriptor, setDescriptor] = React.useState<ChatAttachmentPreviewDescriptor | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];
    const load = async () => {
      if (item.kind === "location") {
        return;
      }
      setLoading(true);
      setError(null);
      try {
        let blob: Blob | undefined;
        let url = item.url;
        if (!url && item.loadBlob) {
          blob = await item.loadBlob();
          if (cancelled) return;
          url = window.URL.createObjectURL(blob);
          objectUrls.push(url);
        }
        const descriptorSourceUrl = shouldProvideSourceUrl(item, url) ? url : undefined;
        const nextDescriptor = await createChatAttachmentPreviewDescriptor({
          blob,
          contentType: blob?.type || item.contentType,
          fileName: item.downloadName ?? item.title,
          sourceUrl: descriptorSourceUrl
        });
        if (!cancelled) {
          setResolved({
            ...(blob ? { blob } : {}),
            ...(url ? { url } : {}),
            ...(url && objectUrls.includes(url) ? { objectUrl: url } : {})
          });
          setDescriptor(nextDescriptor);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Náhled se nepodařilo načíst.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      objectUrls.forEach((url) => window.URL.revokeObjectURL(url));
    };
  }, [item]);

  const triggerDownload = React.useCallback(() => {
    const url = resolved.url ?? item.url;
    if (!url) return;
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = item.downloadName ?? item.title;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }, [item.downloadName, item.title, item.url, resolved.url]);

  return { descriptor, error, loading, resolved, triggerDownload };
}

function shouldProvideSourceUrl(item: MediaPreviewItem, url: string | undefined): boolean {
  if (!url) return false;
  const kind = inferChatAttachmentPreviewKind(item.downloadName ?? item.title, item.contentType, item.kind);
  return kind === "pdf" || kind === "image" || kind === "video" || kind === "audio";
}
