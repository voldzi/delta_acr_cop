export function formatDurationSeconds(value: number | undefined): string {
  if (value === undefined) {
    return "n/a";
  }
  if (value < 60) {
    return `${Math.round(value)} s`;
  }
  if (value < 3600) {
    return `${Math.round(value / 60)} min`;
  }
  return `${Math.round((value / 3600) * 10) / 10} h`;
}

export function formatFloodThresholds(metrics: Record<string, unknown>): string {
  const thresholdRows: Array<[string, number | undefined, number | undefined]> = [
    ["1. SPA", recordNumber(metrics, "spa1Cm"), recordNumber(metrics, "spa1FlowM3s")],
    ["2. SPA", recordNumber(metrics, "spa2Cm"), recordNumber(metrics, "spa2FlowM3s")],
    ["3. SPA", recordNumber(metrics, "spa3Cm"), recordNumber(metrics, "spa3FlowM3s")]
  ];
  const thresholds = thresholdRows
    .map(([label, level, flow]) => {
      const parts = [
        typeof level === "number" ? `${level} cm` : undefined,
        typeof flow === "number" ? `${Math.round(flow * 10) / 10} m3/s` : undefined
      ].filter(Boolean);
      return parts.length > 0 ? `${label}: ${parts.join(" / ")}` : undefined;
    })
    .filter(Boolean);
  return thresholds.length > 0 ? thresholds.join(" · ") : "n/a";
}

export function formatOptionalNumber(value: number | undefined, unit: string): string {
  return value === undefined ? "n/a" : `${Math.round(value * 10) / 10}${unit}`;
}

export function formatOptionalPercent(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value * 100)} %` : "n/a";
}

export function formatOptionalPercentFromWhole(value: number | undefined, fallbackRatio?: number): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${Math.round(value)} %`;
  }
  return formatOptionalPercent(fallbackRatio);
}

export function formatShortDateTime(value: string | undefined): string {
  if (!value) {
    return "n/a";
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return "n/a";
  }
  return timestamp.toLocaleTimeString("cs-CZ");
}

export function formatShortTime(value: number): string {
  return new Intl.DateTimeFormat("cs-CZ", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function formatStringList(value: string[] | undefined): string {
  return value && value.length > 0 ? value.slice(0, 6).join(", ") : "n/a";
}

export function humanizeApiError(value: string): string {
  if (value.includes("401")) {
    return "Přihlášení už není platné. Přihlaste se znovu v horní liště.";
  }
  if (value.includes("403")) {
    return "K těmto datům nemáte oprávnění.";
  }
  if (value.includes("404")) {
    return "Požadovaný detail už není dostupný.";
  }
  if (value.includes("503")) {
    return "Zdroj dat je dočasně nedostupný.";
  }
  return value || "Operaci se nepodařilo dokončit.";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function booleanProperty(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "ano"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "ne"].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

export function numberProperty(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function recordNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = Number(record[key]);
  return Number.isFinite(value) ? value : undefined;
}

export function recordString(value: Record<string, unknown> | undefined, key: string): string | undefined {
  return value ? stringProperty(value[key]) : undefined;
}

export function sourceDisplayName(sourceSystemId: string | undefined): string {
  if (!sourceSystemId) {
    return "zdroj není dostupný";
  }
  const labels: Record<string, string> = {
    aviation_weather: "METAR/TAF",
    chmi_air_quality: "ČHMÚ",
    chmi_weather_stations: "ČHMÚ",
    chmi_weather_webcams: "ČHMÚ webkamery",
    "flight-data-api": "Veřejná letecká data",
    "mission-arena": "Mission Arena",
    open_meteo: "Open-Meteo",
    "safety-data-api": "Výstražná data",
    "sim-air-situation-001": "Cvičná letecká situace",
    "situation-data-api": "Situační vrstvy",
    "tak-gateway": "Partnerská data"
  };
  return labels[sourceSystemId] ?? sourceSystemId;
}

export function stringProperty(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
