import clsx from "clsx";
import { MapPin } from "lucide-react";
import { encodeChatCenterLocation, encodeCopMapFocusUrl } from "@cop/messaging/bridge";
import type { MatrixLocationShare } from "@cop/messaging/types";

export function StaticLocationMap({ large = false, location }: { large?: boolean; location: MatrixLocationShare }) {
  const tileUrl = osmTileUrlForLocation(location, large ? 15 : 14);
  return (
    <span
      className={clsx("map-tile", large && "large")}
      style={{ backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.04), rgba(0, 0, 0, 0.04)), url("${tileUrl}")` }}
      aria-hidden="true"
    >
      <span className="map-pin-dot"><MapPin size={large ? 26 : 18} /></span>
    </span>
  );
}

export function formatCoordinates(location: { lat: number; lon: number }): string {
  return `${location.lat.toFixed(5)}, ${location.lon.toFixed(5)}`;
}

export function centerLocationInCop(location: MatrixLocationShare): void {
  const focus = encodeChatCenterLocation(location.lat, location.lon, {
    label: location.label,
    zoom: 16
  });
  if (window.parent !== window) {
    window.parent.postMessage(focus, window.location.origin);
    return;
  }
  window.open(encodeCopMapFocusUrl(new URL("/", window.location.origin), focus), "_self", "noopener,noreferrer");
}

function osmTileUrlForLocation(location: { lat: number; lon: number }, zoom: number): string {
  const z = Math.max(1, Math.min(18, Math.trunc(zoom)));
  const latRad = location.lat * Math.PI / 180;
  const scale = 2 ** z;
  const x = Math.floor((location.lon + 180) / 360 * scale);
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * scale);
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}
