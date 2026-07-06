import React from "react";
import { Database, MapPin } from "lucide-react";
import type { AiCopResponse } from "@cop/core/cop-data";

interface AiEvidenceCitation {
  citationId: string;
  entityId?: string;
  entityType?: string;
  label?: string;
  location?: {
    lat: number;
    lon: number;
  };
  updatedAt?: string;
}

interface AiEvidenceSummary {
  indexed?: {
    documentCount?: number;
    matchedDocumentCount?: number;
    status?: string;
    citations: AiEvidenceCitation[];
  };
  priority: {
    citations: AiEvidenceCitation[];
  };
  semantic: {
    documentCount?: number;
    model?: string;
    status?: string;
    citations: AiEvidenceCitation[];
  };
}

export function AiEvidencePanel({ response }: { response: AiCopResponse }) {
  const evidence = aiEvidenceSummary(response);
  if (
    !evidence ||
    evidence.priority.citations.length +
      evidence.semantic.citations.length +
      (evidence.indexed?.citations.length ?? 0) ===
      0
  ) {
    return null;
  }
  return (
    <section className="ai-evidence-panel" aria-label="Zdrojové citace AI">
      <header>
        <span>
          <Database size={15} />
          <strong>Zdrojové citace</strong>
        </span>
        <small>{aiEvidenceStatusLabel(evidence)}</small>
      </header>
      <div className="ai-evidence-groups">
        <AiEvidenceGroup title="Priority" citations={evidence.priority.citations} />
        <AiEvidenceGroup
          title="Aktuální kontext"
          citations={evidence.semantic.citations}
          detail={evidence.semantic.model}
        />
        <AiEvidenceGroup
          title="Background index"
          citations={evidence.indexed?.citations ?? []}
          detail={
            typeof evidence.indexed?.matchedDocumentCount === "number"
              ? `${evidence.indexed.matchedDocumentCount} shod`
              : evidence.indexed?.status
          }
        />
      </div>
    </section>
  );
}

function AiEvidenceGroup({
  citations,
  detail,
  title
}: {
  citations: AiEvidenceCitation[];
  detail?: string;
  title: string;
}) {
  if (citations.length === 0) {
    return null;
  }
  return (
    <section className="ai-evidence-group">
      <h3>
        {title}
        {detail ? <small>{detail}</small> : null}
      </h3>
      <ul>
        {citations.slice(0, 6).map((citation) => (
          <li key={`${title}:${citation.citationId}:${citation.entityId ?? citation.label ?? ""}`}>
            <span className="ai-evidence-id">{citation.citationId}</span>
            <span className="ai-evidence-label">
              <strong>{citation.label ?? citation.entityId ?? "Zdroj"}</strong>
              <small>
                {[citation.entityType, citation.updatedAt ? formatEvidenceDate(citation.updatedAt) : undefined]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </span>
            {citation.location ? (
              <span
                className="ai-evidence-location"
                title={`${citation.location.lat.toFixed(5)}, ${citation.location.lon.toFixed(5)}`}
              >
                <MapPin size={13} />
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function aiEvidenceSummary(response: AiCopResponse): AiEvidenceSummary | null {
  const structured = asRecord(response.result.structured);
  const evidence = asRecord(structured?.evidence);
  if (!evidence) {
    return null;
  }
  const priority = asRecord(evidence.priority);
  const semantic = asRecord(evidence.semantic);
  const indexed = asRecord(evidence.indexed);
  return {
    ...(indexed
      ? {
          indexed: {
            documentCount: numberValue(indexed.documentCount),
            matchedDocumentCount: numberValue(indexed.matchedDocumentCount),
            status: stringValue(indexed.status),
            citations: citationList(indexed.citations)
          }
        }
      : {}),
    priority: {
      citations: citationList(priority?.citations)
    },
    semantic: {
      documentCount: numberValue(semantic?.documentCount),
      model: stringValue(semantic?.model),
      status: stringValue(semantic?.status),
      citations: citationList(semantic?.citations)
    }
  };
}

function aiEvidenceStatusLabel(evidence: AiEvidenceSummary): string {
  const parts = [
    typeof evidence.semantic.documentCount === "number" ? `${evidence.semantic.documentCount} aktuálních` : undefined,
    typeof evidence.indexed?.documentCount === "number" ? `${evidence.indexed.documentCount} index` : undefined
  ].filter(Boolean);
  return parts.join(" · ") || "auditovaný COP kontext";
}

function citationList(value: unknown): AiEvidenceCitation[] {
  return Array.isArray(value)
    ? value.map(citationFromValue).filter((citation): citation is AiEvidenceCitation => Boolean(citation))
    : [];
}

function citationFromValue(value: unknown): AiEvidenceCitation | null {
  const record = asRecord(value);
  const citationId = stringValue(record?.citationId);
  if (!record || !citationId) {
    return null;
  }
  const citation: AiEvidenceCitation = { citationId };
  const entityId = stringValue(record.entityId);
  const entityType = stringValue(record.entityType);
  const label = stringValue(record.label);
  const location = locationValue(record.location);
  const updatedAt = stringValue(record.updatedAt);
  if (entityId) {
    citation.entityId = entityId;
  }
  if (entityType) {
    citation.entityType = entityType;
  }
  if (label) {
    citation.label = label;
  }
  if (location) {
    citation.location = location;
  }
  if (updatedAt) {
    citation.updatedAt = updatedAt;
  }
  return citation;
}

function locationValue(value: unknown): AiEvidenceCitation["location"] {
  const record = asRecord(value);
  const lat = numberValue(record?.lat);
  const lon = numberValue(record?.lon);
  return lat !== undefined && lon !== undefined ? { lat, lon } : undefined;
}

function formatEvidenceDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("cs-CZ", { day: "2-digit", hour: "2-digit", minute: "2-digit", month: "2-digit" })
    : value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
