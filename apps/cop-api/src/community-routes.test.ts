import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import type { MediaStorage, MediaUploadRequest, MediaUploadSlot } from "./media-storage.js";

describe("community report routes", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("creates, submits and lists community reports as map features", async () => {
    const app = buildServer({
      mediaStorage: new FakeMediaStorage(),
      now: () => new Date("2026-05-20T12:00:00Z")
    });

    const createResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        category: "fire",
        description: "Kouř u lesa.",
        location: {
          accuracyM: 8,
          lat: 50.075,
          lon: 14.438,
          source: "device"
        },
        observedAt: "2026-05-20T11:59:30Z",
        title: "Požár u cesty",
        visibility: "community"
      },
      url: "/api/v1/community/reports"
    });

    expect(createResponse.statusCode).toBe(201);
    const report = createResponse.json() as { reportId: string };
    expect(report.reportId).toMatch(/^[0-9a-f-]{36}$/iu);

    const attachmentResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        byteSize: 123456,
        captureLocation: {
          accuracyM: 8,
          lat: 50.075,
          lon: 14.438,
          source: "photo_exif"
        },
        contentType: "image/jpeg",
        fileName: "fire.jpg",
        kind: "photo"
      },
      url: `/api/v1/community/reports/${report.reportId}/attachments`
    });

    expect(attachmentResponse.statusCode).toBe(201);
    expect(attachmentResponse.json()).toMatchObject({
      attachment: {
        byteSize: 123456,
        contentType: "image/jpeg",
        kind: "photo",
        reportId: report.reportId,
        status: "pending_upload"
      },
      upload: {
        bucket: "cop-community-media",
        method: "PUT"
      }
    });

    const attachment = (attachmentResponse.json() as { attachment: { attachmentId: string } }).attachment;
    const completeResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        byteSize: 123456
      },
      url: `/api/v1/community/reports/${report.reportId}/attachments/${attachment.attachmentId}/complete`
    });
    expect(completeResponse.statusCode).toBe(200);
    expect(completeResponse.json()).toMatchObject({ status: "uploaded" });

    const submitResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      url: `/api/v1/community/reports/${report.reportId}/submit`
    });
    expect(submitResponse.statusCode).toBe(200);
    expect(submitResponse.json()).toMatchObject({
      attachments: [
        {
          status: "uploaded"
        }
      ],
      status: "submitted"
    });

    const listResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/community/reports?bbox=14.0,49.8,14.8,50.3"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({
      featureCollection: {
        features: [
          {
            properties: {
              attachmentCount: 1,
              category: "fire",
              label: "Požár u cesty",
              photoCount: 1,
              severity: "critical",
              sourceId: "community_reports"
            }
          }
        ],
        summary: {
          featureCount: 1,
          uploadedAttachmentCount: 1
        }
      },
      items: [
        {
          reportId: report.reportId,
          status: "submitted"
        }
      ]
    });

    await app.close();
  });

  it("lists submitted community reports for anonymous public map reads", async () => {
    process.env.COP_PUBLIC_READ_ENABLED = "true";
    const app = buildServer({
      mediaStorage: new FakeMediaStorage(),
      now: () => new Date("2026-05-20T12:00:00Z")
    });

    const createResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        category: "flood",
        location: {
          lat: 50.075,
          lon: 14.438,
          source: "device"
        },
        title: "Zaplavený podjezd",
        visibility: "community"
      },
      url: "/api/v1/community/reports"
    });
    const report = createResponse.json() as { reportId: string };
    await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      url: `/api/v1/community/reports/${report.reportId}/submit`
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/v1/community/reports?bbox=14.0,49.8,14.8,50.3"
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({
      featureCollection: {
        summary: {
          featureCount: 1
        }
      },
      items: [
        {
          reportId: report.reportId,
          status: "submitted"
        }
      ]
    });

    await app.close();
  });

  it("rejects invalid report payloads", async () => {
    const app = buildServer({ mediaStorage: new FakeMediaStorage() });

    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        category: "fire"
      },
      url: "/api/v1/community/reports"
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});

class FakeMediaStorage implements MediaStorage {
  readonly name = "fake-media";

  async init(): Promise<void> {}

  async close(): Promise<void> {}

  async createUploadSlot(request: MediaUploadRequest, now: Date): Promise<MediaUploadSlot> {
    return {
      bucket: "cop-community-media",
      expiresAt: new Date(now.getTime() + 900000).toISOString(),
      headers: {
        "content-type": request.contentType
      },
      method: "PUT",
      objectKey: `community-reports/${request.reportId}/${request.attachmentId}/${request.fileName ?? "attachment.bin"}`,
      uploadUrl: `https://media.example.test/${request.reportId}/${request.attachmentId}`
    };
  }
}
