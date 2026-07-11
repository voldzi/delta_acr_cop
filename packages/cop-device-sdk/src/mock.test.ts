import { describe, expect, it, vi } from "vitest";
import { MockCopDeviceAdapter, mockCapabilityScenarios } from "./mock";

describe("MockCopDeviceAdapter", () => {
  it("models denied, unsupported and degraded capabilities deterministically", async () => {
    const adapter = new MockCopDeviceAdapter({
      capabilities: {
        location: mockCapabilityScenarios.denied(),
        heading: mockCapabilityScenarios.unsupported(),
        tracking: mockCapabilityScenarios.degraded("Background service paused.")
      }
    });

    const snapshot = await adapter.system.getCapabilities();
    expect(snapshot.capabilities.location.permission).toBe("denied");
    expect(snapshot.capabilities.heading.availability).toBe("unsupported");
    expect(snapshot.capabilities.tracking).toMatchObject({
      availability: "temporarilyUnavailable",
      limitations: ["Background service paused."]
    });
    await expect(adapter.permissions.getStatus("location")).resolves.toBe("denied");
  });

  it("injects one-shot errors and emits events", async () => {
    const adapter = new MockCopDeviceAdapter();
    const listener = vi.fn();
    adapter.events.subscribe(listener);
    adapter.failNext("location.getCurrent", {
      code: "PERMISSION_DENIED",
      message: "Denied for test.",
      retryable: false
    });

    await expect(adapter.location.getCurrent()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    adapter.emitEvent({
      type: "permission.changed",
      occurredAt: "2026-01-01T00:00:00.000Z",
      payload: { permission: "location" }
    });
    expect(listener).toHaveBeenCalledOnce();
  });
});
