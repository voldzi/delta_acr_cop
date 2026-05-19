import type { ObservedObject } from "@cop/canonical-model";

export type CopStreamChangeType = "OBJECT_SNAPSHOT" | "OBJECT_UPSERT";

export interface CopStreamChange {
  changeType: CopStreamChangeType;
  object: ObservedObject;
}

export type CopStreamMessage =
  | {
      changes: CopStreamChange[];
      sequence: number;
      serverTimestamp: string;
      subscriptionId: string;
      type: "snapshot";
    }
  | {
      changes: CopStreamChange[];
      sequence: number;
      serverTimestamp: string;
      type: "delta";
    }
  | {
      sequence: number;
      serverTimestamp: string;
      type: "heartbeat";
    };

type CopStreamSubscriber = (message: CopStreamMessage) => void;

export class CopStreamBroadcaster {
  private readonly subscribers = new Set<CopStreamSubscriber>();
  private sequence = 0;

  get clientCount(): number {
    return this.subscribers.size;
  }

  createHeartbeat(now: Date): CopStreamMessage {
    return {
      sequence: this.nextSequence(),
      serverTimestamp: now.toISOString(),
      type: "heartbeat"
    };
  }

  createSnapshot(subscriptionId: string, objects: ObservedObject[], now: Date): CopStreamMessage {
    return {
      changes: objects.map((object) => ({
        changeType: "OBJECT_SNAPSHOT",
        object
      })),
      sequence: this.nextSequence(),
      serverTimestamp: now.toISOString(),
      subscriptionId,
      type: "snapshot"
    };
  }

  publishObjectUpserts(objects: ObservedObject[], now: Date): CopStreamMessage | undefined {
    if (objects.length === 0) {
      return undefined;
    }

    const message: CopStreamMessage = {
      changes: objects.map((object) => ({
        changeType: "OBJECT_UPSERT",
        object
      })),
      sequence: this.nextSequence(),
      serverTimestamp: now.toISOString(),
      type: "delta"
    };
    this.publish(message);
    return message;
  }

  subscribe(subscriber: CopStreamSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  private nextSequence(): number {
    this.sequence += 1;
    return this.sequence;
  }

  private publish(message: CopStreamMessage): void {
    for (const subscriber of Array.from(this.subscribers)) {
      subscriber(message);
    }
  }
}
