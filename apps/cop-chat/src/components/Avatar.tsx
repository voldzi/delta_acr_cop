import * as React from "react";
import clsx from "clsx";

export function Avatar({
  label,
  mediaAccessToken,
  small = false,
  src,
  variant
}: {
  label: string;
  mediaAccessToken?: string;
  small?: boolean;
  src?: string;
  variant?: "ai";
}) {
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const [authenticatedSrc, setAuthenticatedSrc] = React.useState<string | undefined>(undefined);
  const needsAuthenticatedFetch = Boolean(src && mediaAccessToken && isMatrixMediaUrl(src));
  React.useEffect(() => {
    setFailedSrc(null);
    setAuthenticatedSrc(undefined);
    if (!src || !mediaAccessToken || !isMatrixMediaUrl(src)) {
      return undefined;
    }

    let cancelled = false;
    let objectUrl: string | undefined;
    const controller = new AbortController();
    fetch(src, {
      cache: "force-cache",
      credentials: "omit",
      headers: {
        Authorization: `Bearer ${mediaAccessToken}`
      },
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Avatar media returned HTTP ${response.status}.`);
        }
        const blob = await response.blob();
        if (blob.type && !blob.type.startsWith("image/")) {
          throw new Error("Avatar media is not an image.");
        }
        objectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = undefined;
          return;
        }
        setAuthenticatedSrc(objectUrl);
      })
      .catch((caught: unknown) => {
        if (!cancelled && !(caught instanceof DOMException && caught.name === "AbortError")) {
          setFailedSrc(src);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [mediaAccessToken, src]);
  const resolvedSrc = needsAuthenticatedFetch ? authenticatedSrc : src;
  const imageSrc = resolvedSrc && failedSrc !== src && failedSrc !== resolvedSrc ? resolvedSrc : undefined;
  return (
    <span className={clsx("avatar", small && "small", imageSrc && "image", variant === "ai" && "ai")} aria-hidden="true">
      {imageSrc ? <img alt="" src={imageSrc} onError={() => setFailedSrc(src ?? imageSrc)} /> : variant === "ai" ? "AI" : initialsFor(label)}
    </span>
  );
}

export function initialsFor(value: string): string {
  const parts = value.trim().split(/\s+/u).filter(Boolean);
  const initials = parts.length > 1
    ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`
    : value.slice(0, 2);
  return initials.toLocaleUpperCase("cs-CZ");
}

function isMatrixMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.pathname.includes("/_matrix/media/") || url.pathname.includes("/_matrix/client/");
  } catch {
    return false;
  }
}
