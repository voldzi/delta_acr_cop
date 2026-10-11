import React from "react";

export interface MediaNewsHeadline {
  id: string;
  title: string;
  link: string;
  publishedAt: string;
  stale: boolean;
  source: { attribution: "Česká televize / ČT24" };
}
export interface MediaNewsSnapshot {
  status: "ok" | "degraded" | "disabled";
  items: MediaNewsHeadline[];
}

export function parseMediaNewsSnapshot(value: unknown, now = Date.now()): MediaNewsSnapshot {
  if (
    !isRecord(value) ||
    value.contractVersion !== "sim-crisis-media-context-v1" ||
    value.informationalOnly !== true ||
    value.notificationEligible !== false ||
    !["ok", "degraded", "disabled"].includes(String(value.status)) ||
    !Array.isArray(value.items) ||
    value.items.length > 20
  )
    throw new Error("Neplatný zpravodajský kontext.");
  const items = value.items
    .map((item): MediaNewsHeadline => {
      if (
        !isRecord(item) ||
        typeof item.id !== "string" ||
        item.id.length > 160 ||
        !item.id ||
        typeof item.title !== "string" ||
        !item.title.trim() ||
        item.title.length > 300 ||
        /[<>\u0000-\u001f\u007f]/u.test(item.title) ||
        !safeNewsLink(item.link) ||
        typeof item.publishedAt !== "string" ||
        !Number.isFinite(Date.parse(item.publishedAt)) ||
        Date.parse(item.publishedAt) > now + 60_000 ||
        item.informationalOnly !== true ||
        item.notificationEligible !== false ||
        item.location !== null ||
        item.locationStatus !== "unresolved" ||
        item.regionScope !== "feed" ||
        typeof item.stale !== "boolean" ||
        !isRecord(item.source) ||
        item.source.attribution !== "Česká televize / ČT24"
      ) {
        throw new Error("Neplatný zpravodajský kontext.");
      }
      return {
        id: item.id,
        title: item.title,
        link: item.link,
        publishedAt: item.publishedAt,
        stale: item.stale,
        source: { attribution: "Česká televize / ČT24" }
      };
    })
    .filter((item) => now - Date.parse(item.publishedAt) <= 86_400_000);
  if (value.status === "disabled" && items.length) throw new Error("Neplatný zpravodajský kontext.");
  return { status: value.status as MediaNewsSnapshot["status"], items };
}

/** Separate informational panel: a feed region is never interpreted as incident location. */
export function MediaNewsPanel({
  apiBase,
  token,
  enabled,
  online,
  visible
}: {
  apiBase: string;
  token?: string;
  enabled: boolean;
  online: boolean;
  visible: boolean;
}) {
  const [snapshot, setSnapshot] = React.useState<MediaNewsSnapshot | null>(null);
  const [unavailable, setUnavailable] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  React.useEffect(() => {
    setSnapshot(null);
    setUnavailable(false);
    if (!enabled || !online || !visible) return;
    let disposed = false;
    let active: AbortController | null = null;
    const refresh = async () => {
      if (active) return;
      const controller = new AbortController();
      active = controller;
      const timer = window.setTimeout(() => controller.abort(), 15_000);
      setLoading(true);
      try {
        const response = await fetch(`${apiBase}/api/v1/safety/context/news`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controller.signal
        });
        if (!response.ok) throw new Error("unavailable");
        const result = parseMediaNewsSnapshot(await response.json());
        if (!disposed) {
          setSnapshot(result);
          setUnavailable(false);
        }
      } catch {
        if (!disposed) {
          setSnapshot(null);
          setUnavailable(true);
        }
      } finally {
        window.clearTimeout(timer);
        active = null;
        if (!disposed) setLoading(false);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 300_000);
    return () => {
      disposed = true;
      active?.abort();
      window.clearInterval(timer);
    };
  }, [apiBase, token, enabled, online, visible]);
  return (
    <section className="media-news-panel" aria-label="Zpravodajský kontext">
      <h2>Zpravodajský kontext</h2>
      <p className="settings-help">
        Doplňkové zprávy ČT24. Nejde o oficiální krizové výstrahy ani potvrzení události ve vaší blízkosti.
      </p>
      {!online || unavailable || !enabled ? (
        <p className="empty-mini" role="status">
          Zpravodajský kontext nyní není dostupný.
        </p>
      ) : loading && !snapshot ? (
        <p className="empty-mini" role="status">
          Načítám zpravodajský kontext…
        </p>
      ) : snapshot?.status === "disabled" ? (
        <p className="empty-mini" role="status">
          Zpravodajský zdroj není zapnutý.
        </p>
      ) : snapshot?.items.length === 0 ? (
        <p className="empty-mini" role="status">
          Nejsou dostupné aktuální zpravodajské titulky.
        </p>
      ) : null}
      {snapshot?.status === "degraded" ? (
        <p className="empty-mini" role="status">
          Některé zpravodajské zdroje nejsou aktuálně dostupné.
        </p>
      ) : null}
      <ul className="media-news-list">
        {(snapshot?.items ?? []).map((item) => (
          <li key={item.id}>
            <a href={item.link} target="_blank" rel="noopener noreferrer">
              {item.title}
            </a>
            <small>
              {item.source.attribution} ·{" "}
              {new Date(item.publishedAt).toLocaleString("cs-CZ", {
                day: "numeric",
                month: "numeric",
                hour: "2-digit",
                minute: "2-digit"
              })}
              {item.stale ? " · aktuálnost zdroje neověřena" : ""}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function safeNewsLink(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "ct24.ceskatelevize.cz" &&
      !url.username &&
      !url.password &&
      !url.port
    );
  } catch {
    return false;
  }
}
