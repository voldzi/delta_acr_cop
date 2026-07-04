import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { AiGateway, OllamaEmbeddingProvider, type AiCopQuery, type AiProvider } from "@cop/ai-gateway";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryCommunityReportStore } from "./community-report-store.js";
import { buildServer } from "./server.js";
import type { MediaObjectReadRequest, MediaObjectWriteRequest, MediaStorage, MediaUploadRequest, MediaUploadSlot } from "./media-storage.js";
import type { MessagingProvider } from "./messaging-provider.js";
import { InMemoryUserProfileStore } from "./user-profile-store.js";

describe("community report routes", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it("issues short-lived media tickets so authorized group media can open without bearer headers", async () => {
    process.env.COP_PUBLIC_READ_ENABLED = "true";
    process.env.COP_MEDIA_ACCESS_TOKEN_SECRET = "test-media-ticket-secret";
    const mediaStorage = new FakeMediaStorage();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.startsWith("https://media.example.test/read/")) {
        return new Response(null, { status: 404 });
      }
      const objectKey = decodeURIComponent(url.slice("https://media.example.test/read/".length));
      const body = mediaStorage.objects.get(objectKey);
      return body
        ? new Response(new Uint8Array(body), {
            headers: {
              "accept-ranges": "bytes",
              "content-length": String(body.length),
              "content-type": "image/jpeg"
            },
            status: 200
          })
        : new Response(null, { status: 404 });
    }));
    const app = buildServer({
      mediaStorage,
      now: () => new Date("2026-05-20T12:00:00Z")
    });

    const groupResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        name: "Kyjev",
        visibility: "private"
      },
      url: "/api/v1/community/groups"
    });
    const group = groupResponse.json() as { groupId: string; name: string };
    const createResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        category: "hazard",
        groupId: group.groupId,
        groupName: group.name,
        location: {
          lat: 50.075,
          lon: 14.438,
          source: "manual"
        },
        title: "Sdílené foto",
        visibility: "community"
      },
      url: "/api/v1/community/reports"
    });
    const report = createResponse.json() as { reportId: string };
    const body = Buffer.from("group-photo");
    const attachmentResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        byteSize: body.length,
        contentType: "image/jpeg",
        fileName: "kyjev.jpg",
        kind: "photo",
        metadata: {
          access: {
            audience: "groups",
            groupIds: [group.groupId]
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
      url: "/api/v1/community/reports?bbox=14.0,49.8,14.8,50.3"
    });
    expect(anonymousListResponse.json().featureCollection.features[0].properties.attachments[0]).toMatchObject({
      accessDenied: true,
      attachmentId: attachment.attachmentId
    });
    expect(anonymousListResponse.json().featureCollection.features[0].properties.attachments[0].contentUrl).toBeUndefined();

    const authorizedListResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/community/reports?bbox=14.0,49.8,14.8,50.3"
    });
    const authorizedAttachment = authorizedListResponse.json().featureCollection.features[0].properties.attachments[0];
    expect(authorizedAttachment.contentUrl).toContain("mediaToken=");

    const contentWithoutBearer = await app.inject({
      method: "GET",
      url: authorizedAttachment.contentUrl
    });
    expect(contentWithoutBearer.statusCode).toBe(200);
    expect(contentWithoutBearer.body).toBe("group-photo");

    const contentWithoutTicket = await app.inject({
      method: "GET",
      url: `/api/v1/community/reports/${report.reportId}/attachments/${attachment.attachmentId}/content`
    });
    expect(contentWithoutTicket.statusCode).toBe(404);

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

    const metadataResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "PATCH",
      payload: {
        metadata: {
          chat: {
            conversationId: "conv_group_1",
            encrypted: true,
            matrixRoomId: "!group1:docker.home.cz",
            source: "cop-chat"
          }
        }
      },
      url: `/api/v1/community/groups/${group.groupId}/metadata`
    });
    expect(metadataResponse.statusCode).toBe(200);
    expect(metadataResponse.json()).toMatchObject({
      metadata: {
        chat: {
          conversationId: "conv_group_1",
          matrixRoomId: "!group1:docker.home.cz",
          source: "cop-chat"
        }
      }
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
          metadata: {
            chat: {
              conversationId: "conv_group_1",
              matrixRoomId: "!group1:docker.home.cz"
            }
          },
          name: "Povodně Vrbno"
        }
      ]
    });

    const deleteResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "DELETE",
      url: `/api/v1/community/groups/${group.groupId}`
    });
    expect(deleteResponse.statusCode).toBe(204);

    const readDeletedResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: `/api/v1/community/groups/${group.groupId}`
    });
    expect(readDeletedResponse.statusCode).toBe(404);

    const listAfterDeleteResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/community/groups"
    });
    expect(listAfterDeleteResponse.statusCode).toBe(200);
    expect(listAfterDeleteResponse.json()).toMatchObject({ items: [] });

    await app.close();
  });

  it("lets a member leave a community sharing group without orphaning group management", async () => {
    const issuer = "https://login.zeleznalady.cz/realms/cop-community-leave-test";
    const keyId = "cop-community-leave-test-key";
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicJwk = {
      ...publicKey.export({ format: "jwk" }),
      alg: "RS256",
      kid: keyId,
      use: "sig"
    };
    process.env.COP_AUTH_MODE = "hybrid";
    process.env.COP_OIDC_ISSUER = issuer;
    process.env.COP_OIDC_ALLOWED_CLIENTS = "cop-web";
    process.env.COP_OIDC_REQUIRED_ROLE = "cop_operator";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ keys: [publicJwk] })));
    const issuedAt = Math.floor(Date.now() / 1000);
    const fieldToken = signJwt(privateKey, keyId, {
      azp: "cop-web",
      email: "field.operator@example.test",
      exp: issuedAt + 300,
      iat: issuedAt,
      iss: issuer,
      name: "Field Operator",
      preferred_username: "field.operator",
      realm_access: {
        roles: ["cop_operator"]
      },
      sub: "subject-field-operator"
    });
    const app = buildServer({
      mediaStorage: new FakeMediaStorage(),
      now: () => new Date("2026-05-20T12:00:00Z")
    });

    const createResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        name: "Leave test group",
        visibility: "private"
      },
      url: "/api/v1/community/groups"
    });
    const group = createResponse.json() as { groupId: string };

    const memberResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        displayName: "Field Operator",
        role: "member",
        status: "active",
        subjectId: "subject-field-operator",
        username: "field.operator"
      },
      url: `/api/v1/community/groups/${group.groupId}/members`
    });
    expect(memberResponse.statusCode).toBe(200);

    const ownerLeaveResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "DELETE",
      url: `/api/v1/community/groups/${group.groupId}/members/me`
    });
    expect(ownerLeaveResponse.statusCode).toBe(409);

    const leaveResponse = await app.inject({
      headers: { authorization: `Bearer ${fieldToken}` },
      method: "DELETE",
      url: `/api/v1/community/groups/${group.groupId}/members/me`
    });
    expect(leaveResponse.statusCode).toBe(200);
    expect(leaveResponse.json()).toMatchObject({
      members: expect.arrayContaining([
        expect.objectContaining({
          status: "left",
          subjectId: "subject-field-operator"
        })
      ])
    });

    const listAsFormerMemberResponse = await app.inject({
      headers: { authorization: `Bearer ${fieldToken}` },
      method: "GET",
      url: "/api/v1/community/groups"
    });
    expect(listAsFormerMemberResponse.statusCode).toBe(200);
    expect(listAsFormerMemberResponse.json()).toMatchObject({ items: [] });

    const readAsFormerMemberResponse = await app.inject({
      headers: { authorization: `Bearer ${fieldToken}` },
      method: "GET",
      url: `/api/v1/community/groups/${group.groupId}`
    });
    expect(readAsFormerMemberResponse.statusCode).toBe(404);

    const readAsOwnerResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: `/api/v1/community/groups/${group.groupId}`
    });
    expect(readAsOwnerResponse.statusCode).toBe(200);
    expect(readAsOwnerResponse.json()).toMatchObject({
      members: expect.arrayContaining([
        expect.objectContaining({
          status: "left",
          subjectId: "subject-field-operator"
        })
      ])
    });

    await app.close();
  });

  it("lets a manager remove a member from a community sharing group", async () => {
    const issuer = "https://login.zeleznalady.cz/realms/cop-community-remove-member-test";
    const keyId = "cop-community-remove-member-test-key";
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicJwk = {
      ...publicKey.export({ format: "jwk" }),
      alg: "RS256",
      kid: keyId,
      use: "sig"
    };
    process.env.COP_AUTH_MODE = "hybrid";
    process.env.COP_OIDC_ISSUER = issuer;
    process.env.COP_OIDC_ALLOWED_CLIENTS = "cop-web";
    process.env.COP_OIDC_REQUIRED_ROLE = "cop_operator";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ keys: [publicJwk] })));
    const issuedAt = Math.floor(Date.now() / 1000);
    const fieldToken = signJwt(privateKey, keyId, {
      azp: "cop-web",
      email: "removed.operator@example.test",
      exp: issuedAt + 300,
      iat: issuedAt,
      iss: issuer,
      name: "Removed Operator",
      preferred_username: "removed.operator",
      realm_access: {
        roles: ["cop_operator"]
      },
      sub: "subject-removed-operator"
    });
    const app = buildServer({
      mediaStorage: new FakeMediaStorage(),
      now: () => new Date("2026-05-20T12:00:00Z")
    });

    const createResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        name: "Remove member test group",
        visibility: "private"
      },
      url: "/api/v1/community/groups"
    });
    const group = createResponse.json() as { groupId: string };

    const addResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        displayName: "Removed Operator",
        role: "member",
        status: "active",
        subjectId: "subject-removed-operator",
        username: "removed.operator"
      },
      url: `/api/v1/community/groups/${group.groupId}/members`
    });
    expect(addResponse.statusCode).toBe(200);

    const removeResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "DELETE",
      url: `/api/v1/community/groups/${group.groupId}/members/subject-removed-operator`
    });
    expect(removeResponse.statusCode).toBe(200);
    expect(removeResponse.json()).toMatchObject({
      members: expect.arrayContaining([
        expect.objectContaining({
          status: "left",
          subjectId: "subject-removed-operator"
        })
      ])
    });

    const listAsRemovedMemberResponse = await app.inject({
      headers: { authorization: `Bearer ${fieldToken}` },
      method: "GET",
      url: "/api/v1/community/groups"
    });
    expect(listAsRemovedMemberResponse.statusCode).toBe(200);
    expect(listAsRemovedMemberResponse.json()).toMatchObject({ items: [] });

    const removeOwnerResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "DELETE",
      url: `/api/v1/community/groups/${group.groupId}/members/lab`
    });
    expect(removeOwnerResponse.statusCode).toBe(409);

    await app.close();
  });

  it("answers AI chat agent questions with group-scoped COP context", async () => {
    const capturedQueries: AiCopQuery[] = [];
    const aiProvider: AiProvider = {
      available: true,
      id: "mock",
      model: "test-cop-ai-provider",
      async execute(query) {
        capturedQueries.push(query);
        return {
          summary: "Captured COP assistant response",
          structured: {
            purpose: query.purpose
          }
        };
      },
      async health() {
        return {
          detail: "test provider",
          status: "ok"
        };
      }
    };
    const communityReportStore = new InMemoryCommunityReportStore("ai-chat-agent-test");
    const app = buildServer({
      aiGateway: new AiGateway(new Map([["mock", aiProvider]]), {
        defaultProvider: "mock",
        embeddingProvider: new FakeEmbeddingProvider()
      }),
      communityReportStore,
      now: () => new Date("2026-05-20T12:00:00Z")
    });
    const floodReport = await communityReportStore.createReport({
      category: "flood",
      createdBy: {
        displayName: "Lab",
        subjectId: "lab",
        username: "lab"
      },
      description: "Hladina řeky rychle stoupá u mostu.",
      location: {
        accuracyM: 8,
        lat: 50.1,
        lon: 17.2,
        source: "device"
      },
      observedAt: "2026-05-20T11:58:00.000Z",
      properties: {
        hazardSeverity: "warning"
      },
      title: "Stoupající hladina",
      visibility: "public"
    }, new Date("2026-05-20T11:59:00.000Z"));
    await communityReportStore.submitReport(floodReport.reportId, "lab", new Date("2026-05-20T12:00:00.000Z"));

    const createResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        name: "AI skupina",
        visibility: "public"
      },
      url: "/api/v1/community/groups"
    });
    expect(createResponse.statusCode).toBe(201);
    const group = createResponse.json() as { groupId: string };

    const disabledResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        chatContext: {
          encrypted: true,
          messages: [
            {
              body: "Ve Vrbně hlásí dobrovolníci stoupající hladinu u mostu.",
              eventId: "$chat-1",
              kind: "text",
              own: false,
              senderDisplayName: "Jiří Volek",
              timestamp: "2026-05-20T11:55:00.000Z"
            },
            {
              ai: {
                auditId: "audit-previous",
                provider: "mock",
                status: "COMPLETED",
                type: "chat-agent"
              },
              body: "COP AI agent\nDotaz: Stav?\n\nPředchozí odpověď.",
              eventId: "$chat-ai",
              kind: "text",
              own: true,
              timestamp: "2026-05-20T11:56:00.000Z"
            }
          ],
          roomId: "!group1:docker.home.cz",
          source: "browser-visible-decrypted-timeline",
          visibleMessageCount: 2
        },
        groupId: group.groupId,
        question: "Co je v COP kontextu nejisté?"
      },
      url: "/api/v1/ai/chat-agent/query"
    });
    expect(disabledResponse.statusCode).toBe(409);

    const metadataResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "PATCH",
      payload: {
        metadata: {
          chat: {
            aiAssistant: {
              consent: {
                granted: true,
                grantedAt: "2026-05-20T12:00:00.000Z",
                grantedBy: "lab",
                scope: "matrix-room-member",
                termsVersion: "cop-ai-room-agent-consent-v1"
              },
              enabled: true,
              label: "COP AI Assistant",
              mode: "cop-context",
              updatedAt: "2026-05-20T12:00:00.000Z"
            }
          }
        }
      },
      url: `/api/v1/community/groups/${group.groupId}/metadata`
    });
    expect(metadataResponse.statusCode).toBe(200);

    const queryResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        groupId: group.groupId,
        question: "Co je v COP kontextu nejisté?"
      },
      url: "/api/v1/ai/chat-agent/query"
    });
    expect(queryResponse.statusCode).toBe(200);
    const queryBody = queryResponse.json();
    expect(queryResponse.json()).toMatchObject({
      policy: {
        allowed: true
      },
      provider: "mock",
      status: "COMPLETED"
    });
    expect(queryBody.result.summary).toContain("Captured COP assistant response");
    expect(queryBody.result.structured.evidence).toMatchObject({
      contractVersion: "cop-ai-response-evidence-v1",
      indexed: {
        toolCall: {
          toolId: "cop.ai.context_index.query"
        }
      },
      priority: {
        citations: expect.arrayContaining([
          expect.objectContaining({
            citationId: "P1",
            entityId: floodReport.reportId,
            entityType: "communityReport"
          })
        ])
      }
    });
    expect(capturedQueries).toHaveLength(1);
    expect(capturedQueries[0]?.prompt).toContain("priorityContext");
    expect(capturedQueries[0]?.prompt).toContain("indexedContext");
    const priorityContext = capturedQueries[0]?.context?.priorityContext as Record<string, unknown> | undefined;
    expect(priorityContext).toMatchObject({
      contractVersion: "cop-ai-priority-context-v1"
    });
    expect(priorityContext?.citations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityId: floodReport.reportId,
        entityType: "communityReport"
      })
    ]));
    expect(priorityContext?.mapSnapshot).toMatchObject({
      contractVersion: "cop-ai-map-snapshot-candidates-v1",
      candidates: expect.arrayContaining([
        expect.objectContaining({
          entityId: floodReport.reportId,
          location: {
            lat: 50.1,
            lon: 17.2
          }
        })
      ])
    });
    const indexedContext = capturedQueries[0]?.context?.indexedContext as Record<string, unknown> | undefined;
    expect(indexedContext).toMatchObject({
      contractVersion: "cop-ai-indexed-context-v1",
      toolCall: {
        matchedDocumentCount: expect.any(Number),
        mode: "read_only",
        toolId: "cop.ai.context_index.query"
      }
    });
    expect(indexedContext?.citations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        citationId: "I1"
      })
    ]));
    const indexedSemanticContext = indexedContext?.semanticContext as Record<string, unknown> | undefined;
    expect(indexedSemanticContext?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityId: floodReport.reportId,
        entityType: "communityReport"
      })
    ]));
    const auditResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      url: "/api/v1/audit/events"
    });
    const auditItems = auditResponse.json().items as Array<Record<string, unknown>>;
    const indexToolAudit = auditItems.find((item) => item.eventType === "AI_CONTEXT_INDEX_TOOL_INVOKED");
    expect(indexToolAudit).toMatchObject({
      requestId: queryBody.requestId,
      toolId: "cop.ai.context_index.query",
      matchedDocumentCount: expect.any(Number)
    });
    const aiAudit = auditItems.find((item) => item.eventType === "AI_CHAT_AGENT_COMPLETED");
    expect(aiAudit).toMatchObject({
      indexedDocumentCount: expect.any(Number),
      indexedToolInvocationId: expect.any(String),
      semanticDocumentCount: expect.any(Number)
    });
    expect(["degraded", "disabled", "ok"]).toContain(aiAudit?.indexedStatus);
    expect(["degraded", "disabled", "ok"]).toContain(aiAudit?.semanticStatus);

    const emptyQuestionResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        question: " "
      },
      url: "/api/v1/ai/chat-agent/query"
    });
    expect(emptyQuestionResponse.statusCode).toBe(400);

    const forbiddenResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        groupId: "77777777-7777-4777-8777-777777777777",
        question: "Stav?"
      },
      url: "/api/v1/ai/chat-agent/query"
    });
    expect(forbiddenResponse.statusCode).toBe(403);

    await app.close();
  });

  it("provisions the AI Matrix bot as an explicit E2EE room member after consent", async () => {
    vi.stubEnv("COP_AI_MATRIX_BOT_USER_ID", "cop.ai.agent");
    vi.stubEnv("COP_AI_MATRIX_BOT_DISPLAY_NAME", "COP AI Assistant");
    vi.stubEnv("COP_AI_MATRIX_BOT_DEVICE_ID", "COP.AI.Agent");
    const addConversationMembers = vi.fn(async (_actor, _requestNow, conversationId, members) => ({
      contractVersion: "cop-messaging-conversations-v1" as const,
      conversation: {
        conversationId,
        encrypted: true,
        e2eeRequired: true,
        matrix: {
          roomId: "!room:docker.home.cz",
          state: "room_bound"
        },
        members: [
          { displayName: "Lab", userId: "lab" },
          ...members
        ],
        metadata: {
          externalId: "community-group-1",
          source: "cop.community"
        },
        title: "AI skupina",
        type: "group" as const
      },
      enabled: true,
      providerId: "csm.messaging" as const,
      status: "online" as const,
      warnings: []
    }));
    const fetchMatrixBootstrap = vi.fn(async (actor, _requestNow, deviceId) => ({
      accessToken: "bot-matrix-token",
      chatAvailable: true,
      contractVersion: "cop-messaging-bootstrap-v1" as const,
      deviceId,
      e2eeRequired: true,
      enabled: true,
      homeserverBaseUrl: "https://msg.test",
      providerId: "csm.messaging" as const,
      serverName: "docker.home.cz",
      status: "online" as const,
      tokenAvailable: true,
      userId: `@${actor.subjectId}:docker.home.cz`,
      warnings: []
    }));
    const messagingProvider = {
      addConversationMembers,
      bindMatrixRoom: vi.fn(),
      config: {
        baseUrl: "http://messaging.local:4050",
        cacheTtlMs: 10000,
        enabled: true,
        timeoutMs: 3000
      },
      createConversation: vi.fn(),
      deleteWebPushDevice: vi.fn(),
      fetchConversation: vi.fn(),
      fetchConversationByRoomId: vi.fn(),
      fetchConversations: vi.fn(),
      fetchMatrixBootstrap,
      fetchStatus: vi.fn(),
      fetchWebPushConfig: vi.fn(),
      registerWebPushDevice: vi.fn(),
      resolveMatrixIdentities: vi.fn(),
      sendNotification: vi.fn()
    } as unknown as MessagingProvider;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://msg.test/_matrix/client/v3/join/!room%3Adocker.home.cz");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer bot-matrix-token"
      });
      return new Response(JSON.stringify({ room_id: "!room:docker.home.cz" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer({
      messagingProvider,
      now: () => new Date("2026-05-20T12:00:00Z")
    });

    const createResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        metadata: {
          chat: {
            conversationId: "conv_1",
            encrypted: true,
            matrixRoomId: "!room:docker.home.cz",
            source: "cop-chat"
          }
        },
        name: "AI skupina",
        visibility: "public"
      },
      url: "/api/v1/community/groups"
    });
    expect(createResponse.statusCode).toBe(201);
    const group = createResponse.json() as { groupId: string };

    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "PATCH",
      payload: {
        metadata: {
          chat: {
            conversationId: "conv_1",
            encrypted: true,
            matrixRoomId: "!room:docker.home.cz",
            source: "cop-chat",
            aiAssistant: {
              consent: {
                granted: true,
                grantedAt: "2026-05-20T12:00:00.000Z",
                grantedBy: "lab",
                scope: "matrix-room-member",
                termsVersion: "cop-ai-room-agent-consent-v1"
              },
              enabled: true,
              label: "COP AI Assistant",
              mode: "cop-context",
              updatedAt: "2026-05-20T12:00:00.000Z"
            }
          }
        }
      },
      url: `/api/v1/community/groups/${group.groupId}/metadata`
    });

    expect(response.statusCode).toBe(200);
    expect(addConversationMembers).toHaveBeenCalledWith(
      expect.objectContaining({ subjectId: "lab" }),
      new Date("2026-05-20T12:00:00Z"),
      "conv_1",
      [{ displayName: "COP AI Assistant", role: "bot", userId: "cop.ai.agent" }]
    );
    expect(fetchMatrixBootstrap).toHaveBeenCalledWith(
      expect.objectContaining({ subjectId: "cop.ai.agent" }),
      new Date("2026-05-20T12:00:00Z"),
      "COP.AI.Agent"
    );
    expect(response.json()).toMatchObject({
      metadata: {
        chat: {
          aiAssistant: {
            e2ee: {
              keyModel: "dedicated_matrix_account_device",
              plaintextProxy: false,
              roomKeyPolicy: "future_megolm_sessions_after_join",
              serverReadsHistory: false,
              status: "ready_for_future_messages"
            },
            matrixBot: {
              matrixUserId: "@cop.ai.agent:docker.home.cz",
              membership: "join",
              roomId: "!room:docker.home.cz",
              status: "joined",
              userId: "cop.ai.agent"
            }
          }
        }
      }
    });
    expect(JSON.stringify(response.json())).not.toContain("bot-matrix-token");
    await app.close();
  });

  it("lets an OIDC owner delete legacy groups stored under preferred username", async () => {
    const issuer = "https://login.zeleznalady.cz/realms/cop-community-legacy-test";
    const keyId = "cop-community-legacy-test-key";
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicJwk = {
      ...publicKey.export({ format: "jwk" }),
      alg: "RS256",
      kid: keyId,
      use: "sig"
    };
    process.env.COP_AUTH_MODE = "oidc";
    process.env.COP_OIDC_ISSUER = issuer;
    process.env.COP_OIDC_ALLOWED_CLIENTS = "cop-web";
    process.env.COP_OIDC_REQUIRED_ROLE = "cop_operator";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ keys: [publicJwk] })));
    const now = Math.floor(Date.now() / 1000);
    const token = signJwt(privateKey, keyId, {
      azp: "cop-web",
      email: "cop.operator1@example.test",
      exp: now + 300,
      iat: now,
      iss: issuer,
      name: "COP Operator",
      preferred_username: "cop.operator1",
      realm_access: {
        roles: ["cop_operator"]
      },
      sub: "000dfd66-c95c-4f58-8c1a-c40bf40c7ef1"
    });
    const communityReportStore = new InMemoryCommunityReportStore();
    const legacyGroup = await communityReportStore.createGroup({
      createdBy: {
        displayName: "COP Operator",
        subjectId: "cop.operator1",
        username: "cop.operator1"
      },
      name: "Legacy test group",
      visibility: "private"
    }, new Date("2026-05-20T12:00:00Z"));
    const app = buildServer({
      communityReportStore,
      mediaStorage: new FakeMediaStorage(),
      now: () => new Date("2026-05-20T12:00:00Z")
    });

    const deleteResponse = await app.inject({
      headers: { authorization: `Bearer ${token}` },
      method: "DELETE",
      url: `/api/v1/community/groups/${legacyGroup.groupId}`
    });
    expect(deleteResponse.statusCode).toBe(204);
    expect(await communityReportStore.getGroup(legacyGroup.groupId)).toBeNull();

    await app.close();
  });

  it("seeds and resets the flood demo scenario without duplicate objects", async () => {
    const app = buildServer({
      mediaStorage: new FakeMediaStorage(),
      now: () => new Date("2026-05-20T12:00:00Z")
    });
    const headers = { authorization: "Bearer dev-lab-token" };

    const seedResponse = await app.inject({
      headers,
      method: "POST",
      url: "/api/v1/demo/scenarios/flood-central-bohemia/seed"
    });
    expect(seedResponse.statusCode).toBe(200);
    expect(seedResponse.json()).toMatchObject({
      operation: {
        createdAttachments: 6,
        createdDrawings: 3,
        createdGroups: 1,
        createdReports: 3
      },
      scenario: {
        demoScenarioId: "flood-central-bohemia",
        status: "ready",
        summary: {
          drawingCount: 3,
          groupCount: 1,
          reportCount: 3
        }
      }
    });

    const secondSeedResponse = await app.inject({
      headers,
      method: "POST",
      url: "/api/v1/demo/scenarios/flood-central-bohemia/seed"
    });
    expect(secondSeedResponse.statusCode).toBe(200);
    expect(secondSeedResponse.json()).toMatchObject({
      operation: {
        createdAttachments: 0,
        createdDrawings: 0,
        createdGroups: 0,
        createdReports: 0
      },
      scenario: {
        summary: {
          drawingCount: 3,
          groupCount: 1,
          reportCount: 3
        }
      }
    });

    const groupResponse = await app.inject({
      headers,
      method: "GET",
      url: "/api/v1/community/groups"
    });
    expect(groupResponse.statusCode).toBe(200);
    const demoGroup = (groupResponse.json() as { items: Array<{ metadata?: Record<string, unknown> }> }).items.find(
      (group) => group.metadata?.demoScenarioId === "flood-central-bohemia"
    );
    expect(demoGroup?.metadata?.demoConversation).toMatchObject({
      title: "Krizový štáb - Povodeň",
      messages: expect.arrayContaining([
        expect.objectContaining({
          body: expect.stringContaining("Aktualizace stavu hladiny")
        })
      ]),
      media: expect.arrayContaining([
        expect.objectContaining({
          kind: "photo",
          title: "IMG_4821.jpg"
        })
      ])
    });

    const reportResponse = await app.inject({
      headers,
      method: "GET",
      url: "/api/v1/community/reports?bbox=13.75,49.75,15.6,50.65"
    });
    expect(reportResponse.statusCode).toBe(200);
    const reportBody = reportResponse.json();
    expect(reportBody).toMatchObject({
      featureCollection: {
        features: expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({
              attachmentCount: 2,
              attachments: expect.arrayContaining([
                expect.objectContaining({
                  contentUrl: expect.stringMatching(/^data:image\/svg\+xml/),
                  kind: "photo",
                  metadata: expect.objectContaining({
                    demoPreviewUrl: expect.stringMatching(/^data:image\/svg\+xml/)
                  })
                })
              ]),
              groupName: "DEMO Povodeň - Středočeský kraj"
            })
          })
        ]),
        summary: {
          featureCount: 3
        }
      }
    });
    const attachmentCount = reportBody.featureCollection.features.reduce(
      (sum: number, feature: { properties: { attachments?: unknown[] } }) => sum + (feature.properties.attachments?.length ?? 0),
      0
    );
    expect(attachmentCount).toBe(6);

    const drawingResponse = await app.inject({
      headers,
      method: "GET",
      url: "/api/v1/sketch/drawings?bbox=13.75,49.75,15.6,50.65"
    });
    expect(drawingResponse.statusCode).toBe(200);
    expect(drawingResponse.json()).toMatchObject({
      summary: {
        featureCount: 3
      }
    });

    const resetResponse = await app.inject({
      headers,
      method: "POST",
      url: "/api/v1/demo/scenarios/flood-central-bohemia/reset"
    });
    expect(resetResponse.statusCode).toBe(200);
    expect(resetResponse.json()).toMatchObject({
      operation: {
        deletedDrawings: 3,
        deletedGroups: 1,
        deletedReports: 3
      },
      scenario: {
        status: "empty",
        summary: {
          drawingCount: 0,
          groupCount: 0,
          reportCount: 0
        }
      }
    });

    await app.close();
  });

  it("lets another authenticated PoC operator reset seeded flood demo objects", async () => {
    const issuer = "https://login.zeleznalady.cz/realms/cop-community-demo-reset-test";
    const keyId = "cop-community-demo-reset-test-key";
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicJwk = {
      ...publicKey.export({ format: "jwk" }),
      alg: "RS256",
      kid: keyId,
      use: "sig"
    };
    process.env.COP_AUTH_MODE = "hybrid";
    process.env.COP_OIDC_ISSUER = issuer;
    process.env.COP_OIDC_ALLOWED_CLIENTS = "cop-web";
    process.env.COP_OIDC_REQUIRED_ROLE = "cop_operator";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ keys: [publicJwk] })));
    const now = Math.floor(Date.now() / 1000);
    const operatorToken = signJwt(privateKey, keyId, {
      azp: "cop-web",
      email: "op.operator1@example.test",
      exp: now + 300,
      iat: now,
      iss: issuer,
      name: "PoC Operator 1",
      preferred_username: "op.operator1",
      realm_access: {
        roles: ["cop_operator"]
      },
      sub: "subject-op-operator1"
    });
    const app = buildServer({
      mediaStorage: new FakeMediaStorage(),
      now: () => new Date("2026-05-20T12:00:00Z")
    });

    const seedResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      url: "/api/v1/demo/scenarios/flood-central-bohemia/seed"
    });
    expect(seedResponse.statusCode).toBe(200);
    expect(seedResponse.json()).toMatchObject({
      scenario: {
        summary: {
          drawingCount: 3,
          groupCount: 1,
          reportCount: 3
        }
      }
    });

    const resetResponse = await app.inject({
      headers: { authorization: `Bearer ${operatorToken}` },
      method: "POST",
      url: "/api/v1/demo/scenarios/flood-central-bohemia/reset"
    });
    expect(resetResponse.statusCode).toBe(200);
    expect(resetResponse.json()).toMatchObject({
      operation: {
        deletedDrawings: 3,
        deletedGroups: 1,
        deletedReports: 3
      },
      scenario: {
        status: "empty",
        summary: {
          drawingCount: 0,
          groupCount: 0,
          reportCount: 0
        }
      }
    });

    await app.close();
  });

  it("adds known PoC operator profiles to the seeded flood demo group", async () => {
    const userProfileStore = new InMemoryUserProfileStore();
    await userProfileStore.upsertProfile({
      alertPreferences: {},
      displayName: "COP Operator",
      email: "cop.operator@example.test",
      preferences: {},
      subjectId: "subject-cop-operator",
      username: "cop.operator"
    });
    await userProfileStore.upsertProfile({
      alertPreferences: {},
      displayName: "PoC Operator 1",
      email: "op.operator1@example.test",
      preferences: {},
      subjectId: "subject-op-operator1",
      username: "op.operator1"
    });
    const app = buildServer({
      mediaStorage: new FakeMediaStorage(),
      now: () => new Date("2026-05-20T12:00:00Z"),
      userProfileStore
    });
    const headers = { authorization: "Bearer dev-lab-token" };

    const seedResponse = await app.inject({
      headers,
      method: "POST",
      url: "/api/v1/demo/scenarios/flood-central-bohemia/seed"
    });
    expect(seedResponse.statusCode).toBe(200);

    const groupResponse = await app.inject({
      headers,
      method: "GET",
      url: "/api/v1/community/groups"
    });
    expect(groupResponse.statusCode).toBe(200);
    const demoGroup = (groupResponse.json() as {
      items: Array<{
        members?: Array<{ status?: string; subjectId?: string }>;
        metadata?: Record<string, unknown>;
      }>;
    }).items.find((group) => group.metadata?.demoScenarioId === "flood-central-bohemia");
    expect(demoGroup?.members).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "active", subjectId: "subject-cop-operator" }),
      expect.objectContaining({ status: "active", subjectId: "subject-op-operator1" })
    ]));

    await app.close();
  });

  it("resolves community group members through the COP user profile directory", async () => {
    const userProfileStore = new InMemoryUserProfileStore();
    await userProfileStore.upsertProfile({
      alertPreferences: {},
      displayName: "COP Operator 1",
      email: "operator1@example.test",
      preferences: {},
      subjectId: "000dfd66-0000-4000-8000-000000007ef1",
      username: "cop.operator1"
    });
    const app = buildServer({
      mediaStorage: new FakeMediaStorage(),
      now: () => new Date("2026-05-20T12:00:00Z"),
      userProfileStore
    });

    const searchResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/users/search?q=cop.operator1"
    });
    expect(searchResponse.statusCode).toBe(200);
    expect(searchResponse.json()).toMatchObject({
      items: [
        {
          displayName: "COP Operator 1",
          subjectId: "000dfd66-0000-4000-8000-000000007ef1",
          username: "cop.operator1"
        }
      ]
    });

    const createResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        name: "COP",
        visibility: "private"
      },
      url: "/api/v1/community/groups"
    });
    const group = createResponse.json() as { groupId: string };

    const memberResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        role: "member",
        status: "active",
        subjectId: "cop.operator1",
        username: "cop.operator1"
      },
      url: `/api/v1/community/groups/${group.groupId}/members`
    });
    expect(memberResponse.statusCode).toBe(200);
    expect(memberResponse.json()).toMatchObject({
      members: expect.arrayContaining([
        expect.objectContaining({
          displayName: "COP Operator 1",
          role: "member",
          status: "active",
          subjectId: "000dfd66-0000-4000-8000-000000007ef1",
          username: "cop.operator1"
        })
      ])
    });

    const unknownMemberResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        subjectId: "missing.operator",
        username: "missing.operator"
      },
      url: `/api/v1/community/groups/${group.groupId}/members`
    });
    expect(unknownMemberResponse.statusCode).toBe(400);

    await app.close();
  });

  it("links reports to groups and lets the author edit and delete the report", async () => {
    const app = buildServer({
      mediaStorage: new FakeMediaStorage(),
      now: () => new Date("2026-05-20T12:00:00Z")
    });

    const groupResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        anchorLocation: {
          lat: 50.11,
          lon: 17.38,
          source: "manual"
        },
        name: "Povodně Vrbno",
        visibility: "private"
      },
      url: "/api/v1/community/groups"
    });
    expect(groupResponse.statusCode).toBe(201);
    expect(groupResponse.json()).toMatchObject({
      anchorLocation: {
        lat: 50.11,
        lon: 17.38
      },
      name: "Povodně Vrbno"
    });
    const group = groupResponse.json() as { groupId: string; name: string };

    const createResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        category: "flood",
        groupId: group.groupId,
        groupName: group.name,
        hazardSeverity: "critical",
        location: {
          lat: 50.12,
          lon: 17.39,
          source: "manual"
        },
        title: "Zaplavený most",
        visibility: "community"
      },
      url: "/api/v1/community/reports"
    });
    expect(createResponse.statusCode).toBe(201);
    const report = createResponse.json() as { reportId: string };

    const submitResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      url: `/api/v1/community/reports/${report.reportId}/submit`
    });
    expect(submitResponse.statusCode).toBe(200);

    const updateResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "PATCH",
      payload: {
        description: "Most je neprůjezdný, voda stoupá.",
        hazardSeverity: "warning",
        title: "Most neprůjezdný"
      },
      url: `/api/v1/community/reports/${report.reportId}`
    });
    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json()).toMatchObject({
      description: "Most je neprůjezdný, voda stoupá.",
      properties: {
        groupId: group.groupId,
        groupName: group.name,
        hazardSeverity: "warning"
      },
      title: "Most neprůjezdný"
    });

    const listResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/community/reports?bbox=17.0,49.8,17.8,50.4"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({
      featureCollection: {
        features: [
          {
            properties: {
              groupId: group.groupId,
              groupName: group.name,
              hazardSeverity: "warning",
              label: "Most neprůjezdný"
            }
          }
        ]
      }
    });

    const deleteResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "DELETE",
      url: `/api/v1/community/reports/${report.reportId}`
    });
    expect(deleteResponse.statusCode).toBe(204);

    const afterDeleteResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: `/api/v1/community/reports/${report.reportId}`
    });
    expect(afterDeleteResponse.statusCode).toBe(404);

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
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.startsWith("https://media.example.test/read/")) {
        return new Response(null, { status: 404 });
      }
      const objectKey = decodeURIComponent(url.slice("https://media.example.test/read/".length));
      const body = mediaStorage.objects.get(objectKey);
      return body
        ? new Response(new Uint8Array(body), {
            headers: {
              "accept-ranges": "bytes",
              "content-length": String(body.length),
              "content-type": "video/mp4"
            },
            status: 200
          })
        : new Response(null, { status: 404 });
    }));
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
        fileName: "svatba č. 2.mp4",
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
      kind: "video",
      metadata: {
        spatialVideo: {
          mode: "side_by_side",
          stereoLayout: "side_by_side"
        }
      },
      status: "uploaded"
    });
    expect(uploadResponse.json().contentUrl).toContain(`/api/v1/community/reports/${report.reportId}/attachments/${attachment.attachmentId}/content?mediaToken=`);
    expect(mediaStorage.objects.get(`community-reports/${report.reportId}/${attachment.attachmentId}/svatba č. 2.mp4`)?.toString()).toBe("fake-video-data");

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
    const listedContentUrl = listResponse.json().featureCollection.features[0].properties.attachments[0].contentUrl;
    expect(listedContentUrl)
      .toContain(`/api/v1/community/reports/${report.reportId}/attachments/${attachment.attachmentId}/content?mediaToken=`);
    process.env.COP_PUBLIC_READ_ENABLED = "false";
    const contentResponse = await app.inject({
      method: "GET",
      url: listedContentUrl
    });
    expect(contentResponse.statusCode).toBe(200);
    expect(contentResponse.body).toBe("fake-video-data");
    expect(String(contentResponse.headers["content-disposition"])).toContain('filename="svatba _. 2.mp4"');
    expect(String(contentResponse.headers["content-disposition"])).toContain("filename*=UTF-8''svatba%20%C4%8D.%202.mp4");

    await app.close();
  });

  it("uploads video attachments through the binary API proxy without base64 JSON", async () => {
    process.env.COP_MEDIA_MAX_ATTACHMENT_BYTES = "10485760";
    const mediaStorage = new FakeMediaStorage();
    const app = buildServer({
      mediaStorage,
      now: () => new Date("2026-05-20T12:00:00Z")
    });

    const createResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        category: "hazard",
        location: {
          lat: 50.075,
          lon: 14.438,
          source: "manual"
        },
        title: "Video hlášení",
        visibility: "community"
      },
      url: "/api/v1/community/reports"
    });
    const report = createResponse.json() as { reportId: string };
    const body = Buffer.from("binary-video-data");
    const attachmentResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        byteSize: body.length,
        contentType: "video/quicktime",
        fileName: "IMG_2741.MOV",
        kind: "video"
      },
      url: `/api/v1/community/reports/${report.reportId}/attachments`
    });
    const attachment = (attachmentResponse.json() as { attachment: { attachmentId: string } }).attachment;
    const uploadResponse = await app.inject({
      headers: {
        authorization: "Bearer dev-lab-token",
        "content-type": "video/quicktime"
      },
      method: "POST",
      payload: body,
      url: `/api/v1/community/reports/${report.reportId}/attachments/${attachment.attachmentId}/upload`
    });

    expect(uploadResponse.statusCode).toBe(200);
    expect(uploadResponse.json()).toMatchObject({
      byteSize: body.length,
      contentType: "video/quicktime",
      kind: "video",
      status: "uploaded"
    });
    expect(mediaStorage.objects.get(`community-reports/${report.reportId}/${attachment.attachmentId}/IMG_2741.MOV`)?.toString()).toBe("binary-video-data");

    await app.close();
  });
});

class FakeEmbeddingProvider extends OllamaEmbeddingProvider {
  constructor() {
    super({
      baseUrls: ["http://embedding.example.test"],
      model: "bge-m3:test",
      retryAttempts: 0,
      timeoutMs: 1000
    });
  }

  override async embed() {
    return {
      embedding: [1, 0],
      model: "bge-m3:test"
    };
  }
}

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

  async getObject(request: MediaObjectReadRequest): Promise<{ body: Buffer; contentType?: string }> {
    const body = this.objects.get(request.objectKey);
    if (!body) {
      throw new Error("object not found");
    }
    return { body };
  }

  async putObject(request: MediaObjectWriteRequest): Promise<void> {
    this.objects.set(request.objectKey, request.body);
  }
}

function signJwt(privateKey: KeyObject, keyId: string, payload: Record<string, unknown>): string {
  const header = {
    alg: "RS256",
    kid: keyId,
    typ: "JWT"
  };
  const signedContent = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signedContent);
  signer.end();
  return `${signedContent}.${signer.sign(privateKey).toString("base64url")}`;
}

function base64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function jsonResponse(body: unknown): Response {
  return {
    json: async () => body,
    ok: true,
    status: 200
  } as Response;
}
