import { describe, expect, it } from "vitest";
import { communityAttachmentId, createCommunitySubmissionId } from "./community-report-outbox";

describe("community report outbox identity", () => {
  it("creates a UUID submission identity", () => {
    expect(createCommunitySubmissionId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    );
  });

  it("keeps one attachment identity stable across retries", () => {
    const file = { lastModified: 42, name: "most.jpg", size: 2048, type: "image/jpeg" };
    const first = communityAttachmentId("c358448d-3fca-47ab-b93c-ad33016993bf", file);
    expect(communityAttachmentId("c358448d-3fca-47ab-b93c-ad33016993bf", file)).toBe(first);
    expect(communityAttachmentId("2e967146-3e13-4d88-bf0e-8719cd9b2a3f", file)).not.toBe(first);
    expect(first).toMatch(/^[0-9a-f-]{36}$/u);
  });
});
