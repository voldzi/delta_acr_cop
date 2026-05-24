import { describe, expect, it, vi } from "vitest";
import { AsyncMediaConversionManager, readSpatialDerivative } from "./media-conversion.js";
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
