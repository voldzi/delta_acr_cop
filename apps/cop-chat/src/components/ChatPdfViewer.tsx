import React, { type CSSProperties } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileSearch,
  Maximize2,
  RotateCw,
  ShieldAlert,
  ZoomIn,
  ZoomOut
} from "lucide-react";

type PdfJsModule = typeof import("pdfjs-dist");

export interface ChatPdfViewerProps {
  fileName: string;
  onDownload?: () => void;
  sourceBlob?: Blob;
  sourceUrl: string;
}

export function ChatPdfViewer({ fileName, onDownload, sourceBlob, sourceUrl }: ChatPdfViewerProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = React.useRef<{ cancel: () => void } | null>(null);
  const sourceUrlWithoutFragment = stripUrlFragment(sourceUrl);
  const [requestedPage, setRequestedPage] = React.useState(1);
  const [zoom, setZoom] = React.useState(1.25);
  const [fitWidth, setFitWidth] = React.useState(true);
  const [rotation, setRotation] = React.useState(0);
  const [containerWidth, setContainerWidth] = React.useState(0);
  const [renderState, setRenderState] = React.useState<{
    height: number;
    pageCount: number | null;
    pageNumber: number;
    status: "loading" | "ready" | "error";
    width: number;
  }>({
    height: 0,
    pageCount: null,
    pageNumber: 1,
    status: "loading",
    width: 0
  });

  React.useEffect(() => {
    setRequestedPage(1);
  }, [sourceBlob, sourceUrlWithoutFragment]);

  React.useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      setContainerWidth(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(element);
    setContainerWidth(element.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let cleanupDocument: (() => void) | null = null;
    let cleanupRender: (() => void) | null = null;

    const renderPdf = async () => {
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      setRenderState({
        height: 0,
        pageCount: null,
        pageNumber: requestedPage,
        status: "loading",
        width: 0
      });

      try {
        const pdfjs = await loadPdfJs();
        if (cancelled) return;

        const pdfBytes = sourceBlob ? await sourceBlob.arrayBuffer() : await fetchPdfBytes(sourceUrlWithoutFragment);
        if (cancelled) return;

        const loadingTask = pdfjs.getDocument({ data: new Uint8Array(pdfBytes) });
        cleanupDocument = () => {
          void loadingTask.destroy();
        };

        const pdf = await loadingTask.promise;
        if (cancelled) return;

        const pageNumber = clampInteger(requestedPage, 1, pdf.numPages);
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;

        const baseViewport = page.getViewport({ rotation, scale: 1 });
        const targetScale = fitWidth && containerWidth > 0
          ? clampNumber((containerWidth - 34) / baseViewport.width, 0.3, 4)
          : zoom;
        const viewport = page.getViewport({ rotation, scale: targetScale });
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas context unavailable");

        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
        context.clearRect(0, 0, viewport.width, viewport.height);

        const renderTask = page.render({ canvas, canvasContext: context, viewport });
        renderTaskRef.current = renderTask;
        cleanupRender = () => {
          renderTask.cancel();
          if (renderTaskRef.current === renderTask) {
            renderTaskRef.current = null;
          }
        };

        await renderTask.promise;
        if (renderTaskRef.current === renderTask) {
          renderTaskRef.current = null;
        }
        cleanupRender = null;
        if (cancelled) return;

        setRenderState({
          height: viewport.height,
          pageCount: pdf.numPages,
          pageNumber,
          status: "ready",
          width: viewport.width
        });
      } catch (error) {
        if (!cancelled) {
          console.warn("COP Chat PDF preview render failed", error);
          setRenderState({
            height: 0,
            pageCount: null,
            pageNumber: requestedPage,
            status: "error",
            width: 0
          });
        }
      }
    };

    void renderPdf();

    return () => {
      cancelled = true;
      cleanupRender?.();
      cleanupDocument?.();
    };
  }, [containerWidth, fitWidth, requestedPage, rotation, sourceBlob, sourceUrlWithoutFragment, zoom]);

  const pageCount = renderState.pageCount ?? 0;
  const canGoPrevious = renderState.pageNumber > 1 && renderState.status !== "loading";
  const canGoNext = pageCount > 0 && renderState.pageNumber < pageCount && renderState.status !== "loading";
  const zoomPercent = Math.round(zoom * 100);
  const setPage = (nextPage: number) => {
    setRequestedPage(pageCount ? clampInteger(nextPage, 1, pageCount) : Math.max(1, Math.trunc(nextPage)));
  };
  const setCustomZoom = (nextZoom: number) => {
    setFitWidth(false);
    setZoom(clampNumber(nextZoom, 0.35, 4));
  };

  return (
    <div className="chat-pdf-viewer" ref={containerRef} title={fileName}>
      <div className="chat-pdf-viewer__toolbar" aria-label="Ovládání PDF">
        <button aria-label="Předchozí strana" disabled={!canGoPrevious} onClick={() => setPage(renderState.pageNumber - 1)} type="button">
          <ChevronLeft size={16} />
        </button>
        <label className="chat-pdf-viewer__page-control">
          <span>Strana</span>
          <input
            aria-label="Strana"
            inputMode="numeric"
            max={pageCount || undefined}
            min={1}
            onChange={(event) => setPage(Number(event.target.value))}
            type="number"
            value={renderState.pageNumber}
          />
          <em>/ {pageCount || "..."}</em>
        </label>
        <button aria-label="Další strana" disabled={!canGoNext} onClick={() => setPage(renderState.pageNumber + 1)} type="button">
          <ChevronRight size={16} />
        </button>
        <span className="chat-pdf-viewer__separator" aria-hidden="true" />
        <button aria-label="Zmenšit" onClick={() => setCustomZoom(zoom - 0.15)} type="button">
          <ZoomOut size={16} />
        </button>
        <button aria-label="Přizpůsobit šířce" className={fitWidth ? "is-active" : undefined} onClick={() => setFitWidth(true)} type="button">
          <Maximize2 size={16} />
          <span>{fitWidth ? "Fit" : `${zoomPercent}%`}</span>
        </button>
        <button aria-label="Zvětšit" onClick={() => setCustomZoom(zoom + 0.15)} type="button">
          <ZoomIn size={16} />
        </button>
        <button aria-label="Otočit" onClick={() => setRotation((current) => (current + 90) % 360)} type="button">
          <RotateCw size={16} />
        </button>
        <span className="chat-pdf-viewer__separator" aria-hidden="true" />
        <button aria-label="Otevřít v nové záložce" onClick={() => window.open(sourceUrl, "_blank", "noopener,noreferrer")} type="button">
          <ExternalLink size={16} />
        </button>
        {onDownload ? (
          <button aria-label="Stáhnout" onClick={onDownload} type="button">
            <Download size={16} />
          </button>
        ) : null}
      </div>
      <div className="chat-pdf-viewer__page-scroll">
        <div className="chat-pdf-viewer__page" style={pdfPageStyle(renderState)}>
          <canvas ref={canvasRef} />
          {renderState.status === "loading" ? (
            <div className="chat-pdf-viewer__state">
              <FileSearch size={22} />
              Načítám PDF náhled
            </div>
          ) : null}
          {renderState.status === "error" ? (
            <div className="chat-pdf-viewer__fallback">
              <ShieldAlert size={20} />
              <strong>PDF se nepodařilo vykreslit.</strong>
              <small>Zobrazujeme nativní náhled prohlížeče.</small>
              <iframe src={sourceUrl} title={fileName} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;

function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();
      return pdfjs;
    });
  }
  return pdfJsModulePromise;
}

async function fetchPdfBytes(sourceUrl: string): Promise<ArrayBuffer> {
  const response = await fetch(sourceUrl, { headers: { Accept: "application/pdf" } });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.arrayBuffer();
}

function pdfPageStyle(renderState: { height: number; status: "loading" | "ready" | "error"; width: number }): CSSProperties | undefined {
  if (renderState.status === "ready" && renderState.width > 0 && renderState.height > 0) {
    return {
      height: renderState.height,
      width: renderState.width
    };
  }
  return undefined;
}

function stripUrlFragment(sourceUrl: string): string {
  const [baseUrl] = sourceUrl.split("#");
  return baseUrl ?? sourceUrl;
}

function clampInteger(value: number, min: number, max: number): number {
  const numeric = Number.isFinite(value) ? Math.trunc(value) : min;
  return Math.min(max, Math.max(min, numeric));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
