export const REFRESH_OPTIONS = [1, 2, 5, 10, 30] as const;

export type RefreshSeconds = (typeof REFRESH_OPTIONS)[number];

export function normalizeRefreshSeconds(value: unknown, fallback: RefreshSeconds = 5): RefreshSeconds {
  const numericValue = typeof value === "string" ? Number.parseFloat(value) : Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }

  return REFRESH_OPTIONS.reduce((closest, option) =>
    Math.abs(option - numericValue) < Math.abs(closest - numericValue) ? option : closest
  );
}

export function refreshMillisecondsToSeconds(value: unknown, fallback: RefreshSeconds = 5): RefreshSeconds {
  const numericValue = typeof value === "string" ? Number.parseFloat(value) : Number(value);
  return normalizeRefreshSeconds(Number.isFinite(numericValue) ? numericValue / 1000 : numericValue, fallback);
}

export function parseRefreshSeconds(search: string, fallback: RefreshSeconds = 5): RefreshSeconds {
  const params = new URLSearchParams(search);
  const seconds = params.get("refresh") ?? params.get("refreshSeconds");
  if (seconds !== null) {
    return normalizeRefreshSeconds(seconds, fallback);
  }

  const milliseconds = params.get("refreshMs");
  if (milliseconds !== null) {
    return refreshMillisecondsToSeconds(milliseconds, fallback);
  }

  return fallback;
}
