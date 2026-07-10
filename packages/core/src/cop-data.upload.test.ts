import { describe, expect, it } from "vitest";

import { directCommunityAttachmentUploadAllowed } from "./cop-data";

describe("community attachment upload routing", () => {
  it("skips an insecure object-store URL from an HTTPS PWA so the API proxy is used immediately", () => {
    expect(directCommunityAttachmentUploadAllowed("http://docker.home.cz:8334/bucket/object", "https:")).toBe(false);
    expect(directCommunityAttachmentUploadAllowed("https://media.example.test/bucket/object", "https:")).toBe(true);
  });

  it("allows the local HTTP object-store path during HTTP development", () => {
    expect(directCommunityAttachmentUploadAllowed("http://localhost:8334/bucket/object", "http:")).toBe(true);
  });
});
