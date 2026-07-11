import type { BridgeInboundMessage, BridgeOutboundMessage, BridgeReady, BridgeRequest } from "@cop/cop-device-contract";
import { describe, expect, it } from "vitest";
import { defaultMockCapabilities } from "./mock";
import { NativeCopDeviceAdapter, type NativeBridgeTransport } from "./native";

describe("NativeCopDeviceAdapter", () => {
  it("handshakes, correlates requests and rejects stale-session messages", async () => {
    const transport = new FakeTransport();
    const ids = ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002"];
    const adapter = new NativeCopDeviceAdapter(transport, {
      randomUUID: () => ids.shift() ?? "10000000-0000-4000-8000-000000000099",
      now: () => new Date("2026-07-11T10:00:00.000Z")
    });
    const hello = transport.sent[0];
    expect(hello?.kind).toBe("hello");
    transport.receive(readyFor(hello!.id));

    await expect(adapter.system.getCapabilities()).resolves.toMatchObject({
      adapter: "native",
      protocolVersion: "1.0.0"
    });
    const appInfoPromise = adapter.system.getAppInfo();
    await Promise.resolve();
    const request = transport.sent.at(-1) as BridgeRequest;
    transport.receive({
      kind: "response",
      protocolVersion: "1.0.0",
      id: request.id,
      sessionId: "99999999-0000-4000-8000-000000000999",
      sentAt: "2026-07-11T10:00:00.010Z",
      ok: true,
      result: { appVersion: "stale" }
    });
    transport.receive({
      kind: "response",
      protocolVersion: "1.0.0",
      id: request.id,
      sessionId: request.sessionId,
      sentAt: "2026-07-11T10:00:00.020Z",
      ok: true,
      result: { appVersion: "1.0", host: "native", platform: "ios" }
    });
    await expect(appInfoPromise).resolves.toMatchObject({ appVersion: "1.0" });
    adapter.dispose();
  });
});

class FakeTransport implements NativeBridgeTransport {
  readonly sent: BridgeOutboundMessage[] = [];
  private listener?: (message: unknown) => void;

  postMessage(message: BridgeOutboundMessage): void {
    this.sent.push(message);
  }

  subscribe(listener: (message: unknown) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }

  receive(message: BridgeInboundMessage): void {
    this.listener?.(message);
  }
}

function readyFor(id: string): BridgeReady {
  return {
    kind: "ready",
    id,
    sentAt: "2026-07-11T10:00:00.000Z",
    selectedVersion: "1.0.0",
    sessionId: "20000000-0000-4000-8000-000000000001",
    capabilities: defaultMockCapabilities(),
    limits: { maxAssetBytes: 0, maxJsonBytes: 65_536, requestTimeoutMs: 500 }
  };
}
