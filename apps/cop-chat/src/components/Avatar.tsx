import * as React from "react";
import clsx from "clsx";

export function Avatar({ label, small = false, src }: { label: string; small?: boolean; src?: string }) {
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  React.useEffect(() => {
    setFailedSrc(null);
  }, [src]);
  const imageSrc = src && failedSrc !== src ? src : undefined;
  return (
    <span className={clsx("avatar", small && "small", imageSrc && "image")} aria-hidden="true">
      {imageSrc ? <img alt="" src={imageSrc} onError={() => setFailedSrc(imageSrc)} /> : initialsFor(label)}
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
