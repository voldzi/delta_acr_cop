import { afterEach, describe, expect, it, vi } from "vitest";
import { S3PresignedMediaStorage } from "./media-storage.js";

describe("S3PresignedMediaStorage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("checks the configured bucket during initialization", async () => {
    const calls: Array<{ init?: RequestInit; url: string }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ init, url });
      return new Response(null, { status: 200 });
    });

    const storage = testStorage();
    await storage.init();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://seaweed.test:8333/cop-community-media");
    expect(calls[0]?.init?.method).toBe("HEAD");
    expect(calls[0]?.init?.headers).toMatchObject({
      "x-amz-content-sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    });
    expect(String((calls[0]?.init?.headers as Record<string, string>).authorization)).toContain("Credential=cop-access/");
    expect(storage.diagnostics()).toBe("bucket=cop-community-media; endpoint=http://seaweed.test:8333");
  });

  it("creates the configured bucket when it is missing", async () => {
    const methods: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      methods.push(String(init?.method));
      return new Response(null, { status: methods.length === 1 ? 404 : 200 });
    });

    await testStorage().init();

    expect(methods).toEqual(["HEAD", "PUT"]);
  });

  it("returns a presigned upload slot on the public endpoint", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 200 }));
    const storage = testStorage();
    await storage.init();

    const upload = await storage.createUploadSlot({
      attachmentId: "attachment-1",
      byteSize: 128,
      contentType: "image/jpeg",
      fileName: "Požár u mostu.jpg",
      reportId: "report-1"
    }, new Date("2026-05-21T04:30:00Z"));

    expect(upload).toMatchObject({
      bucket: "cop-community-media",
      headers: {
        "content-type": "image/jpeg"
      },
      method: "PUT",
      objectKey: "community-reports/report-1/attachment-1/Pozar-u-mostu.jpg"
    });
    expect(upload.uploadUrl).toContain("https://media.example.test/cop-community-media/community-reports/report-1/attachment-1/Pozar-u-mostu.jpg?");
    expect(upload.uploadUrl).toContain("X-Amz-Signature=");
  });
});

function testStorage(): S3PresignedMediaStorage {
  return new S3PresignedMediaStorage({
    accessKeyId: "cop-access",
    bucket: "cop-community-media",
    endpoint: "http://seaweed.test:8333",
    publicEndpoint: "https://media.example.test",
    region: "us-east-1",
    secretAccessKey: "cop-secret",
    uploadExpiresSeconds: 900
  });
}
