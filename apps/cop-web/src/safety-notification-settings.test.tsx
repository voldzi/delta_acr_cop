// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SafetyNotificationSettings, setSafetyNotificationConsent } from "./safety-notification-settings";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const props = {
  authenticated: true,
  enabled: false,
  deviceRegistered: true,
  watchedAreaCount: 1,
  saving: false,
  profileReady: true,
  error: null,
  onChange: vi.fn(),
  onRegisterDevice: vi.fn()
};

describe("explicit safety push consent", () => {
  it("requires an account, watched area and confirmed device for opt-in", () => {
    const view = render(<SafetyNotificationSettings {...props} authenticated={false} />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    view.rerender(<SafetyNotificationSettings {...props} watchedAreaCount={0} />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    view.rerender(<SafetyNotificationSettings {...props} deviceRegistered={false} />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Povolit oznámení na tomto zařízení" })).toBeTruthy();
    view.rerender(<SafetyNotificationSettings {...props} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(props.onChange).toHaveBeenCalledWith(true);
  });
  it("allows explicit revoke without a watched area or device", () => {
    const onChange = vi.fn();
    render(
      <SafetyNotificationSettings
        {...props}
        enabled
        deviceRegistered={false}
        watchedAreaCount={0}
        onChange={onChange}
      />
    );
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(false);
  });
  it("writes only own consent over authenticated COP route, then confirms revoke", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) =>
        new Response(
          JSON.stringify({
            contractVersion: "cop-safety-notification-consent-v1",
            enabled: JSON.parse(String(init?.body)).enabled,
            updatedAt: "2026-10-10T12:00:00Z"
          })
        )
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(setSafetyNotificationConsent("", "user-a", true)).resolves.toMatchObject({ enabled: true });
    await expect(setSafetyNotificationConsent("", "user-b", false)).resolves.toMatchObject({ enabled: false });
    expect(fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { enabled: true },
      { enabled: false }
    ]);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer user-a" });
    expect(fetcher.mock.calls[1]?.[1]?.headers).toMatchObject({ Authorization: "Bearer user-b" });
    expect(fetcher.mock.calls.every(([url]) => String(url) === "/api/v1/me/notifications/safety")).toBe(true);
  });
  it("does not claim consent on missing confirmation or service errors", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ contractVersion: "wrong", enabled: true })));
    vi.stubGlobal("fetch", fetcher);
    await expect(setSafetyNotificationConsent("", "user-a", true)).rejects.toThrow("nepodařilo");
    await expect(setSafetyNotificationConsent("", "user-a", true)).rejects.toThrow("nepotvrdil");
  });
});
