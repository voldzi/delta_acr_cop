import type { AiCopResponse } from "@cop/core/cop-data";

export function aiResponseSummary(response: AiCopResponse): string {
  const summary = response.result.summary;
  if (typeof summary === "string" && summary.trim()) {
    return summary.trim();
  }
  const content = response.result.content;
  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }
  const text = response.result.text;
  if (typeof text === "string" && text.trim()) {
    return text.trim();
  }
  return JSON.stringify(response.result, null, 2);
}

export function aiStatusLabel(status: AiCopResponse["status"]): string {
  switch (status) {
    case "COMPLETED":
      return "dokončeno";
    case "NEEDS_HUMAN_REVIEW":
      return "vyžaduje kontrolu";
    case "REJECTED":
      return "zamítnuto";
  }
}
