import { chmod, lstat, mkdir, mkdtemp, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AsyncMediaConversionManager, createMediaConversionManagerFromEnv, readSpatialDerivative } from "./media-conversion.js";
import type { MediaConversionConfig, MediaConversionManager, MediaConversionManagerOptions } from "./media-conversion.js";
import type { CommunityReportAttachmentRecord } from "./community-report-store.js";
import type { MediaStorage, MediaObjectReadRequest, MediaObjectReadResult, MediaObjectWriteRequest, MediaUploadRequest, MediaUploadSlot } from "./media-storage.js";

describe("AsyncMediaConversionManager", () => {
  it("queues Apple Spatial MOV conversion and stores a ready XR side-by-side derivative", async () => {
    const attachment = spatialAttachment();
    let current = attachment;
    const storage = new MemoryMediaStorage();
    storage.objects.set(attachment.objectKey, Buffer.from("spatial-source"));
    const manager = new AsyncMediaConversionManager({
      config: {
        enabled: true,
        ffmpegPath: "ffmpeg",
        maxConcurrent: 1,
        timeoutMs: 30000,
        workDir: "/tmp/cop-media-conversion-test"
      },
      mediaStorage: storage,
      runSpatialConversion: async ({ source }) => Buffer.from(`sbs:${source.toString("utf8")}`),
      updateAttachmentMetadata: async (input) => {
        current = {
          ...current,
          metadata: input.metadata
        };
        return current;
      }
    });

    const queued = await manager.enqueueAttachment({
      attachment,
      reportId: attachment.reportId,
      requestNow: new Date("2026-05-24T12:00:00Z")
    });

    expect(readSpatialDerivative(queued)?.status).toBe("queued");
    await vi.waitFor(() => {
      expect(storage.objects.get(`community-reports/${attachment.reportId}/${attachment.attachmentId}/derivatives/xr-sbs.mp4`)?.toString("utf8")).toBe("sbs:spatial-source");
      expect(readSpatialDerivative(current)).toMatchObject({
        contentType: "video/mp4",
        layout: "side_by_side",
        status: "ready"
      });
    });
    manager.close();
  });
});

describe("default spatial converter storage guard", () => {
  const fixtures: string[] = [];
  const uuid = "a6908550-df0f-40d5-81f2-e290cd434977";

  afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function fixture() {
    const root = await mkdtemp(join(await realpath(tmpdir()), "cop-conversion-storage-"));
    fixtures.push(root);
    const workDir = join(root, "work");
    await mkdir(workDir, { mode: 0o700 });
    const marker = join(workDir, ".cop-storage.json");
    await writeFile(marker, JSON.stringify({ uuid }), { mode: 0o600 });
    const receipt = join(root, "tool-invoked");
    const tool = join(root, "synthetic-ffmpeg");
    await writeFile(tool, [
      "#!/bin/sh",
      "input=",
      "previous=",
      "for value do",
      "  if [ \"$previous\" = '-i' ]; then input=\"$value\"; fi",
      "  previous=\"$value\"",
      "  output=\"$value\"",
      "done",
      `printf invoked > '${receipt.replace(/'/gu, "'\\''")}'`,
      "cp \"$input\" \"$output\"",
      ""
    ].join("\n"), { mode: 0o700 });
    const config: MediaConversionConfig = {
      enabled: true,
      ffmpegPath: tool,
      maxConcurrent: 1,
      timeoutMs: 30000,
      workDir,
      expectedStorageUuid: uuid,
      expectedDeviceId: String((await stat(workDir)).dev)
    };
    return { root, workDir, marker, receipt, config };
  }

  async function runDefaultConversion(
    factory: (options: Omit<MediaConversionManagerOptions, "config">) => MediaConversionManager | undefined
  ) {
    let current = spatialAttachment();
    const storage = new MemoryMediaStorage();
    storage.objects.set(current.objectKey, Buffer.from("synthetic-source"));
    const manager = factory({
      mediaStorage: storage,
      updateAttachmentMetadata: async (input) => {
        current = { ...current, metadata: input.metadata };
        return current;
      }
    });
    expect(manager).toBeDefined();
    try {
      await manager!.enqueueAttachment({ attachment: current, reportId: current.reportId, requestNow: new Date() });
      await vi.waitFor(() => {
        expect(["failed", "ready"]).toContain(readSpatialDerivative(current)?.status);
      });
      return { derivative: readSpatialDerivative(current), storage };
    } finally {
      manager!.close();
    }
  }

  async function expectRejected(config: MediaConversionConfig, receipt: string, workDir: string, expectedFiles = [".cop-storage.json"]) {
    const result = await runDefaultConversion((options) => new AsyncMediaConversionManager({ ...options, config }));
    expect(result.derivative).toMatchObject({ status: "failed", error: expect.stringContaining("storage guard") });
    expect(result.storage.objects.size).toBe(1);
    await expect(lstat(receipt)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(workDir)).toEqual(expectedFiles);
  }

  it("runs the real converter I/O on verified storage and removes both job files", async () => {
    const data = await fixture();
    const result = await runDefaultConversion((options) => createMediaConversionManagerFromEnv(options, {
      COP_MEDIA_SPATIAL_CONVERSION_ENABLED: "true",
      COP_MEDIA_SPATIAL_FFMPEG_PATH: data.config.ffmpegPath,
      COP_MEDIA_SPATIAL_CONVERSION_WORKDIR: data.workDir,
      COP_MEDIA_SPATIAL_CONVERSION_EXPECTED_STORAGE_UUID: uuid,
      COP_MEDIA_SPATIAL_CONVERSION_EXPECTED_DEVICE_ID: data.config.expectedDeviceId
    }));
    expect(result.derivative).toMatchObject({ status: "ready", byteSize: 16, source: "server_ffmpeg" });
    expect(result.storage.objects.get("community-reports/report-1/attachment-1/derivatives/xr-sbs.mp4")?.toString()).toBe("synthetic-source");
    expect((await stat(data.receipt)).isFile()).toBe(true);
    expect(await readdir(data.workDir)).toEqual([".cop-storage.json"]);
  });

  it("refuses a missing directory instead of creating an internal replacement", async () => {
    const data = await fixture();
    const missing = join(data.root, "missing", "work");
    const result = await runDefaultConversion((options) => new AsyncMediaConversionManager({ ...options, config: { ...data.config, workDir: missing } }));
    expect(result.derivative?.status).toBe("failed");
    await expect(lstat(join(data.root, "missing"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(data.receipt)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a missing marker without writing or invoking ffmpeg", async () => {
    const data = await fixture();
    await rm(data.marker);
    await expectRejected(data.config, data.receipt, data.workDir, []);
  });

  it.each(["wrong UUID", "invalid JSON", "writable marker", "wrong device"])("refuses %s before any job writes", async (reason) => {
    const data = await fixture();
    if (reason === "wrong UUID") await writeFile(data.marker, JSON.stringify({ uuid: "another-filesystem" }));
    if (reason === "invalid JSON") await writeFile(data.marker, "{broken");
    if (reason === "writable marker") await chmod(data.marker, 0o666);
    const config = reason === "wrong device" ? { ...data.config, expectedDeviceId: String(Number(data.config.expectedDeviceId) + 1) } : data.config;
    await expectRejected(config, data.receipt, data.workDir);
  });

  it.each(["marker", "workdir", "ancestor"])("refuses a symlinked %s even on the expected device", async (kind) => {
    const data = await fixture();
    let workDir = data.workDir;
    if (kind === "marker") {
      const realMarker = join(data.root, "marker.json");
      await writeFile(realMarker, JSON.stringify({ uuid }), { mode: 0o600 });
      await rm(data.marker);
      await symlink(realMarker, data.marker);
    } else {
      const link = join(data.root, "linked");
      await symlink(kind === "workdir" ? data.workDir : data.root, link);
      workDir = kind === "workdir" ? link : join(link, "work");
    }
    await expectRejected({ ...data.config, workDir }, data.receipt, data.workDir);
  });

  it.each(["missing UUID", "missing device", "invalid device", "relative directory"])("refuses incomplete configuration: %s", async (reason) => {
    const data = await fixture();
    const config = { ...data.config };
    if (reason === "missing UUID") delete config.expectedStorageUuid;
    if (reason === "missing device") delete config.expectedDeviceId;
    if (reason === "invalid device") config.expectedDeviceId = "1.5";
    if (reason === "relative directory") config.workDir = "relative/work";
    await expectRejected(config, data.receipt, data.workDir);
  });

  it.each(["both", "UUID only", "device only"])("does not use tmpdir for guarded environment configuration (%s)", async (guard) => {
    const data = await fixture();
    const env: Record<string, string> = {
      COP_MEDIA_SPATIAL_CONVERSION_ENABLED: "true",
      COP_MEDIA_SPATIAL_FFMPEG_PATH: data.config.ffmpegPath
    };
    if (guard !== "device only") env.COP_MEDIA_SPATIAL_CONVERSION_EXPECTED_STORAGE_UUID = uuid;
    if (guard !== "UUID only") env.COP_MEDIA_SPATIAL_CONVERSION_EXPECTED_DEVICE_ID = data.config.expectedDeviceId!;
    const result = await runDefaultConversion((options) => createMediaConversionManagerFromEnv(options, env));
    expect(result.derivative).toMatchObject({ status: "failed", error: expect.stringContaining("configuration") });
    await expect(lstat(data.receipt)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(data.workDir)).toEqual([".cop-storage.json"]);
  });

  it("rechecks the marker for a later job instead of caching successful validation", async () => {
    const data = await fixture();
    const storage = new MemoryMediaStorage();
    const first = spatialAttachment();
    const second = { ...first, attachmentId: "attachment-2", objectKey: "second-source.mov" };
    const records = new Map([[first.attachmentId, first], [second.attachmentId, second]]);
    storage.objects.set(first.objectKey, Buffer.from("first-source"));
    storage.objects.set(second.objectKey, Buffer.from("second-source"));
    const manager = new AsyncMediaConversionManager({
      config: data.config,
      mediaStorage: storage,
      updateAttachmentMetadata: async (input) => {
        const record = { ...records.get(input.attachmentId)!, metadata: input.metadata };
        records.set(record.attachmentId, record);
        return record;
      }
    });
    try {
      await manager.enqueueAttachment({ attachment: first, reportId: first.reportId, requestNow: new Date() });
      await vi.waitFor(() => expect(readSpatialDerivative(records.get(first.attachmentId)!)?.status).toBe("ready"));
      await rm(data.marker);
      await rm(data.receipt);
      await manager.enqueueAttachment({ attachment: second, reportId: second.reportId, requestNow: new Date() });
      await vi.waitFor(() => expect(readSpatialDerivative(records.get(second.attachmentId)!)?.status).toBe("failed"));
      await expect(lstat(data.receipt)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readdir(data.workDir)).toEqual([]);
      expect(storage.objects.has("community-reports/report-1/attachment-2/derivatives/xr-sbs.mp4")).toBe(false);
    } finally {
      manager.close();
    }
  });

  it("preserves unguarded local creation and default converter behavior", async () => {
    const data = await fixture();
    const workDir = join(data.root, "local", "created");
    const config = { ...data.config, workDir };
    delete config.expectedStorageUuid;
    delete config.expectedDeviceId;
    const result = await runDefaultConversion((options) => new AsyncMediaConversionManager({ ...options, config }));
    expect(result.derivative?.status).toBe("ready");
    expect(await readdir(workDir)).toEqual([]);
    expect((await stat(data.receipt)).isFile()).toBe(true);
  });
});

function spatialAttachment(): CommunityReportAttachmentRecord {
  return {
    attachmentId: "attachment-1",
    bucket: "cop-community-media",
    byteSize: 14,
    contentType: "video/quicktime",
    createdAt: "2026-05-24T11:59:00Z",
    fileName: "IMG_2741.MOV",
    kind: "video",
    metadata: {
      spatialVideo: {
        browserPlayback: "2d_fallback",
        contentType: "video/quicktime",
        mode: "apple_mv_hevc",
        source: "user_declared",
        storage: "original"
      }
    },
    objectKey: "community-reports/report-1/attachment-1/IMG_2741.MOV",
    reportId: "report-1",
    status: "uploaded",
    subjectId: "user-1",
    uploadedAt: "2026-05-24T12:00:00Z",
    uploadExpiresAt: "2026-05-24T12:15:00Z"
  };
}

class MemoryMediaStorage implements MediaStorage {
  readonly name = "memory";
  readonly objects = new Map<string, Buffer>();

  async init(): Promise<void> {}

  async close(): Promise<void> {}

  async createUploadSlot(_request: MediaUploadRequest, _now: Date): Promise<MediaUploadSlot> {
    throw new Error("not used");
  }

  async createReadUrl(request: MediaObjectReadRequest): Promise<string> {
    return `memory://${request.objectKey}`;
  }

  async getObject(request: MediaObjectReadRequest): Promise<MediaObjectReadResult> {
    const body = this.objects.get(request.objectKey);
    if (!body) {
      throw new Error("not found");
    }
    return { body };
  }

  async putObject(request: MediaObjectWriteRequest): Promise<void> {
    this.objects.set(request.objectKey, request.body);
  }
}
