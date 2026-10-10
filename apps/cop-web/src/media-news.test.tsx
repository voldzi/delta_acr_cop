// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaNewsPanel, parseMediaNewsSnapshot } from "./media-news";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("separate editorial news panel", () => {
  it("shows attributed safe links without distance, event time or regional incident claims", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(sample())));
    vi.stubGlobal("fetch", fetcher);
    render(<MediaNewsPanel apiBase="" token="synthetic-user-token" enabled online visible />);
    const link = await screen.findByRole("link", { name: "Syntetický titulek" });
    expect(link.getAttribute("href")).toBe("https://ct24.ceskatelevize.cz/clanek/test");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText(/Česká televize \/ ČT24/)).toBeTruthy();
    expect(screen.getByText(/Nejde o oficiální krizové výstrahy/)).toBeTruthy();
    expect(screen.queryByText(/CZ080|km od|ve vašem kraji/)).toBeNull();
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("/api/v1/safety/context/news");
  });
  it("does not query while offline or hidden and treats failure as unavailable", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("down", { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    const view = render(<MediaNewsPanel apiBase="" enabled online={false} visible />);
    expect(fetcher).not.toHaveBeenCalled();
    view.rerender(<MediaNewsPanel apiBase="" enabled online visible={false} />);
    expect(fetcher).not.toHaveBeenCalled();
    view.rerender(<MediaNewsPanel apiBase="" enabled online visible />);
    await waitFor(() => expect(screen.getByText("Zpravodajský kontext nyní není dostupný.")).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("rejects clickable lookalikes, HTML and classified/located news", () => {
    const payload = sample();
    for (const change of [
      { link: "https://evil.invalid/" },
      { title: "<script>alert(1)</script>" },
      { notificationEligible: true },
      { location: { lat: 50, lon: 14 } }
    ]) {
      expect(() => parseMediaNewsSnapshot({ ...payload, items: [{ ...payload.items[0], ...change }] })).toThrow();
    }
  });
});
function sample() {
  return {
    contractVersion: "sim-crisis-media-context-v1",
    status: "ok",
    informationalOnly: true,
    notificationEligible: false,
    items: [
      {
        id: "synthetic",
        title: "Syntetický titulek",
        link: "https://ct24.ceskatelevize.cz/clanek/test",
        publishedAt: new Date().toISOString(),
        regionCode: "CZ080",
        regionScope: "feed",
        location: null,
        locationStatus: "unresolved",
        informationalOnly: true,
        notificationEligible: false,
        stale: false,
        source: { attribution: "Česká televize / ČT24" }
      }
    ]
  };
}
