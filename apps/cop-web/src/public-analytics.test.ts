import { describe, expect, it, vi } from "vitest";
import { createPublicAnalyticsBridge, publicAnalyticsPaths, permitsPublicAnalytics } from "./public-analytics";

const websiteId = "12345678-1234-1234-1234-123456789abc";
function harness(enabled = true) {
  let path = publicAnalyticsPaths[0] as string;
  let permitted = true;
  let host = "cop.zeleznalady.cz";
  const pageview = vi.fn();
  const create = vi.fn(() => ({ pageview }));
  const load = vi.fn(async () => ({ contractVersion: "vcode-public-v1" as const, create }));
  const observe = createPublicAnalyticsBridge(
    { enabled, websiteId },
    {
      pathname: () => path,
      hostname: () => host,
      permitted: () => permitted,
      load
    }
  );
  return {
    observe,
    pageview,
    create,
    load,
    path: (value: string) => {
      path = value;
    },
    permitted: (value: boolean) => {
      permitted = value;
    },
    host: (value: string) => {
      host = value;
    }
  };
}
describe("public demo analytics boundary", () => {
  it("disabled build never loads runtime", async () => {
    const h = harness(false);
    await h.observe();
    expect(h.load).not.toHaveBeenCalled();
  });
  it.each([
    "/",
    "/chat/",
    "/mobile/pair/secret",
    "/globe",
    "/xr",
    "/demo/private",
    "/demo/flood-central-bohemia/",
    "/ardos-demo",
    "/demo/flood-central-bohemia?secret=1"
  ])("rejects exact nonpublic path %s before loading", async (path) => {
    const h = harness();
    h.path(path);
    await h.observe();
    expect(h.load).not.toHaveBeenCalled();
  });
  it("deduplicates StrictMode and concurrent SPA observations", async () => {
    const h = harness();
    await Promise.all([h.observe(), h.observe(), h.observe()]);
    expect(h.pageview.mock.calls).toEqual([["/demo/flood-central-bohemia"]]);
    expect(h.create).toHaveBeenCalledWith({
      websiteId,
      collectorPath: "/analytics/v1/events",
      allowedPaths: publicAnalyticsPaths,
      allowedEvents: [],
      autoPageview: false,
      autoClick: false,
      captureTitle: false,
      captureReferrer: false,
      credentials: "omit",
      offline: "discard"
    });
  });
  it("DNT/GPC/offline permission blocks both loading and sending", async () => {
    const h = harness();
    h.permitted(false);
    await h.observe();
    expect(h.load).not.toHaveBeenCalled();
    h.permitted(true);
    const pending = h.observe();
    h.permitted(false);
    await pending;
    expect(h.pageview).not.toHaveBeenCalled();
  });
  it("private navigation during runtime loading cancels public event", async () => {
    const h = harness();
    const pending = h.observe();
    h.path("/chat/");
    await h.observe();
    await pending;
    expect(h.pageview).not.toHaveBeenCalled();
  });
  it("allows one new pageview after a genuine leave and return", async () => {
    const h = harness();
    await h.observe();
    h.path("/");
    await h.observe();
    h.path(publicAnalyticsPaths[0]);
    await h.observe();
    expect(h.pageview).toHaveBeenCalledTimes(2);
  });
  it("rejects a different hostname", async () => {
    const h = harness();
    h.host("cop.example.invalid");
    await h.observe();
    expect(h.load).not.toHaveBeenCalled();
  });
  it("does not retry or propagate runtime errors", async () => {
    const h = harness();
    h.load.mockRejectedValue(new Error("offline"));
    await h.observe();
    await h.observe();
    expect(h.load).toHaveBeenCalledTimes(1);
    expect(h.pageview).not.toHaveBeenCalled();
  });
});

describe("browser privacy signals", () => {
  it.each([
    { online: false, dnt: null },
    { online: true, dnt: "1" },
    { online: true, dnt: null, windowDnt: "1" },
    { online: true, dnt: null, gpc: true }
  ])("suppresses %j", (settings) => {
    expect(permitsPublicAnalytics(settings)).toBe(false);
  });
  it("allows an online browser without suppression", () => {
    expect(permitsPublicAnalytics({ online: true, dnt: "0", gpc: false })).toBe(true);
  });
});
