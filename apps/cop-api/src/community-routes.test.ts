import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { createPublicSafetyAggregateSourceSystem, createPublicSituationAggregateSourceSystem } from "@cop/canonical-model";
import { AiGateway, OllamaEmbeddingProvider, type AiCopQuery, type AiCopResponse, type AiProvider } from "@cop/ai-gateway";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryCommunityReportStore } from "./community-report-store.js";
import { buildServer } from "./server.js";
import type { MediaObjectReadRequest, MediaObjectWriteRequest, MediaStorage, MediaUploadRequest, MediaUploadSlot } from "./media-storage.js";
import type { MessagingProvider } from "./messaging-provider.js";
import type { PlaceGeocodeQuery, PlaceGeocodeResponse, PlaceGeocoder } from "./place-geocoder.js";
import type {
  SafetyDataPublicConfig,
  SafetyDataSource,
  SafetyDataSourceConfig,
  SafetyFeatureCollection,
  SafetyFeatureQuery,
  SafetyLayerDescriptor,
  SafetySourceDescriptor
} from "./safety-data-source.js";
import type {
  SimSearchDataSource,
  SimSearchDataSourceConfig,
  SimSearchQueryRequest,
  SimSearchQueryResponse
} from "./sim-search-data-source.js";
import type {
  SituationDataSource,
  SituationDataSourceConfig,
  SituationFeatureCollection,
  SituationFeatureQuery,
  SituationLayerDescriptor,
  SituationSourceDescriptor
} from "./situation-data-source.js";
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
    const bufferedMediaRead = vi.fn(async () => {
      throw new Error("Media proxy must stream instead of buffering the full object.");
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (!url.startsWith("https://media.example.test/read/")) {
          return new Response(null, { status: 404 });
        }
        const objectKey = decodeURIComponent(url.slice("https://media.example.test/read/".length));
        const body = mediaStorage.objects.get(objectKey);
        if (body) {
          const response = new Response(new Uint8Array(body), {
            headers: {
              "accept-ranges": "bytes",
              "content-length": String(body.length),
              "content-type": "image/jpeg"
            },
            status: 200
          });
          Object.defineProperty(response, "arrayBuffer", { value: bufferedMediaRead });
          return response;
        }
        return new Response(null, { status: 404 });
      })
    );
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
    expect(bufferedMediaRead).not.toHaveBeenCalled();

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
      observability: {
        compression: {
          compressedContextBytes: expect.any(Number),
          ratio: expect.any(Number),
          uncompressedContextBytes: expect.any(Number)
        },
        contractVersion: "cop-ai-pipeline-observability-v1",
        operation: "chat-agent",
        retrievalIntent: {
          primary: "general-safety",
          suppressRoutineCivilAir: true
        },
        timingsMs: {
          indexedContext: expect.any(Number),
          provider: expect.any(Number),
          semanticContext: expect.any(Number)
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
    expect(capturedQueries[0]?.modelPreference).toBe("auto");
    expect(capturedQueries[0]?.prompt).toContain("priorityContext");
    expect(capturedQueries[0]?.prompt).toContain("indexedContext");
    expect(capturedQueries[0]?.prompt).toContain("civilní lety a stale civilní letové tracky nejsou priorita");
    expect(capturedQueries[0]?.context?.retrievalIntent).toMatchObject({
      primary: "general-safety",
      suppressRoutineCivilAir: true
    });
    const priorityContext = capturedQueries[0]?.context?.priorityContext as Record<string, unknown> | undefined;
    expect(priorityContext).toMatchObject({
      contractVersion: "cop-ai-priority-context-v1"
    });
    expect(capturedQueries[0]?.context?.contextCompression).toMatchObject({
      contractVersion: "cop-ai-prompt-context-compression-v1",
      mode: "bge-m3-evidence-first",
      retrievalIntent: {
        primary: "general-safety",
        suppressRoutineCivilAir: true
      }
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
    const promptSemanticContext = capturedQueries[0]?.context?.semanticContext as Record<string, unknown> | undefined;
    const promptSemanticItems = Array.isArray(promptSemanticContext?.items) ? promptSemanticContext.items : [];
    expect(promptSemanticItems[0]).not.toHaveProperty("payload");
    const auditResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      url: "/api/v1/audit/events"
    });
    const auditItems = auditResponse.json().items as Array<Record<string, unknown>>;
    const indexToolAudit = auditItems.find((item) => item.eventType === "AI_CONTEXT_INDEX_TOOL_INVOKED");
    expect(indexToolAudit).toMatchObject({
      requestId: queryBody.requestId,
      toolId: "cop.ai.context_index.query",
      matchedDocumentCount: expect.any(Number),
      retrievalIntent: {
        primary: "general-safety",
        suppressRoutineCivilAir: true
      }
    });
    const aiAudit = auditItems.find((item) => item.eventType === "AI_CHAT_AGENT_COMPLETED");
    expect(aiAudit).toMatchObject({
      indexedDocumentCount: expect.any(Number),
      indexedToolInvocationId: expect.any(String),
      pipelineObservability: {
        contractVersion: "cop-ai-pipeline-observability-v1",
        retrievalIntent: {
          primary: "general-safety",
          suppressRoutineCivilAir: true
        }
      },
      retrievalIntent: {
        primary: "general-safety",
        suppressRoutineCivilAir: true
      },
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

  it("returns a controlled AI response when the provider times out", async () => {
    vi.stubEnv("COP_AI_REQUEST_TIMEOUT_MS", "5");
    vi.stubEnv("COP_AI_SEMANTIC_RETRIEVAL_ENABLED", "false");
    vi.stubEnv("COP_AI_CONTEXT_INDEX_ENABLED", "false");
    const aiProvider: AiProvider = {
      available: true,
      id: "mock",
      model: "never-finishes",
      async execute() {
        return new Promise<Record<string, unknown>>(() => {});
      },
      async health() {
        return {
          detail: "test provider",
          status: "ok"
        };
      }
    };
    const app = buildServer({
      aiGateway: new AiGateway(new Map([["mock", aiProvider]]), {
        defaultProvider: "mock",
        embeddingProvider: new FakeEmbeddingProvider()
      }),
      now: () => new Date("2026-05-20T12:00:00Z")
    });

    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        question: "Jaká je situace?"
      },
      url: "/api/v1/ai/chat-agent/query"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      model: "grounded-playbook-v1",
      provider: "local",
      status: "COMPLETED",
      result: {
        summary: expect.stringContaining("nejsou v aktuálně dostupném COP kontextu")
      }
    });

    await app.close();
  });

  it("replaces technical source-health provider output with a grounded summary", async () => {
    const aiProvider: AiProvider = {
      available: true,
      id: "mock",
      model: "technical-source-health-provider",
      async execute() {
        return {
          summary: "ClientError stack trace: providerId=sim.search-data sourceSystemId=internal"
        };
      },
      async health() {
        return { detail: "test provider", status: "ok" };
      }
    };
    const app = buildServer({
      aiGateway: new AiGateway(new Map([["mock", aiProvider]]), {
        defaultProvider: "mock",
        embeddingProvider: new FakeEmbeddingProvider()
      }),
      now: () => new Date("2026-05-20T12:00:00Z")
    });

    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {},
      url: "/api/v1/ai/source-health-summary"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      model: "grounded-playbook-v1",
      provider: "local",
      status: "COMPLETED",
      result: {
        summary: expect.stringContaining("dostupných zdrojů")
      }
    });
    expect(response.json().result.summary).not.toContain("providerId");
    expect(response.json().result.summary).not.toContain("stack trace");

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
    await userProfileStore.upsertProfile({
      alertPreferences: {},
      displayName: "Jiřina Volková",
      email: "jirina@example.test",
      preferences: {},
      subjectId: "000dfd66-0000-4000-8000-000000007ef2",
      username: "jirina.volkova"
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

    const accentInsensitiveSearchResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/users/search?q=jirina"
    });
    expect(accentInsensitiveSearchResponse.statusCode).toBe(200);
    expect(accentInsensitiveSearchResponse.json()).toMatchObject({
      items: [
        {
          displayName: "Jiřina Volková",
          subjectId: "000dfd66-0000-4000-8000-000000007ef2",
          username: "jirina.volkova"
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

  it("recovers the persistent user directory after a transient startup failure", async () => {
    const userProfileStore = new TransientInitFailureUserProfileStore();
    await userProfileStore.upsertProfile({
      alertPreferences: {},
      displayName: "Josef Čavrnoch",
      email: "cavrnoch@example.test",
      preferences: {},
      subjectId: "ccbbfb45-b01e-413d-98e8-79e650de4c9f",
      username: "cava"
    });
    const app = buildServer({
      mediaStorage: new FakeMediaStorage(),
      now: () => new Date("2026-05-20T12:00:00Z"),
      userProfileStore
    });

    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/users/search?q=cava"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [
        {
          displayName: "Josef Čavrnoch",
          subjectId: "ccbbfb45-b01e-413d-98e8-79e650de4c9f",
          username: "cava"
        }
      ]
    });
    expect(userProfileStore.initAttempts).toBe(2);

    const dependencies = await app.inject({ method: "GET", url: "/health/dependencies" });
    expect(dependencies.json().dependencies).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "user-profile-store", status: "ok" })])
    );

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

  it("passes map search results into AI chat agent context for nearest police questions", async () => {
    const capturedQueries: AiCopQuery[] = [];
    const aiProvider: AiProvider = {
      available: true,
      id: "mock",
      model: "test-cop-ai-provider",
      async execute(query) {
        capturedQueries.push(query);
        return {
          summary: "Map search context captured",
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
    const situationDataSource = new FakeAiMapSearchSituationDataSource();
    const app = buildServer({
      aiGateway: new AiGateway(new Map([["mock", aiProvider]]), {
        defaultProvider: "mock",
        embeddingProvider: new FakeEmbeddingProvider()
      }),
      now: () => new Date("2026-05-20T12:00:00Z"),
      situationDataSource
    });

    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        geoContext: {
          currentLocation: {
            lat: 50.12952,
            lon: 17.36285,
            radiusKm: 30
          },
          label: "Moje poloha"
        },
        question: "Najdi mi nejbližší policii od mé polohy."
      },
      url: "/api/v1/ai/chat-agent/query"
    });

    expect(response.statusCode).toBe(200);
    expect(capturedQueries).toHaveLength(0);
    expect(situationDataSource.lastFeatureQuery).toMatchObject({
      layers: ["ground"],
      sources: ["osm_postgis"]
    });
    const aiResponse = response.json() as AiCopResponse;
    expect(aiResponse).toMatchObject({
      model: "map-search-fallback",
      provider: "local",
      status: "COMPLETED"
    });
    expect(aiResponse.result.summary).toContain("Policie ČR Obvodní oddělení Vrbno pod Pradědem");
    const structured = aiResponse.result.structured as Record<string, unknown>;
    const mapSearch = structured.mapSearch as Record<string, unknown>;
    expect(mapSearch).toMatchObject({
      resultCount: 1,
      toolCall: {
        matchedFeatureCount: 1,
        status: "ok",
        toolId: "cop.map.query.search"
      }
    });
    expect(mapSearch.results).toEqual([
      expect.objectContaining({
        category: "police",
        distanceM: expect.any(Number),
        mapFeatureId: "osm:police:vrbno",
        title: "Policie ČR Obvodní oddělení Vrbno pod Pradědem"
      })
    ]);
    expect(structured.mapActions).toEqual([
      expect.objectContaining({
        action: "focus-map",
        entityId: "osm:police:vrbno",
        title: "Policie ČR Obvodní oddělení Vrbno pod Pradědem"
      })
    ]);
    const evidence = structured.evidence as Record<string, unknown>;
    expect(evidence.responsePlaybook).toMatchObject({
      allowedActions: ["focus-map", "route"],
      domain: "security",
      intentId: "map.nearest.police",
      requiredSources: ["map-search"]
    });
    const priorityContext = evidence.priority as Record<string, unknown>;
    expect(priorityContext.citations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityId: "osm:police:vrbno",
        entityType: "mapFeature"
      })
    ]));
    expect(evidence.mapSnapshot).toMatchObject({
      candidates: expect.arrayContaining([
        expect.objectContaining({
          entityId: "osm:police:vrbno",
          entityType: "mapFeature",
          location: {
            lat: 50.1209,
            lon: 17.3832
          }
        })
      ])
    });
    const auditResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      url: "/api/v1/audit/events"
    });
    const auditItems = auditResponse.json().items as Array<Record<string, unknown>>;
    expect(auditItems.find((item) => item.eventType === "AI_MAP_SEARCH_TOOL_INVOKED")).toMatchObject({
      categoryIds: ["police"],
      layerIds: ["reference.infrastructure.emergency"],
      matchedFeatureCount: 1,
      toolId: "cop.map.query.search"
    });

    await app.close();
  });

  it("uses bounded geocoder fallback for nearest police when COP map layers are empty", async () => {
    const capturedQueries: AiCopQuery[] = [];
    const aiProvider: AiProvider = {
      available: true,
      id: "mock",
      model: "test-cop-ai-provider",
      async execute(query) {
        capturedQueries.push(query);
        return {
          summary: "Provider should not be called for deterministic map search fallback",
          structured: {}
        };
      },
      async health() {
        return {
          detail: "test provider",
          status: "ok"
        };
      }
    };
    const placeGeocoder = new FakeAiMapSearchPlaceGeocoder();
    const app = buildServer({
      aiGateway: new AiGateway(new Map([["mock", aiProvider]]), {
        defaultProvider: "mock",
        embeddingProvider: new FakeEmbeddingProvider()
      }),
      now: () => new Date("2026-05-20T12:00:00Z"),
      placeGeocoder
    });

    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        geoContext: {
          currentLocation: {
            lat: 50.12952,
            lon: 17.36285,
            radiusKm: 30
          },
          label: "Moje poloha"
        },
        question: "Najdi nejbližší policejní stanici blízko mé polohy."
      },
      url: "/api/v1/ai/chat-agent/query"
    });

    expect(response.statusCode).toBe(200);
    expect(capturedQueries).toHaveLength(0);
    expect(placeGeocoder.searchRequests[0]).toMatchObject({
      bounded: true,
      limit: 8,
      query: "police"
    });
    expect(placeGeocoder.searchRequests[0]?.bbox).toEqual(expect.objectContaining({
      east: expect.any(Number),
      north: expect.any(Number),
      south: expect.any(Number),
      west: expect.any(Number)
    }));
    const aiResponse = response.json() as AiCopResponse;
    expect(aiResponse).toMatchObject({
      model: "map-search-fallback",
      provider: "local",
      status: "COMPLETED"
    });
    expect(aiResponse.result.summary).toContain("Policie ČR Obvodní oddělení Vrbno pod Pradědem");
    expect(aiResponse.result.summary).not.toContain("potřebuje aktuální polohu");
    const structured = aiResponse.result.structured as Record<string, unknown>;
    const mapSearch = structured.mapSearch as Record<string, unknown>;
    expect(mapSearch).toMatchObject({
      resultCount: 2,
      toolCall: {
        matchedFeatureCount: 2,
        status: "degraded",
        toolId: "cop.map.query.search"
      }
    });
    const mapResults = mapSearch.results as Record<string, unknown>[];
    expect(mapResults[0]).toEqual(expect.objectContaining({
      category: "police",
      mapFeatureId: "place:fake-place-geocoder:place:police-vrbno",
      sourceName: "fake-place-geocoder bounded search",
      title: "Policie ČR Obvodní oddělení Vrbno pod Pradědem"
    }));
    const mapActions = structured.mapActions as Record<string, unknown>[];
    expect(mapActions[0]).toEqual(expect.objectContaining({
      action: "focus-map",
      entityId: "place:fake-place-geocoder:place:police-vrbno",
      title: "Policie ČR Obvodní oddělení Vrbno pod Pradědem"
    }));

    await app.close();
  });

  it("uses SIM search-data as the first AI map-search source for nearest object questions", async () => {
    const capturedQueries: AiCopQuery[] = [];
    const aiProvider: AiProvider = {
      available: true,
      id: "mock",
      model: "test-cop-ai-provider",
      async execute(query) {
        capturedQueries.push(query);
        return {
          summary: "SIM search-data context captured",
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
    const simSearchDataSource = new FakeAiMapSearchSimSearchDataSource();
    const app = buildServer({
      aiGateway: new AiGateway(new Map([["mock", aiProvider]]), {
        defaultProvider: "mock",
        embeddingProvider: new FakeEmbeddingProvider()
      }),
      now: () => new Date("2026-05-20T12:00:00Z"),
      simSearchDataSource
    });

    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        geoContext: {
          currentLocation: {
            lat: 50.12952,
            lon: 17.36285,
            radiusKm: 30
          },
          label: "Moje poloha"
        },
        question: "Najdi mi nejbližší policii od mé polohy."
      },
      url: "/api/v1/ai/chat-agent/query"
    });

    expect(response.statusCode).toBe(200);
    expect(capturedQueries).toHaveLength(0);
    expect(simSearchDataSource.lastQuery).toMatchObject({
      center: {
        lat: 50.12952,
        lon: 17.36285
      },
      entityTypes: ["police_station"],
      radiusM: 30000,
      text: "Najdi mi nejbližší policii od mé polohy."
    });
    const aiResponse = response.json() as AiCopResponse;
    expect(aiResponse).toMatchObject({
      model: "map-search-fallback",
      provider: "local",
      status: "COMPLETED"
    });
    expect(aiResponse.result.summary).toContain("Policie ČR - Obvodní oddělení Vrbno pod Pradědem");
    const structured = aiResponse.result.structured as Record<string, unknown>;
    const mapSearch = structured.mapSearch as Record<string, unknown>;
    expect(mapSearch).toMatchObject({
      resultCount: 1
    });
    expect(mapSearch.results).toEqual([
      expect.objectContaining({
        category: "local_department",
        mapFeatureId: "police:cz:vrbno-obvodni",
        sourceAuthority: "reference",
        title: "Policie ČR - Obvodní oddělení Vrbno pod Pradědem"
      })
    ]);
    expect(structured.mapActions).toEqual([
      expect.objectContaining({
        action: "focus-map",
        entityId: "police:cz:vrbno-obvodni",
        title: "Policie ČR - Obvodní oddělení Vrbno pod Pradědem"
      })
    ]);
    const auditResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      url: "/api/v1/audit/events"
    });
    const auditItems = auditResponse.json().items as Array<Record<string, unknown>>;
    expect(auditItems.find((item) => item.eventType === "AI_SIM_SEARCH_DATA_TOOL_INVOKED")).toMatchObject({
      entityTypes: ["police_station"],
      matchedFeatureCount: 1,
      providerId: "sim.search-data",
      sourceSystemId: "sim-search-data-api"
    });

    await app.close();
  });

  it("answers surrounding hydro measurement questions from SIM search-data without calling the LLM", async () => {
    const capturedQueries: AiCopQuery[] = [];
    const aiProvider: AiProvider = {
      available: true,
      id: "mock",
      model: "test-cop-ai-provider",
      async execute(query) {
        capturedQueries.push(query);
        return {
          summary: "Provider should not be called for deterministic hydro SIM search fallback",
          structured: {}
        };
      },
      async health() {
        return {
          detail: "test provider",
          status: "ok"
        };
      }
    };
    const simSearchDataSource = new FakeAiMapSearchSimSearchDataSource();
    const app = buildServer({
      aiGateway: new AiGateway(new Map([["mock", aiProvider]]), {
        defaultProvider: "mock",
        embeddingProvider: new FakeEmbeddingProvider()
      }),
      now: () => new Date("2026-05-20T12:00:00Z"),
      simSearchDataSource
    });

    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        geoContext: {
          currentLocation: {
            lat: 50.15077,
            lon: 17.37303,
            radiusKm: 30
          },
          label: "Moje poloha"
        },
        question: "Kde se měří výška vody v okolí? a jaká je nyní hodnota?"
      },
      url: "/api/v1/ai/chat-agent/query"
    });

    expect(response.statusCode).toBe(200);
    expect(capturedQueries).toHaveLength(0);
    expect(simSearchDataSource.lastQuery).toMatchObject({
      center: {
        lat: 50.15077,
        lon: 17.37303
      },
      entityTypes: ["hydro_station", "hydro_measurement", "flood_risk_area"],
      radiusM: 30000
    });
    const aiResponse = response.json() as AiCopResponse;
    expect(aiResponse).toMatchObject({
      model: "map-search-fallback",
      provider: "local",
      status: "COMPLETED"
    });
    expect(aiResponse.result.summary).toContain("Hydrologické měření: Mnichov - Černá Opava");
    expect(aiResponse.result.summary).toContain("Hladina 106 cm");
    expect(aiResponse.result.summary).toContain("Průtok 0,33 m3/s");
    expect(aiResponse.result.summary).toContain("SPA 0");
    const structured = aiResponse.result.structured as Record<string, unknown>;
    expect(structured.mapActions).toEqual([
      expect.objectContaining({
        action: "focus-map",
        entityId: "safety:hydro:mnichov-cerna-opava",
        title: "Mnichov - Černá Opava"
      })
    ]);

    await app.close();
  });

  it("answers weather forecast questions from SIM search-data without computing weatherCode", async () => {
    const capturedQueries: AiCopQuery[] = [];
    const aiProvider: AiProvider = {
      available: true,
      id: "mock",
      model: "test-cop-ai-provider",
      async execute(query) {
        capturedQueries.push(query);
        return {
          summary: "Provider should not be called for deterministic weather SIM search fallback",
          structured: {}
        };
      },
      async health() {
        return {
          detail: "test provider",
          status: "ok"
        };
      }
    };
    const simSearchDataSource = new FakeAiMapSearchSimSearchDataSource();
    simSearchDataSource.weatherForecastResult = true;
    const app = buildServer({
      aiGateway: new AiGateway(new Map([["mock", aiProvider]]), {
        defaultProvider: "mock",
        embeddingProvider: new FakeEmbeddingProvider()
      }),
      now: () => new Date("2026-05-20T12:00:00Z"),
      simSearchDataSource
    });

    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        geoContext: {
          currentLocation: {
            lat: 50.15077,
            lon: 17.37303,
            radiusKm: 30
          },
          label: "Moje poloha"
        },
        question: "Bude dnes pršet? Blíží se bouřka?"
      },
      url: "/api/v1/ai/chat-agent/query"
    });

    expect(response.statusCode).toBe(200);
    expect(capturedQueries).toHaveLength(0);
    expect(simSearchDataSource.lastQuery).toMatchObject({
      entityTypes: ["weather_forecast", "weather_nowcast", "weather_radar", "thunderstorm_risk"],
      sourceSystems: ["weather_forecast", "chmi_weather_radar"],
      validAt: "2026-05-20T12:00:00.000Z"
    });
    const aiResponse = response.json() as AiCopResponse;
    expect(aiResponse).toMatchObject({
      model: "map-search-fallback",
      provider: "local",
      status: "COMPLETED"
    });
    expect(aiResponse.result.summary).toContain("Odpověď: Ano, déšť je podle dostupného meteo výsledku pravděpodobný");
    expect(aiResponse.result.summary).toContain("Bouřka je podle dostupného meteo výsledku možná");
    expect(aiResponse.result.summary).toContain("Pozor: tato entita pokrývá nejbližší časové okno");
    expect(aiResponse.result.summary).toContain("Meteo informace: Předpověď pro Vrbno pod Pradědem");
    expect(aiResponse.result.summary).toContain("Srážky 10 min 0,8 mm");
    expect(aiResponse.result.summary).toContain("Srážky 1 h 2,4 mm");
    expect(aiResponse.result.summary).toContain("Srážky 3 h 5,9 mm");
    expect(aiResponse.result.summary).toContain("Pravděpodobnost srážek 70 %");
    expect(aiResponse.result.summary).toContain("Pravděpodobnost bouřky 35 %");
    expect(aiResponse.result.summary).toContain("Vítr 4,2 m/s");
    expect(aiResponse.result.summary).toContain("Nárazy větru 12 m/s");
    expect(aiResponse.result.summary).toContain("Bleskový feed dostupný");
    expect(aiResponse.result.summary).toContain("SIM použil záložní meteo zdroj.");
    expect(aiResponse.result.summary).toContain("/search-data/api/v1/weather-forecast/vrbno/detail");
    const structured = aiResponse.result.structured as Record<string, unknown>;
    const mapSearch = structured.mapSearch as Record<string, unknown>;
    expect(mapSearch.results).toEqual([
      expect.objectContaining({
        detailUrl: "/search-data/api/v1/weather-forecast/vrbno/detail",
        fallbackUsed: true,
        mapFeatureId: "weather_forecast:vrbno:2026-05-20T12",
        validFrom: "2026-05-20T12:00:00.000Z",
        validUntil: "2026-05-20T15:00:00.000Z"
      })
    ]);

    await app.close();
  });

  it("answers a general weather forecast deterministically for a known location", async () => {
    const capturedQueries: AiCopQuery[] = [];
    const aiProvider: AiProvider = {
      available: true,
      id: "mock",
      model: "test-cop-ai-provider",
      async execute(query) {
        capturedQueries.push(query);
        return {
          summary: "V okolí Vrbna čekejte v nejbližších třech hodinách déšť, vítr kolem 4 m/s a mírné riziko bouřky. Zdroj: ČHMÚ/SIM.",
          structured: {}
        };
      },
      async health() {
        return { detail: "test provider", status: "ok" };
      }
    };
    const simSearchDataSource = new FakeAiMapSearchSimSearchDataSource();
    simSearchDataSource.weatherForecastResult = true;
    const app = buildServer({
      aiGateway: new AiGateway(new Map([["mock", aiProvider]]), {
        defaultProvider: "mock",
        embeddingProvider: new FakeEmbeddingProvider()
      }),
      now: () => new Date("2026-07-15T19:30:00Z"),
      simSearchDataSource
    });

    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        currentLocation: { lat: 50.15077, lon: 17.37303, radiusKm: 30 },
        question: "Jaké bude počasí?"
      },
      url: "/api/v1/ai/chat-agent/query"
    });

    expect(response.statusCode).toBe(200);
    expect(capturedQueries).toHaveLength(0);
    const aiResponse = response.json() as AiCopResponse;
    expect(aiResponse).toMatchObject({
      model: "map-search-fallback",
      provider: "local",
      status: "COMPLETED"
    });
    expect(aiResponse.result.summary).toContain("Pro nejbližší dostupné období");
    expect(aiResponse.result.summary).toContain("pravděpodobnost srážek 70 %");
    expect(aiResponse.result.summary).not.toContain("MAX_Z");

    await app.close();
  });

  it("asks for a place instead of using an unbounded radar result for general weather", async () => {
    const capturedQueries: AiCopQuery[] = [];
    const aiProvider: AiProvider = {
      available: true,
      id: "mock",
      model: "test-cop-ai-provider",
      async execute(query) {
        capturedQueries.push(query);
        return { summary: "Provider should not be called without a weather location", structured: {} };
      },
      async health() {
        return { detail: "test provider", status: "ok" };
      }
    };
    const simSearchDataSource = new FakeAiMapSearchSimSearchDataSource();
    simSearchDataSource.weatherForecastResult = true;
    const app = buildServer({
      aiGateway: new AiGateway(new Map([["mock", aiProvider]]), {
        defaultProvider: "mock",
        embeddingProvider: new FakeEmbeddingProvider()
      }),
      now: () => new Date("2026-07-15T19:30:00Z"),
      simSearchDataSource
    });

    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: { question: "Jaké bude počasí?" },
      url: "/api/v1/ai/chat-agent/query"
    });

    expect(response.statusCode).toBe(200);
    expect(capturedQueries).toHaveLength(0);
    const aiResponse = response.json() as AiCopResponse;
    expect(aiResponse).toMatchObject({
      model: "weather-location-clarification",
      provider: "local",
      status: "COMPLETED"
    });
    expect(aiResponse.result.summary).toContain("Pro jaké místo chcete předpověď?");
    expect(aiResponse.result.summary).not.toContain("MAX_Z");
    expect(aiResponse.result.summary).not.toContain("Souřadnice");

    await app.close();
  });

  it("resolves a short weather follow-up from the last client-visible AI exchange", async () => {
    const capturedQueries: AiCopQuery[] = [];
    const aiProvider: AiProvider = {
      available: true,
      id: "mock",
      model: "test-cop-ai-provider",
      async execute(query) {
        capturedQueries.push(query);
        return { summary: "Provider should not be called for grounded weather data", structured: {} };
      },
      async health() {
        return { detail: "test provider", status: "ok" };
      }
    };
    const simSearchDataSource = new FakeAiMapSearchSimSearchDataSource();
    simSearchDataSource.weatherForecastResult = true;
    const app = buildServer({
      aiGateway: new AiGateway(new Map([["mock", aiProvider]]), {
        defaultProvider: "mock",
        embeddingProvider: new FakeEmbeddingProvider()
      }),
      now: () => new Date("2026-07-15T19:30:00Z"),
      simSearchDataSource
    });

    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        chatContext: {
          encrypted: true,
          messages: [
            { body: "Jaké bude počasí ve Vrbně pod Pradědem?", eventId: "$q1", own: true },
            {
              ai: { question: "Jaké bude počasí ve Vrbně pod Pradědem?", type: "chat-agent" },
              body: "Ve Vrbně bude polojasno.",
              eventId: "$a1",
              own: true
            },
            { body: "A jak bude zítra?", eventId: "$q2", own: true }
          ]
        },
        currentLocation: { lat: 50.15077, lon: 17.37303, radiusKm: 30 },
        question: "A jak bude zítra?"
      },
      url: "/api/v1/ai/chat-agent/query"
    });

    expect(response.statusCode).toBe(200);
    expect(capturedQueries).toHaveLength(0);
    const aiResponse = response.json() as AiCopResponse;
    const structured = aiResponse.result.structured as Record<string, unknown>;
    expect(structured.conversation).toMatchObject({
      followUp: true,
      followUpKind: "time",
      needsClarification: false,
      originalQuestion: "A jak bude zítra?",
      previousQuestion: "Jaké bude počasí ve Vrbně pod Pradědem?",
      resolvedQuestion: expect.stringContaining("Časové upřesnění"),
      timeReference: { dayOffset: 1, label: "zítra" }
    });
    expect(simSearchDataSource.lastQuery?.validAt).toBe("2026-07-16T10:00:00.000Z");
    expect(aiResponse.result.summary).toContain("Můžete navázat:");
    expect(aiResponse.result.summary).not.toContain("MAX_Z");

    await app.close();
  });

  it("asks a human clarification for an elliptical question without visible context", async () => {
    const app = buildServer({ now: () => new Date("2026-07-15T19:30:00Z") });
    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: { question: "Proč?" },
      url: "/api/v1/ai/chat-agent/query"
    });

    expect(response.statusCode).toBe(200);
    const aiResponse = response.json() as AiCopResponse;
    expect(aiResponse).toMatchObject({
      model: "conversation-clarification-v1",
      provider: "local",
      status: "COMPLETED"
    });
    expect(aiResponse.result.summary).toContain("Na co má otázka „Proč?“ navazovat?");
    expect(aiResponse.result.structured).toMatchObject({
      conversation: {
        followUp: true,
        needsClarification: true
      }
    });

    await app.close();
  });

  it("returns an explicit no-data weather response when SIM has no current meteo entity", async () => {
    const capturedQueries: AiCopQuery[] = [];
    const aiProvider: AiProvider = {
      available: true,
      id: "mock",
      model: "test-cop-ai-provider",
      async execute(query) {
        capturedQueries.push(query);
        return {
          summary: "Provider should not be called for deterministic empty weather fallback",
          structured: {}
        };
      },
      async health() {
        return {
          detail: "test provider",
          status: "ok"
        };
      }
    };
    const simSearchDataSource = new FakeAiMapSearchSimSearchDataSource();
    const app = buildServer({
      aiGateway: new AiGateway(new Map([["mock", aiProvider]]), {
        defaultProvider: "mock",
        embeddingProvider: new FakeEmbeddingProvider()
      }),
      now: () => new Date("2026-05-20T12:00:00Z"),
      simSearchDataSource
    });

    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        geoContext: {
          currentLocation: {
            lat: 50.15077,
            lon: 17.37303,
            radiusKm: 30
          },
          label: "Moje poloha"
        },
        question: "Bude pršet? Blíží se bouřka?"
      },
      url: "/api/v1/ai/chat-agent/query"
    });

    expect(response.statusCode).toBe(200);
    expect(capturedQueries).toHaveLength(0);
    expect(simSearchDataSource.lastQuery).toMatchObject({
      entityTypes: ["weather_forecast", "weather_nowcast", "weather_radar", "thunderstorm_risk"],
      sourceSystems: ["weather_forecast", "chmi_weather_radar"]
    });
    const aiResponse = response.json() as AiCopResponse;
    expect(aiResponse).toMatchObject({
      model: "map-search-empty-fallback",
      provider: "local",
      status: "COMPLETED"
    });
    expect(aiResponse.result.summary).toContain("nenašel aktuální meteo předpověď");
    expect(aiResponse.result.summary).toContain("To neznamená, že neprší");

    await app.close();
  });

  it("geocodes place phrases into bbox for generic AI map searches without explicit geo context", async () => {
    const capturedQueries: AiCopQuery[] = [];
    const aiProvider: AiProvider = {
      available: true,
      id: "mock",
      model: "test-cop-ai-provider",
      async execute(query) {
        capturedQueries.push(query);
        return {
          summary: "Generic map search context captured",
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
    const situationDataSource = new FakeAiMapSearchSituationDataSource();
    const placeGeocoder = new FakeAiMapSearchPlaceGeocoder();
    const app = buildServer({
      aiGateway: new AiGateway(new Map([["mock", aiProvider]]), {
        defaultProvider: "mock",
        embeddingProvider: new FakeEmbeddingProvider()
      }),
      now: () => new Date("2026-05-20T12:00:00Z"),
      placeGeocoder,
      situationDataSource
    });

    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        question: "Najdi vodoměrnou stanici ve Vrbně pod Pradědem."
      },
      url: "/api/v1/ai/chat-agent/query"
    });

    expect(response.statusCode).toBe(200);
    expect(placeGeocoder.queries.slice(0, 2)).toEqual(["Vrbně pod Pradědem", "Vrbno pod Pradědem"]);
    expect(capturedQueries).toHaveLength(1);
    const context = capturedQueries[0]?.context as Record<string, unknown>;
    const mapSearch = context.mapSearch as Record<string, unknown>;
    expect(mapSearch).toMatchObject({
      contractVersion: "cop-ai-map-search-v1",
      query: {
        bbox: {
          east: 17.45,
          north: 50.16,
          south: 50.09,
          west: 17.31
        },
        placeQuery: "Vrbně pod Pradědem",
        requested: true
      },
      toolCall: {
        toolId: "cop.map.query.search"
      }
    });

    await app.close();
  });

  it("uses geocoded generic map searches against safety flood layers", async () => {
    const capturedQueries: AiCopQuery[] = [];
    const aiProvider: AiProvider = {
      available: true,
      id: "mock",
      model: "test-cop-ai-provider",
      async execute(query) {
        capturedQueries.push(query);
        return {
          summary: "Safety map search context captured",
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
    const placeGeocoder = new FakeAiMapSearchPlaceGeocoder();
    const safetyDataSource = new FakeAiMapSearchSafetyDataSource();
    const app = buildServer({
      aiGateway: new AiGateway(new Map([["mock", aiProvider]]), {
        defaultProvider: "mock",
        embeddingProvider: new FakeEmbeddingProvider()
      }),
      now: () => new Date("2026-05-20T12:00:00Z"),
      placeGeocoder,
      safetyDataSource
    });

    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        question: "Najdi vodoměrnou stanici ve Vrbně pod Pradědem."
      },
      url: "/api/v1/ai/chat-agent/query"
    });

    expect(response.statusCode).toBe(200);
    expect(capturedQueries).toHaveLength(0);
    expect(safetyDataSource.lastFeatureQuery).toMatchObject({
      layers: expect.arrayContaining(["flood"]),
      sources: expect.arrayContaining(["chmi_hydro"])
    });
    const aiResponse = response.json() as AiCopResponse;
    expect(aiResponse).toMatchObject({
      model: "map-search-fallback",
      provider: "local",
      status: "COMPLETED"
    });
    expect(aiResponse.result.summary).toContain("Hydrologické měření");
    expect(aiResponse.result.summary).toContain("Hladina 106 cm");
    expect(aiResponse.result.summary).toContain("Průtok 0,33 m3/s");
    const structured = aiResponse.result.structured as Record<string, unknown>;
    const mapSearch = structured.mapSearch as Record<string, unknown>;
    expect(mapSearch).toMatchObject({
      contractVersion: "cop-ai-map-search-v1",
      resultCount: 1,
      query: {
        placeQuery: "Vrbně pod Pradědem",
        requested: true,
        searchTerms: expect.arrayContaining(["vodomer", "stan"])
      },
      toolCall: {
        matchedFeatureCount: 1,
        toolId: "cop.map.query.search"
      }
    });
    expect(mapSearch.results).toEqual([
      expect.objectContaining({
        category: "water_level",
        mapFeatureId: "flood:chmi_hydro:1vnc992",
        sourceName: "CHMI hydrological stations",
        title: "water_level"
      })
    ]);
    expect(structured.mapActions).toEqual([
      expect.objectContaining({
        action: "focus-map",
        entityId: "flood:chmi_hydro:1vnc992",
        title: "water_level"
      })
    ]);

    await app.close();
  });

  it("uses current location for surrounding-area water-level questions instead of geocoding Okolí", async () => {
    const capturedQueries: AiCopQuery[] = [];
    const aiProvider: AiProvider = {
      available: true,
      id: "mock",
      model: "test-cop-ai-provider",
      async execute(query) {
        capturedQueries.push(query);
        return {
          summary: "Provider should not be called for deterministic hydro map search fallback",
          structured: {}
        };
      },
      async health() {
        return {
          detail: "test provider",
          status: "ok"
        };
      }
    };
    const placeGeocoder = new FakeAiMapSearchPlaceGeocoder();
    const safetyDataSource = new FakeAiMapSearchSafetyDataSource();
    const app = buildServer({
      aiGateway: new AiGateway(new Map([["mock", aiProvider]]), {
        defaultProvider: "mock",
        embeddingProvider: new FakeEmbeddingProvider()
      }),
      now: () => new Date("2026-05-20T12:00:00Z"),
      placeGeocoder,
      safetyDataSource
    });

    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        geoContext: {
          currentLocation: {
            lat: 50.12952,
            lon: 17.36285,
            radiusKm: 30
          },
          label: "Moje poloha"
        },
        question: "Kde se měří výška vody v okolí? a jaká je nyní hodnota?"
      },
      url: "/api/v1/ai/chat-agent/query"
    });

    expect(response.statusCode).toBe(200);
    expect(capturedQueries).toHaveLength(0);
    expect(placeGeocoder.queries).not.toContain("Okolí");
    expect(safetyDataSource.lastFeatureQuery).toMatchObject({
      bbox: expect.objectContaining({
        east: expect.any(Number),
        north: expect.any(Number),
        south: expect.any(Number),
        west: expect.any(Number)
      }),
      layers: expect.arrayContaining(["flood"]),
      sources: expect.arrayContaining(["chmi_hydro"])
    });
    const aiResponse = response.json() as AiCopResponse;
    expect(aiResponse).toMatchObject({
      model: "map-search-fallback",
      provider: "local",
      status: "COMPLETED"
    });
    const structured = aiResponse.result.structured as Record<string, unknown>;
    const mapSearch = structured.mapSearch as Record<string, unknown>;
    expect(mapSearch).toMatchObject({
      resultCount: 1,
      query: {
        center: {
          lat: 50.12952,
          lon: 17.36285,
          radiusKm: 30
        },
        requested: true,
        searchTerms: expect.arrayContaining(["vody"])
      }
    });
    expect(mapSearch.query).not.toHaveProperty("placeQuery");
    expect(mapSearch.results).toEqual([
      expect.objectContaining({
        category: "water_level",
        mapFeatureId: "flood:chmi_hydro:1vnc992",
        sourceName: "CHMI hydrological stations",
        title: "water_level"
      })
    ]);

    await app.close();
  });

  it("runs AI chat agent questions as pollable async jobs", async () => {
    const capturedQueries: AiCopQuery[] = [];
    const aiProvider: AiProvider = {
      available: true,
      id: "mock",
      model: "test-cop-ai-provider",
      async execute(query) {
        capturedQueries.push(query);
        return {
          summary: "Async job COP assistant response",
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
    const app = buildServer({
      aiGateway: new AiGateway(new Map([["mock", aiProvider]]), {
        defaultProvider: "mock",
        embeddingProvider: new FakeEmbeddingProvider()
      }),
      now: () => new Date("2026-05-20T12:00:00Z")
    });

    const startResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        modelPreference: "fast",
        question: "Jaká je situace ve Vrbně?"
      },
      url: "/api/v1/ai/chat-agent/jobs"
    });

    expect(startResponse.statusCode).toBe(202);
    const started = startResponse.json() as Record<string, unknown>;
    expect(started).toMatchObject({
      contractVersion: "cop-ai-chat-agent-job-v1",
      jobId: expect.any(String),
      requestId: expect.any(String),
      status: "queued"
    });

    let completed: Record<string, unknown> | undefined;
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const pollResponse = await app.inject({
        headers: { authorization: "Bearer dev-lab-token" },
        url: `/api/v1/ai/chat-agent/jobs/${String(started.jobId)}`
      });
      expect(pollResponse.statusCode).toBe(200);
      const body = pollResponse.json() as Record<string, unknown>;
      if (body.status === "completed") {
        completed = body;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(completed).toBeDefined();
    expect(completed).toMatchObject({
      requestId: started.requestId,
      response: {
        provider: "mock",
        result: {
          summary: expect.stringContaining("Async job COP assistant response")
        },
        status: "COMPLETED"
      },
      status: "completed"
    });
    expect(capturedQueries).toHaveLength(1);
    expect(capturedQueries[0]?.requestId).toBe(started.requestId);

    await app.close();
  });
});

class FakeAiMapSearchSimSearchDataSource implements SimSearchDataSource {
  readonly config: SimSearchDataSourceConfig = {
    baseUrl: "https://sim.example.test/search-data/api/v1",
    enabled: true,
    indexLimit: 1000,
    maxLimit: 100,
    timeoutMs: 6000
  };

  readonly sourceSystem = {
    allowedEventTypes: [],
    allowedObjectTypes: ["MAP_FEATURE", "INCIDENT", "REPORT", "UNKNOWN"],
    attributes: {
      contextOnly: true,
      contractVersion: "sim-search-source-v1"
    },
    classificationLimit: "UNCLASSIFIED" as const,
    displayName: "SIM Search Data",
    owner: "SIM search-data-api",
    sourceSystemId: "sim-search-data-api",
    sourceType: "PUBLIC_SITUATION_AGGREGATE" as const,
    status: "ACTIVE" as const,
    synthetic: false,
    trustProfile: "UNKNOWN" as const
  };

  lastQuery: SimSearchQueryRequest | null = null;
  weatherForecastResult = false;

  async query(request: SimSearchQueryRequest, requestNow: Date): Promise<SimSearchQueryResponse> {
    this.lastQuery = request;
    const entityTypes = new Set(request.entityTypes ?? []);
    if (entityTypes.has("weather_forecast") || entityTypes.has("weather_nowcast") || entityTypes.has("weather_radar") || entityTypes.has("thunderstorm_risk")) {
      if (this.weatherForecastResult) {
        return {
          contractVersion: "sim-search-source-v1",
          generatedAt: requestNow.toISOString(),
          providerId: "sim.search-data",
          query: request as Record<string, unknown>,
          results: [
            {
              centroid: {
                lat: 50.15077,
                lon: 17.37303
              },
              confidence: 0.91,
              dataQuality: "forecast_fallback",
              entitySubtype: "rain_storm_forecast",
              entityType: "weather_forecast",
              handling: {
                dynamic_data_requires_timestamp: true
              },
              layerIds: ["public.weather.forecast_area"],
              metrics: {
                lightningFeedAvailable: true,
                precipitation10mMm: 0.8,
                precipitation1hMm: 2.4,
                precipitation3hMm: 5.9,
                precipitationProbability: 0.7,
                risk: "elevated",
                thunderstormProbability: 0.35,
                windGustMps: 12,
                windSpeedMps: 4.2
              },
              observedAt: requestNow.toISOString(),
              providerEntityId: "weather_forecast:vrbno:2026-05-20T12",
              providerId: "sim.search-data",
              providerProperties: {
                weatherForecast: {
                  detailUrl: "/search-data/api/v1/weather-forecast/vrbno/detail",
                  fallbackUsed: true
                }
              },
              sourceAuthority: "model",
              sourceEntityId: "weather_forecast:vrbno",
              sourceRevision: "weather_forecast:2026-05-20T12:00:00Z",
              sourceSystem: "weather_forecast",
              status: "forecast",
              summary: "Předpověď srážek, větru a bouřkového rizika pro okolí Vrbna.",
              title: "Předpověď pro Vrbno pod Pradědem",
              updatedAt: requestNow.toISOString(),
              validFrom: requestNow.toISOString(),
              validUntil: new Date(requestNow.getTime() + 3 * 3600 * 1000).toISOString()
            }
          ],
          summary: {
            resultCount: 1,
            staleResultCount: 0,
            warningCount: 0
          },
          warnings: []
        };
      }
      return {
        contractVersion: "sim-search-source-v1",
        generatedAt: requestNow.toISOString(),
        providerId: "sim.search-data",
        query: request as Record<string, unknown>,
        results: [],
        summary: {
          resultCount: 0,
          staleResultCount: 0,
          warningCount: 0
        },
        warnings: []
      };
    }
    if (entityTypes.has("hydro_station") || entityTypes.has("hydro_measurement")) {
      return {
        contractVersion: "sim-search-source-v1",
        generatedAt: requestNow.toISOString(),
        providerId: "sim.search-data",
        query: request as Record<string, unknown>,
        results: [
          {
            centroid: {
              lat: 50.15077,
              lon: 17.37303
            },
            confidence: 0.97,
            dataQuality: "official_observed",
            distanceM: 180,
            entitySubtype: "water_level",
            entityType: "hydro_station",
            handling: ["dynamic_data_requires_timestamp"],
            layerIds: ["public.safety.flood"],
            metrics: {
              discharge: 0.32881,
              floodStage: 0,
              waterLevelCm: 106,
              waterTemperatureC: 15.6
            },
            observedAt: requestNow.toISOString(),
            providerEntityId: "safety:hydro:mnichov-cerna-opava",
            providerId: "sim.search-data",
            sourceAuthority: "official",
            sourceEntityId: "chmi_hydro:mnichov-cerna-opava",
            sourceRevision: "chmi_hydro:2026-05-20T12:00:00Z",
            sourceSystem: "chmi_hydro",
            status: "monitoring",
            summary: "Hydrologická stanice ČHMÚ s aktuální hladinou, průtokem a stupněm povodňové aktivity.",
            title: "Mnichov - Černá Opava",
            updatedAt: requestNow.toISOString()
          }
        ],
        summary: {
          resultCount: 1,
          staleResultCount: 0,
          warningCount: 0
        },
        warnings: []
      };
    }
    return {
      contractVersion: "sim-search-source-v1",
      generatedAt: requestNow.toISOString(),
      providerId: "sim.search-data",
      query: request as Record<string, unknown>,
      results: [
        {
          address: {
            countryCode: "CZ",
            municipality: "Vrbno pod Pradědem",
            region: "Moravskoslezský kraj"
          },
          centroid: {
            lat: 50.1209,
            lon: 17.3832
          },
          confidence: 0.92,
          dataQuality: "verified_reference",
          entitySubtype: "local_department",
          entityType: "police_station",
          layerIds: ["public.security.police"],
          providerEntityId: "police:cz:vrbno-obvodni",
          providerId: "sim.search-data",
          sourceAuthority: "reference",
          sourceEntityId: "osm:node:123456",
          sourceRevision: "osm_reference:2026-05-20",
          sourceSystem: "osm_reference",
          status: "active",
          summary: "Policejní služebna ve Vrbně pod Pradědem.",
          title: "Policie ČR - Obvodní oddělení Vrbno pod Pradědem",
          updatedAt: requestNow.toISOString()
        }
      ],
      summary: {
        resultCount: 1,
        staleResultCount: 0,
        warningCount: 0
      },
      warnings: []
    };
  }
}

class FakeAiMapSearchSituationDataSource implements SituationDataSource {
  readonly config: SituationDataSourceConfig = {
    baseUrl: "https://sim.example.test/situation-data/api/v1",
    cacheTtlMs: 20000,
    enabled: true,
    maxLimit: 250,
    timeoutMs: 7000
  };

  readonly sourceSystem = createPublicSituationAggregateSourceSystem();
  lastFeatureQuery: SituationFeatureQuery | null = null;

  async fetchLayers(): Promise<SituationLayerDescriptor[]> {
    return [
      {
        defaultVisible: false,
        expectedCadenceSeconds: 21600,
        geometryTypes: ["Point", "LineString", "Polygon"],
        label: "Ground",
        layerId: "ground"
      }
    ];
  }

  async fetchSources(): Promise<SituationSourceDescriptor[]> {
    return [
      {
        enabled: true,
        label: "Local OpenStreetMap PostGIS context",
        layers: ["ground"],
        sourceId: "osm_postgis",
        updateCadenceSeconds: 21600
      }
    ];
  }

  async fetchFeatures(query: SituationFeatureQuery, requestNow: Date): Promise<SituationFeatureCollection> {
    this.lastFeatureQuery = query;
    return {
      contractVersion: "cop-situation-source-v1",
      features: [
        {
          geometry: {
            coordinates: [17.3832, 50.1209],
            type: "Point"
          },
          id: "osm:police:vrbno",
          properties: {
            category: "police",
            featureId: "osm:police:vrbno",
            generatedAt: requestNow.toISOString(),
            label: "Policie ČR Obvodní oddělení Vrbno pod Pradědem",
            layer: "ground",
            providerLayerId: "ground",
            sourceId: "osm_postgis",
            sourceName: "Local OpenStreetMap PostGIS context",
            status: "reference"
          },
          type: "Feature"
        },
        {
          geometry: {
            coordinates: [17.389, 50.123],
            type: "Point"
          },
          id: "chmi-hydro:opava-vrbno",
          properties: {
            category: "water-gauge",
            featureId: "chmi-hydro:opava-vrbno",
            generatedAt: requestNow.toISOString(),
            label: "Vodoměrná stanice Opava - Vrbno pod Pradědem",
            layer: "ground",
            providerLayerId: "ground",
            sourceId: "chmi_hydro",
            sourceName: "ČHMÚ hydrologická měření",
            status: "reference",
            summary: "Aktuální stav hladiny řeky Opavy."
          },
          type: "Feature"
        },
        {
          geometry: {
            coordinates: [17.36, 50.13],
            type: "Point"
          },
          id: "osm:fire:vrbno",
          properties: {
            category: "fire_station",
            featureId: "osm:fire:vrbno",
            generatedAt: requestNow.toISOString(),
            label: "Hasičská stanice Vrbno",
            layer: "ground",
            providerLayerId: "ground",
            sourceId: "osm_postgis",
            sourceName: "Local OpenStreetMap PostGIS context",
            status: "reference"
          },
          type: "Feature"
        }
      ],
      generatedAt: requestNow.toISOString(),
      query,
      source: { sourceId: "situation-data-api", sourceType: "PUBLIC_SITUATION_AGGREGATE" },
      sources: await this.fetchSources(),
      summary: { featureCount: 3, sourceCount: 1, staleFeatureCount: 0, warningCount: 0 },
      type: "FeatureCollection",
      warnings: []
    };
  }
}

class FakeAiMapSearchSafetyDataSource implements SafetyDataSource {
  readonly config: SafetyDataSourceConfig = {
    baseUrl: "https://sim.example.test/safety-data/api/v1",
    cacheTtlMs: 20000,
    enabled: true,
    maxLimit: 250,
    timeoutMs: 7000
  };

  readonly sourceSystem = createPublicSafetyAggregateSourceSystem();
  lastFeatureQuery: SafetyFeatureQuery | null = null;

  async fetchConfig(): Promise<SafetyDataPublicConfig> {
    return {
      enabledSources: ["chmi_hydro"],
      requestTimeoutMs: 7000
    };
  }

  async fetchLayers(): Promise<SafetyLayerDescriptor[]> {
    return [
      {
        defaultVisible: true,
        description: "Hydrologické stanice, vodní stavy, průtoky a stupně povodňové aktivity.",
        expectedCadenceSeconds: 600,
        geometryTypes: ["Point"],
        label: "CHMI Hydro",
        layerId: "flood"
      }
    ];
  }

  async fetchSources(): Promise<SafetySourceDescriptor[]> {
    return [
      {
        enabled: true,
        label: "CHMI Hydro",
        layers: ["flood"],
        sourceId: "chmi_hydro",
        updateCadenceSeconds: 600
      }
    ];
  }

  async fetchFeatures(query: SafetyFeatureQuery, requestNow: Date): Promise<SafetyFeatureCollection> {
    this.lastFeatureQuery = query;
    return {
      contractVersion: "cop-safety-source-v1",
      features: [
        {
          geometry: {
            coordinates: [17.386, 50.121],
            type: "Point"
          },
          id: "flood:chmi_hydro:1vnc992",
          properties: {
            category: "water_level",
            featureId: "flood:chmi_hydro:1vnc992",
            headline: "Water level station",
            layer: "flood",
            layerId: "public.safety.flood",
            metrics: {
              discharge: 0.32881,
              floodStage: 0,
              waterLevelCm: 106,
              waterTemperatureC: 15.6
            },
            observedAt: requestNow.toISOString(),
            providerLayerId: "safety.flood",
            sourceId: "chmi_hydro",
            sourceName: "CHMI hydrological stations",
            status: "monitoring"
          },
          type: "Feature"
        }
      ],
      generatedAt: requestNow.toISOString(),
      query,
      source: { sourceId: "safety-data-api", sourceType: "PUBLIC_SAFETY_AGGREGATE" },
      sources: await this.fetchSources(),
      summary: {
        advisoryCount: 0,
        criticalCount: 0,
        featureCount: 1,
        sourceCount: 1,
        staleFeatureCount: 0,
        warningCount: 0
      },
      type: "FeatureCollection",
      warnings: []
    };
  }
}

class FakeAiMapSearchPlaceGeocoder implements PlaceGeocoder {
  readonly providerId = "fake-place-geocoder";
  readonly queries: string[] = [];
  readonly searchRequests: PlaceGeocodeQuery[] = [];

  async search(query: PlaceGeocodeQuery, now: Date): Promise<PlaceGeocodeResponse> {
    this.queries.push(query.query);
    this.searchRequests.push(query);
    const matched = query.query === "Vrbno pod Pradědem";
    const policeMatched = ["police", "Policie ČR", "policie", "police station"].includes(query.query) && query.bounded === true && Boolean(query.bbox);
    return {
      cache: {
        key: query.query,
        status: "miss",
        ttlSeconds: 60
      },
      contractVersion: "cop-geocode-v1",
      items: policeMatched
        ? [{
            center: [16.98407, 49.96299],
            displayName: "Městská policie Šumperk",
            id: "place:police-sumperk",
            kind: "police",
            providerId: this.providerId,
            subtitle: "amenity · police",
            zoomHint: 16
          }, {
            center: [17.3832, 50.1209],
            displayName: "Policie ČR Obvodní oddělení Vrbno pod Pradědem",
            id: "place:police-vrbno",
            kind: "police",
            providerId: this.providerId,
            subtitle: "amenity · police",
            zoomHint: 16
          }]
        : matched
        ? [{
            bbox: {
              east: 17.45,
              north: 50.16,
              south: 50.09,
              west: 17.31
            },
            center: [17.38, 50.12],
            displayName: "Vrbno pod Pradědem",
            id: "place:vrbno",
            kind: "town",
            providerId: this.providerId
          }]
        : [],
      providerId: this.providerId,
      query: {
        ...(query.bbox ? { bbox: query.bbox } : {}),
        ...(query.bounded ? { bounded: query.bounded } : {}),
        language: query.language ?? "cs",
        limit: query.limit ?? 1,
        q: query.query
      },
      serverTimestamp: now.toISOString(),
      warnings: []
    };
  }
}

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

class TransientInitFailureUserProfileStore extends InMemoryUserProfileStore {
  initAttempts = 0;

  override async init(): Promise<void> {
    this.initAttempts += 1;
    if (this.initAttempts === 1) {
      throw new Error("database is starting");
    }
    await super.init();
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
