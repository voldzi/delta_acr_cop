import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
const code = readFileSync("apps/cop-web/public/vcode-analytics-tiktok.js", "utf8");
function requests(referrer: string, settings = {}) {
  const calls: { body: string; credentials: string; referrerPolicy: string }[] = [];
  const window: any = {};
  runInNewContext(code, {
    window, URL, document: { referrer },
    navigator: { onLine: true, ...settings },
    fetch: (_url: string, options: typeof calls[number]) => { calls.push(options); return Promise.resolve(); }
  });
  const client = window.vcodePublicAnalytics.create({
    websiteId: "59b949ec-6052-41c7-82fe-955258ddb7e1", collectorPath: "/analytics/v2/events",
    allowedPaths: ["/demo/flood-central-bohemia"], allowedEvents: [], autoPageview: false,
    autoClick: false, captureTitle: false, captureReferrer: false, captureSources: true,
    credentials: "omit", offline: "discard"
  });
  client.pageview("/demo/flood-central-bohemia");
  client.pageview("/chat/"); client.event("contact-click", "/demo/flood-central-bohemia");
  return calls;
}
describe("reviewed TikTok runtime", () => {
  it.each(["https://tiktok.com/@fixture?query=private", "https://www.tiktok.com/video/fixture", "https://vm.tiktok.com/fixture"])("normalizes %s", referrer => {
    const calls = requests(referrer);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].body)).toEqual({ website: "59b949ec-6052-41c7-82fe-955258ddb7e1", name: "pageview", path: "/demo/flood-central-bohemia", source: "tiktok" });
    expect(calls[0].credentials).toBe("omit"); expect(calls[0].referrerPolicy).toBe("no-referrer");
  });
  it.each(["https://tiktok.com.example.org/", "https://fake-tiktok.com/", ""])("does not recognize lookalike %s", referrer => {
    expect(JSON.parse(requests(referrer)[0].body).source).toBeUndefined();
  });
  it.each([{ doNotTrack: "1" }, { globalPrivacyControl: true }, { onLine: false }])("discards suppressed traffic %j", settings => {
    expect(requests("https://tiktok.com/", settings)).toHaveLength(0);
  });
});
