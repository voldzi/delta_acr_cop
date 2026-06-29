import type React from "react";

export type DetailTone = "critical" | "neutral" | "ok" | "warn";

export function DataMetric({ label, value, tone }: { label: string; value: string; tone: DetailTone }) {
  return (
    <div className={`data-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function StatusBadge({ label, tone }: { label: string; tone: DetailTone }) {
  return <span className={`status-badge ${tone}`}>{label}</span>;
}

export function ObjectDetailSection({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="object-detail-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function DetailGrid({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="detail-grid">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
