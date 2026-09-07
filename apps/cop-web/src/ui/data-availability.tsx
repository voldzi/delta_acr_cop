import { AlertTriangle } from "lucide-react";
import React from "react";

export interface DataAvailabilityCopy {
  message: string;
  technicalDetail: string;
  title: string;
}

export function dataAvailabilityCopy(error: string, cachedDataAvailable = true): DataAvailabilityCopy {
  const technicalDetail = normalizeTechnicalDetail(error);
  const normalized = technicalDetail.toLowerCase();
  const cachedSuffix = cachedDataAvailable
    ? "Poslední dostupná data zůstávají zobrazena."
    : "Aplikace spojení obnoví automaticky.";

  if (/\b(401|403)\b|unauthori[sz]ed|forbidden|token.*expired/.test(normalized)) {
    return {
      message: "Pro pokračování obnovte přihlášení. Rozpracovaná práce v zařízení zůstane zachována.",
      technicalDetail,
      title: "Přihlášení je potřeba obnovit"
    };
  }

  if (/\b(502|503|504)\b|network|fetch|timeout|unavailable|connection|offline|failed/.test(normalized)) {
    return {
      message: cachedSuffix,
      technicalDetail,
      title: "Živá data se právě obnovují"
    };
  }

  return {
    message: cachedSuffix,
    technicalDetail,
    title: "Některá data se nepodařilo načíst"
  };
}

export function mapUnavailableMessage(error: string): string {
  return dataAvailabilityCopy(error, false).message;
}

export function DataAvailabilityNotice({
  cachedDataAvailable = true,
  className = "",
  error
}: {
  cachedDataAvailable?: boolean;
  className?: string;
  error: string;
}) {
  const copy = dataAvailabilityCopy(error, cachedDataAvailable);
  return (
    <div className={`data-availability-notice ${className}`.trim()} role="status" aria-live="polite">
      <AlertTriangle aria-hidden="true" size={17} />
      <div>
        <strong>{copy.title}</strong>
        <span>{copy.message}</span>
        <details>
          <summary>Podrobnosti pro správce</summary>
          <code>{copy.technicalDetail}</code>
        </details>
      </div>
    </div>
  );
}

function normalizeTechnicalDetail(error: string): string {
  const normalized = error.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Bez technického detailu.";
  }
  return normalized.length > 800 ? `${normalized.slice(0, 797)}…` : normalized;
}
