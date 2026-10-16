import { afterEach, describe, expect, it, vi } from "vitest";

import { directCommunityAttachmentUploadAllowed, uploadCommunityAttachmentFile, type CommunityReportAttachment } from "./cop-data";

describe("community attachment upload routing", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("uses only its configured authenticated API for a COP transport and never sends the token to descriptor URL", async () => {
    const attachment = { attachmentId: "attachment-1", status: "requested" } as CommunityReportAttachment;
    const uploaded = { ...attachment, status: "uploaded" };
    const calls: Array<{ method: string; url: string; headers: Record<string, string>; body?: File }> = [];
    vi.stubGlobal("XMLHttpRequest", class {
      upload = {};
      status = 200;
      statusText = "OK";
      responseText = JSON.stringify(uploaded);
      onload?: () => void;
      private call = { method: "", url: "", headers: {} as Record<string, string>, body: undefined as File | undefined };
      open(method: string, url: string) { this.call.method = method; this.call.url = url; calls.push(this.call); }
      setRequestHeader(name: string, value: string) { this.call.headers[name] = value; }
      send(body: File) { this.call.body = body; this.onload?.(); }
    });
    const result = await uploadCommunityAttachmentFile("https://cop.example.test", "synthetic-own-user-token", "report-1",
      new File(["data"], "photo.jpg", { type: "image/jpeg" }), { attachment, upload: { bucket: "synthetic-bucket", objectKey: "synthetic-object",
        expiresAt: "2026-10-16T00:15:00Z", method: "POST", transport: "cop_api", headers: {}, uploadUrl: "https://untrusted.example.invalid/receive" } });
    expect(result).toEqual(uploaded);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "https://cop.example.test/api/v1/community/reports/report-1/attachments/attachment-1/upload",
      method: "POST", headers: { Authorization: "Bearer synthetic-own-user-token", "X-COP-Upload-Mode": "binary" } });
    expect(calls[0]!.body?.size).toBe(4);
  });
  it("skips an insecure object-store URL from an HTTPS PWA so the API proxy is used immediately", () => {
    expect(directCommunityAttachmentUploadAllowed("http://docker.home.cz:8334/bucket/object", "https:")).toBe(false);
    expect(directCommunityAttachmentUploadAllowed("https://media.example.test/bucket/object", "https:")).toBe(true);
  });

  it("allows the local HTTP object-store path during HTTP development", () => {
    expect(directCommunityAttachmentUploadAllowed("http://localhost:8334/bucket/object", "http:")).toBe(true);
  });
});
