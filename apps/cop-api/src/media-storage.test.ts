import { afterEach, describe, expect, it, vi } from "vitest";
import { createMediaStorageFromEnv, S3PresignedMediaStorage } from "./media-storage.js";

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

  it("issues only a normal authenticated COP POST descriptor in API transport, including retries", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const storage = createMediaStorageFromEnv({ COP_MEDIA_STORE: "seaweedfs", COP_MEDIA_S3_ENDPOINT: "http://seaweed.test:8333",
      COP_MEDIA_S3_PUBLIC_ENDPOINT: "https://foreign-media.example.test", COP_MEDIA_S3_BUCKET: "cop-community-media",
      COP_MEDIA_S3_ACCESS_KEY_ID: "synthetic-access", COP_MEDIA_S3_SECRET_ACCESS_KEY: "synthetic-secret",
      COP_MEDIA_UPLOAD_TRANSPORT: "cop_api", COP_PUBLIC_URL: "https://cop.example.test" })!;
    const request = { attachmentId: "attachment-1", reportId: "report-1", byteSize: 4, contentType: "image/jpeg", fileName: "photo.jpg" };
    for (const now of [new Date("2026-10-16T00:00:00Z"), new Date("2026-10-16T00:01:00Z")]) {
      const slot = await storage.createUploadSlot(request, now);
      expect(slot).toMatchObject({ method: "POST", transport: "cop_api", headers: { "content-type": "image/jpeg" },
        uploadUrl: "https://cop.example.test/api/v1/community/reports/report-1/attachments/attachment-1/upload" });
      expect(JSON.stringify(slot)).not.toMatch(/X-Amz|synthetic-access|synthetic-secret|foreign-media/iu);
    }
    expect(fetch).not.toHaveBeenCalled();
    // Transport alone never attests legacy or unknown provider settlement.
    expect(await storage.verifiedErasureReady!()).toBe(false);
  });

  it.each(["http://cop.example.test", "https://user:pass@cop.example.test", "https://cop.example.test/path", "https://cop.example.test/?override=1"])("refuses an unsafe API origin %s", origin => {
    expect(() => createMediaStorageFromEnv({ COP_MEDIA_STORE: "s3", COP_MEDIA_UPLOAD_TRANSPORT: "cop_api", COP_PUBLIC_URL: origin })).toThrow();
  });

  it("refuses an unknown transport instead of reverting to external presigned uploads", () => {
    expect(() => createMediaStorageFromEnv({ COP_MEDIA_STORE: "s3", COP_MEDIA_UPLOAD_TRANSPORT: "unknown" })).toThrow("Invalid COP_MEDIA_UPLOAD_TRANSPORT");
  });

  it("deletes only the exact verified object in an unversioned bucket and requires 404 readback", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === "GET") return new Response('<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"></VersioningConfiguration>');
      return new Response(null, { status: init?.method === "HEAD" ? 404 : 204 });
    });
    const request = { bucket: "cop-community-media", objectKey: "community-reports/report-1/attachment-1/image.jpg" };
    expect(await testStorage().eraseVerifiedObject(request, new Date("2026-10-14T00:00:00Z"), new AbortController().signal)).toBe("absent");
    expect(calls.map(call => call.init?.method)).toEqual(["GET", "DELETE", "HEAD", "HEAD"]);
    expect(calls.map(call => call.url)).toEqual([
      "http://seaweed.test:8333/cop-community-media?versioning=",
      "http://seaweed.test:8333/cop-community-media/community-reports/report-1/attachment-1/image.jpg",
      "http://seaweed.test:8333/cop-community-media/community-reports/report-1/attachment-1/image.jpg",
      "http://seaweed.test:8333/cop-community-media/community-reports/report-1/attachment-1/image.jpg"
    ]);
    for (const call of calls) { expect(call.init?.redirect).toBe("error"); expect(call.init?.signal).toBeDefined(); }
  });

  it.each([
    '<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Status>Enabled</Status></VersioningConfiguration>',
    '<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Status>Suspended</Status></VersioningConfiguration>',
    '<VersioningConfiguration><Unexpected/></VersioningConfiguration>',
    '<!DOCTYPE object SYSTEM "https://other.test/private"><VersioningConfiguration/>',
    '{}'
  ])("does not treat unsupported/versioned storage as permanently erased", async body => {
    const fetchMock = vi.fn(async () => new Response(body)); vi.stubGlobal("fetch", fetchMock);
    expect(await testStorage().eraseVerifiedObject({ bucket: "cop-community-media", objectKey: "community-reports/r/a/file.jpg" }, new Date(), new AbortController().signal)).toBe("pending");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-bucket, traversal, prefix deletion, and arbitrary URL manifests before contacting storage", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    for (const request of [
      { bucket: "other-bucket", objectKey: "community-reports/r/a/file.jpg" },
      { bucket: "cop-community-media", objectKey: "community-reports/r/../file.jpg" },
      { bucket: "cop-community-media", objectKey: "community-reports/r/" },
      { bucket: "cop-community-media", objectKey: "https://other.test/private" }
    ]) expect(await testStorage().eraseVerifiedObject(request, new Date(), new AbortController().signal)).toBe("pending");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([200, 403, 503])("leaves failed absence readback %s pending without exposing provider text", async status => {
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => init?.method === "GET"
      ? new Response('<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"/>')
      : new Response(null, { status: init?.method === "HEAD" ? status : 204 }));
    expect(await testStorage().eraseVerifiedObject({ bucket: "cop-community-media", objectKey: "community-reports/r/a/file.jpg" }, new Date(), new AbortController().signal)).toBe("pending");
  });

  it("does not complete after cancellation or an oversized versioning response", async () => {
    const fetchMock = vi.fn(async () => new Response("x".repeat(4097))); vi.stubGlobal("fetch", fetchMock);
    const request = { bucket: "cop-community-media", objectKey: "community-reports/r/a/file.jpg" };
    expect(await testStorage().eraseVerifiedObject(request, new Date(), new AbortController().signal)).toBe("pending");
    const controller = new AbortController(); controller.abort();
    await expect(testStorage().eraseVerifiedObject(request, new Date(), controller.signal)).rejects.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("keeps unknown legacy presigned upload settlement unavailable instead of accepting expiry plus a404", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 })); vi.stubGlobal("fetch", fetchMock);
    const storage = testStorage(false), request = { bucket: "cop-community-media", objectKey: "community-reports/r/a/file.jpg" };
    expect(await storage.verifiedErasureReady()).toBe(false);
    expect(await storage.eraseVerifiedObject(request, new Date("2026-10-14T00:00:00Z"), new AbortController().signal)).toBe("pending");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("keeps deletion pending if a PUT admitted before expiry can finish after the absence readback", async () => {
    const settled = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const storage = new S3PresignedMediaStorage({ accessKeyId: "cop-access", bucket: "cop-community-media", endpoint: "http://seaweed.test:8333", publicEndpoint: "https://media.example.test", region: "us-east-1", secretAccessKey: "cop-secret", uploadExpiresSeconds: 900,
      uploadSettlement: { ready: async () => true, verify: settled } });
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => init?.method === "GET"
      ? new Response('<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"/>') : new Response(null, { status: init?.method === "HEAD" ? 404 : 204 }));
    expect(await storage.eraseVerifiedObject({ bucket: "cop-community-media", objectKey: "community-reports/r/a/file.jpg" }, new Date(), new AbortController().signal)).toBe("pending");
    expect(settled).toHaveBeenCalledTimes(2);
  });
  it("rechecks absence after settlement and catches a recreated object after an earlier404", async () => {
    let heads = 0;
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => init?.method === "GET"
      ? new Response('<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"/>')
      : new Response(null, { status: init?.method === "HEAD" ? (++heads === 1 ? 404 : 200) : 204 }));
    expect(await testStorage().eraseVerifiedObject({ bucket: "cop-community-media", objectKey: "community-reports/r/a/file.jpg" }, new Date(), new AbortController().signal)).toBe("pending");
    expect(heads).toBe(2);
  });
});

function testStorage(verifiedSettlement = true): S3PresignedMediaStorage {
  return new S3PresignedMediaStorage({
    accessKeyId: "cop-access",
    bucket: "cop-community-media",
    endpoint: "http://seaweed.test:8333",
    publicEndpoint: "https://media.example.test",
    region: "us-east-1",
    secretAccessKey: "cop-secret",
    uploadExpiresSeconds: 900,
    ...(verifiedSettlement ? { uploadSettlement: { ready: async () => true, verify: async () => true } } : {})
  });
}
