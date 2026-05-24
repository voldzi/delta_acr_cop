import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import type { MediaObjectReadRequest, MediaObjectWriteRequest, MediaStorage, MediaUploadRequest, MediaUploadSlot } from "./media-storage.js";

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
        hazardSeverity: "warning",
        validUntil: "2026-05-20T15:00:00Z",
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
              hazardSeverity: "warning",
              photoCount: 1,
              severity: "warning",
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

  it("keeps restricted community media private while report text remains visible", async () => {
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
        description: "Voda rychle stoupá, místo je průjezdné jen částečně.",
        hazardSeverity: "critical",
        location: {
          lat: 50.12,
          lon: 17.38,
          source: "manual"
        },
        title: "Povodeň u mostu",
        validUntil: "2026-05-20T18:00:00Z",
        visibility: "community"
      },
      url: "/api/v1/community/reports"
    });
    const report = createResponse.json() as { reportId: string };
    const body = Buffer.from("restricted-photo");
    const attachmentResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        byteSize: body.length,
        contentType: "image/jpeg",
        fileName: "bridge.jpg",
        kind: "photo",
        metadata: {
          access: {
            audience: "private"
          }
        }
      },
      url: `/api/v1/community/reports/${report.reportId}/attachments`
    });
    const attachment = (attachmentResponse.json() as { attachment: { attachmentId: string } }).attachment;
    await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        byteSize: body.length,
        dataBase64: body.toString("base64")
      },
      url: `/api/v1/community/reports/${report.reportId}/attachments/${attachment.attachmentId}/upload`
    });
    await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      url: `/api/v1/community/reports/${report.reportId}/submit`
    });

    const anonymousListResponse = await app.inject({
      method: "GET",
      url: "/api/v1/community/reports?bbox=16.9,49.8,17.8,50.4"
    });
    expect(anonymousListResponse.statusCode).toBe(200);
    expect(anonymousListResponse.json()).toMatchObject({
      featureCollection: {
        features: [
          {
            properties: {
              attachments: [
                {
                  access: {
                    audience: "private"
                  },
                  accessDenied: true,
                  attachmentId: attachment.attachmentId,
                  kind: "photo"
                }
              ],
              description: "Voda rychle stoupá, místo je průjezdné jen částečně.",
              hazardSeverity: "critical",
              label: "Povodeň u mostu"
            }
          }
        ]
      }
    });
    const anonymousAttachment = anonymousListResponse.json().featureCollection.features[0].properties.attachments[0];
    expect(anonymousAttachment.contentUrl).toBeUndefined();

    const contentResponse = await app.inject({
      method: "GET",
      url: `/api/v1/community/reports/${report.reportId}/attachments/${attachment.attachmentId}/content`
    });
    expect(contentResponse.statusCode).toBe(404);

    await app.close();
  });

  it("creates community sharing groups and lets the owner manage members", async () => {
    const app = buildServer({
      mediaStorage: new FakeMediaStorage(),
      now: () => new Date("2026-05-20T12:00:00Z")
    });

    const createResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        name: "Povodně Vrbno",
        visibility: "private"
      },
      url: "/api/v1/community/groups"
    });
    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json()).toMatchObject({
      members: [
        {
          role: "owner",
          status: "active",
          subjectId: "lab"
        }
      ],
      name: "Povodně Vrbno",
      visibility: "private"
    });
    const group = createResponse.json() as { groupId: string };

    const memberResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        displayName: "Terénní hlídka",
        role: "member",
        status: "active",
        subjectId: "user-123"
      },
      url: `/api/v1/community/groups/${group.groupId}/members`
    });
    expect(memberResponse.statusCode).toBe(200);
    expect(memberResponse.json()).toMatchObject({
      members: expect.arrayContaining([
        expect.objectContaining({
          displayName: "Terénní hlídka",
          role: "member",
          status: "active",
          subjectId: "user-123"
        })
      ])
    });

    const listResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/community/groups"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({
      items: [
        {
          groupId: group.groupId,
          name: "Povodně Vrbno"
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

  it("uploads video and document attachments through the API proxy", async () => {
    const mediaStorage = new FakeMediaStorage();
    const app = buildServer({
      mediaStorage,
      now: () => new Date("2026-05-20T12:00:00Z")
    });

    const createResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        category: "bridge_damage",
        location: {
          lat: 50.075,
          lon: 14.438,
          source: "manual"
        },
        title: "Poškození mostu",
        visibility: "community"
      },
      url: "/api/v1/community/reports"
    });
    const report = createResponse.json() as { reportId: string };
    const body = Buffer.from("fake-video-data");
    const attachmentResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        byteSize: body.length,
        captureLocation: {
          lat: 50.075,
          lon: 14.438,
          source: "manual"
        },
        contentType: "video/mp4",
        fileName: "bridge.mp4",
        kind: "video",
        metadata: {
          spatialVideo: {
            browserPlayback: "webxr_stereo",
            mode: "side_by_side",
            source: "user_declared",
            stereoLayout: "side_by_side",
            storage: "original"
          }
        }
      },
      url: `/api/v1/community/reports/${report.reportId}/attachments`
    });
    const attachment = (attachmentResponse.json() as { attachment: { attachmentId: string } }).attachment;
    const uploadResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        byteSize: body.length,
        dataBase64: body.toString("base64")
      },
      url: `/api/v1/community/reports/${report.reportId}/attachments/${attachment.attachmentId}/upload`
    });

    expect(uploadResponse.statusCode).toBe(200);
    expect(uploadResponse.json()).toMatchObject({
      contentType: "video/mp4",
      contentUrl: `/api/v1/community/reports/${report.reportId}/attachments/${attachment.attachmentId}/content`,
      kind: "video",
      metadata: {
        spatialVideo: {
          mode: "side_by_side",
          stereoLayout: "side_by_side"
        }
      },
      status: "uploaded"
    });
    expect(mediaStorage.objects.get(`community-reports/${report.reportId}/${attachment.attachmentId}/bridge.mp4`)?.toString()).toBe("fake-video-data");

    const submitResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      url: `/api/v1/community/reports/${report.reportId}/submit`
    });
    expect(submitResponse.statusCode).toBe(200);

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
              attachments: [
                {
                  contentUrl: `/api/v1/community/reports/${report.reportId}/attachments/${attachment.attachmentId}/content`,
                  kind: "video",
                  metadata: {
                    spatialVideo: {
                      mode: "side_by_side",
                      stereoLayout: "side_by_side"
                    }
                  }
                }
              ],
              videoCount: 1
            }
          }
        ]
      }
    });

    await app.close();
  });
});

class FakeMediaStorage implements MediaStorage {
  readonly name = "fake-media";
  readonly objects = new Map<string, Buffer>();

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

  async createReadUrl(request: MediaObjectReadRequest): Promise<string> {
    return `https://media.example.test/read/${encodeURIComponent(request.objectKey)}`;
  }

  async putObject(request: MediaObjectWriteRequest): Promise<void> {
    this.objects.set(request.objectKey, request.body);
  }
}
