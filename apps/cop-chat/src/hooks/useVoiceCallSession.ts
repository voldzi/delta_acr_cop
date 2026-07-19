import * as React from "react";
import type { LocalAudioTrack, RemoteAudioTrack, Room } from "livekit-client";
import type { MatrixTimelineMessage, MatrixVoiceCallSnapshot } from "@cop/messaging/types";

type ServerVoiceCallPhase =
  | "created"
  | "ringing"
  | "accepted"
  | "connecting_media"
  | "connected"
  | "declined"
  | "missed"
  | "cancelled"
  | "failed"
  | "ended";

interface ServerVoiceCall {
  callId: string;
  connectedAt?: string;
  createdAt: string;
  direction: "incoming" | "outgoing";
  endedAt?: string;
  endReason?: string;
  expiresAt: string;
  initiatorSubjectId: string;
  kind: "direct";
  participantSubjectIds: string[];
  phase: ServerVoiceCallPhase;
  revision: number;
  roomId: string;
  title: string;
  updatedAt: string;
}

interface VoiceCallMedia {
  expiresAt: string;
  serverUrl: string;
  token: string;
}

interface VoiceCallResponse {
  call: ServerVoiceCall;
  contractVersion: "cop-voice-call-v1";
  media?: VoiceCallMedia;
}

interface VoiceCallListResponse {
  calls: ServerVoiceCall[];
  contractVersion: "cop-voice-call-v1";
}

interface UseVoiceCallSessionOptions {
  apiBase: string;
  authToken?: string | null;
  enabled: boolean;
  onError: (message: string) => void;
}

interface VoiceCallController {
  accept(callId: string): Promise<void>;
  end(callId: string): Promise<void>;
  reject(callId: string): Promise<void>;
  setMuted(callId: string, muted: boolean): Promise<void>;
  start(input: { participantSubjectIds: string[]; roomId: string; title: string }): Promise<void>;
  timeline: Array<{
    message: MatrixTimelineMessage;
    roomId: string;
  }>;
  voiceCall: MatrixVoiceCallSnapshot | null;
}

export function useVoiceCallSession(options: UseVoiceCallSessionOptions): VoiceCallController {
  const [voiceCall, setVoiceCall] = React.useState<MatrixVoiceCallSnapshot | null>(null);
  const [timeline, setTimeline] = React.useState<VoiceCallController["timeline"]>([]);
  const callRef = React.useRef<ServerVoiceCall | null>(null);
  const roomRef = React.useRef<{ callId: string; room: Room } | null>(null);
  const mutedRef = React.useRef(false);
  const mediaConnectedReportedRef = React.useRef<string | null>(null);
  const optionsRef = React.useRef(options);
  optionsRef.current = options;

  const disconnectMedia = React.useCallback(async () => {
    const connected = roomRef.current;
    roomRef.current = null;
    mediaConnectedReportedRef.current = null;
    if (connected) {
      await connected.room.disconnect();
    }
  }, []);

  const publishSnapshot = React.useCallback((call: ServerVoiceCall | null) => {
    callRef.current = call;
    if (!call) {
      setVoiceCall(null);
      return;
    }
    const room = roomRef.current?.callId === call.callId ? roomRef.current.room : null;
    const remoteStreams = room ? remoteAudioStreams(room) : [];
    const localStream = room ? localAudioStream(room) : undefined;
    setVoiceCall({
      callId: call.callId,
      direction: call.direction,
      eligibleParticipants: [],
      ...(call.phase === "failed" ? { error: userFacingEndReason(call.endReason) } : {}),
      kind: "direct",
      ...(localStream ? { localStream } : {}),
      microphoneMuted: mutedRef.current,
      opponentUserId: call.direction === "incoming" ? call.initiatorSubjectId : call.participantSubjectIds[0],
      participants: call.participantSubjectIds.map((subjectId) => ({
        connected: call.phase === "connected",
        displayName: subjectId,
        userId: subjectId
      })),
      phase: uiPhase(call.phase),
      ...(remoteStreams[0] ? { remoteStream: remoteStreams[0] } : {}),
      ...(remoteStreams.length ? { remoteStreams } : {}),
      roomId: call.roomId,
      startedAt: call.connectedAt ?? call.createdAt
    });
  }, []);

  const request = React.useCallback(async <T>(path: string, init?: RequestInit): Promise<T> => {
    const current = optionsRef.current;
    if (!current.authToken) {
      throw new Error("Pro hovor je potřeba platné přihlášení do COP.");
    }
    const response = await fetch(`${current.apiBase}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${current.authToken}`,
        "Content-Type": "application/json",
        ...init?.headers
      }
    });
    const payload = (await response.json().catch(() => null)) as
      T | { error?: { message?: string }; message?: string } | null;
    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && "error" in payload
          ? payload.error?.message
          : payload && typeof payload === "object" && "message" in payload
            ? payload.message
            : undefined;
      throw new Error(message || `Hovor se nepodařilo zpracovat (${response.status}).`);
    }
    return payload as T;
  }, []);

  const transition = React.useCallback(
    async (
      callId: string,
      action: "accept" | "cancel" | "decline" | "end" | "media_connected" | "media_failed",
      options: { expectedRevision?: number; reason?: string } = {}
    ): Promise<VoiceCallResponse> =>
      request<VoiceCallResponse>(`/api/v1/messaging/calls/${encodeURIComponent(callId)}/actions`, {
        body: JSON.stringify({ action, ...options }),
        method: "POST"
      }),
    [request]
  );

  const reportMediaConnected = React.useCallback(
    async (callId: string) => {
      if (mediaConnectedReportedRef.current === callId) {
        return;
      }
      mediaConnectedReportedRef.current = callId;
      try {
        const response = await transition(callId, "media_connected");
        publishSnapshot(response.call);
      } catch (error) {
        mediaConnectedReportedRef.current = null;
        throw error;
      }
    },
    [publishSnapshot, transition]
  );

  const connectMedia = React.useCallback(
    async (response: VoiceCallResponse) => {
      if (!response.media) {
        throw new Error("Mediální spojení hovoru není připravené.");
      }
      if (roomRef.current?.callId === response.call.callId) {
        publishSnapshot(response.call);
        return;
      }
      await disconnectMedia();
      const { Room: LiveKitRoom, RoomEvent } = await import("livekit-client");
      const room = new LiveKitRoom({ adaptiveStream: true, dynacast: true });
      roomRef.current = { callId: response.call.callId, room };
      const refresh = () => publishSnapshot(callRef.current ?? response.call);
      const reportConnected = () => {
        refresh();
        if (room.remoteParticipants.size > 0) {
          void reportMediaConnected(response.call.callId).catch((error) => {
            optionsRef.current.onError(userFacingError(error, "Hovor se nepodařilo potvrdit."));
          });
        }
      };
      room.on(RoomEvent.ParticipantConnected, reportConnected);
      room.on(RoomEvent.ParticipantDisconnected, refresh);
      room.on(RoomEvent.TrackSubscribed, reportConnected);
      room.on(RoomEvent.TrackUnsubscribed, refresh);
      room.on(RoomEvent.Reconnected, reportConnected);
      room.on(RoomEvent.Disconnected, refresh);
      try {
        await room.connect(response.media.serverUrl, response.media.token);
        await room.localParticipant.setMicrophoneEnabled(true);
        mutedRef.current = false;
        publishSnapshot(response.call);
        reportConnected();
      } catch (error) {
        await disconnectMedia();
        try {
          await transition(response.call.callId, "media_failed", {
            reason: "livekit_connection_failed"
          });
        } catch {
          // The original media error is the useful one for the user.
        }
        throw error;
      }
    },
    [disconnectMedia, publishSnapshot, reportMediaConnected, transition]
  );

  const refresh = React.useCallback(async () => {
    if (!optionsRef.current.enabled || !optionsRef.current.authToken) {
      return;
    }
    const current = callRef.current;
    if (current && !isTerminal(current.phase)) {
      const detail = await request<VoiceCallResponse>(`/api/v1/messaging/calls/${encodeURIComponent(current.callId)}`);
      publishSnapshot(detail.call);
      if (isTerminal(detail.call.phase)) {
        await disconnectMedia();
      } else if (
        !roomRef.current &&
        (detail.call.direction === "outgoing" ||
          detail.call.phase === "accepted" ||
          detail.call.phase === "connecting_media" ||
          detail.call.phase === "connected")
      ) {
        await connectMedia(detail);
      }
      return;
    }
    const response = await request<VoiceCallListResponse>("/api/v1/messaging/calls?activeOnly=true&limit=10");
    const incoming = response.calls.find((call) => call.direction === "incoming" && call.phase === "ringing");
    const active = incoming ?? response.calls.find((call) => !isTerminal(call.phase)) ?? null;
    if (!active) {
      publishSnapshot(null);
      return;
    }
    publishSnapshot(active);
    if (
      active.direction === "outgoing" ||
      active.phase === "accepted" ||
      active.phase === "connecting_media" ||
      active.phase === "connected"
    ) {
      const detail = await request<VoiceCallResponse>(`/api/v1/messaging/calls/${encodeURIComponent(active.callId)}`);
      publishSnapshot(detail.call);
      await connectMedia(detail);
    }
  }, [connectMedia, disconnectMedia, publishSnapshot, request]);

  const refreshTimeline = React.useCallback(async () => {
    if (!optionsRef.current.enabled || !optionsRef.current.authToken) {
      setTimeline([]);
      return;
    }
    const response = await request<VoiceCallListResponse>("/api/v1/messaging/calls?activeOnly=false&limit=200");
    setTimeline(
      response.calls
        .filter((call) => isTerminal(call.phase))
        .map((call) => ({
          message: voiceCallTimelineMessage(call),
          roomId: call.roomId
        }))
    );
  }, [request]);

  React.useEffect(() => {
    if (!options.enabled || !options.authToken) {
      void disconnectMedia();
      publishSnapshot(null);
      setTimeline([]);
      return;
    }
    let disposed = false;
    const poll = async () => {
      try {
        await refresh();
      } catch (error) {
        if (!disposed) {
          optionsRef.current.onError(userFacingError(error, "Stav hovoru se nepodařilo načíst."));
        }
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [disconnectMedia, options.authToken, options.enabled, publishSnapshot, refresh]);

  React.useEffect(() => {
    if (!options.enabled || !options.authToken) {
      setTimeline([]);
      return;
    }
    const poll = async () => {
      try {
        await refreshTimeline();
      } catch {
        // Timeline refresh is background synchronization. Keep the last good
        // projection instead of interrupting the conversation with a technical
        // error that the user cannot act on.
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 15_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [options.authToken, options.enabled, refreshTimeline]);

  React.useEffect(
    () => () => {
      void disconnectMedia();
    },
    [disconnectMedia]
  );

  return {
    accept: async (callId) => {
      const current = requireCurrentCall(callRef.current, callId);
      const response = await transition(callId, "accept", { expectedRevision: current.revision });
      publishSnapshot(response.call);
      await connectMedia(response);
    },
    end: async (callId) => {
      const current = requireCurrentCall(callRef.current, callId);
      const action = current.direction === "outgoing" && current.phase === "ringing" ? "cancel" : "end";
      try {
        const response = await transition(callId, action, {
          expectedRevision: current.revision
        });
        publishSnapshot(response.call);
      } finally {
        await disconnectMedia();
        void refreshTimeline().catch(() => undefined);
      }
    },
    reject: async (callId) => {
      const current = requireCurrentCall(callRef.current, callId);
      const response = await transition(callId, "decline", {
        expectedRevision: current.revision
      });
      publishSnapshot(response.call);
      await disconnectMedia();
      void refreshTimeline().catch(() => undefined);
    },
    setMuted: async (callId, muted) => {
      requireCurrentCall(callRef.current, callId);
      const room = roomRef.current?.callId === callId ? roomRef.current.room : null;
      if (!room) {
        throw new Error("Mediální spojení hovoru není aktivní.");
      }
      await room.localParticipant.setMicrophoneEnabled(!muted);
      mutedRef.current = muted;
      publishSnapshot(callRef.current);
    },
    start: async ({ participantSubjectIds, roomId, title }) => {
      if (participantSubjectIds.length !== 1) {
        throw new Error("Hlasový hovor je dostupný pouze v přímé konverzaci.");
      }
      const response = await request<VoiceCallResponse>("/api/v1/messaging/calls", {
        body: JSON.stringify({ participantSubjectIds, roomId, title }),
        method: "POST"
      });
      publishSnapshot(response.call);
      await connectMedia(response);
    },
    timeline,
    voiceCall
  };
}

function requireCurrentCall(call: ServerVoiceCall | null, callId: string): ServerVoiceCall {
  if (!call || call.callId !== callId) {
    throw new Error("Hovor už není aktivní.");
  }
  return call;
}

function isTerminal(phase: ServerVoiceCallPhase): boolean {
  return phase === "declined" || phase === "missed" || phase === "cancelled" || phase === "failed" || phase === "ended";
}

function uiPhase(phase: ServerVoiceCallPhase): MatrixVoiceCallSnapshot["phase"] {
  switch (phase) {
    case "created":
    case "ringing":
      return "ringing";
    case "accepted":
    case "connecting_media":
      return "connecting";
    case "connected":
      return "connected";
    case "failed":
      return "failed";
    case "declined":
    case "missed":
    case "cancelled":
    case "ended":
      return "ended";
  }
}

function remoteAudioStreams(room: Room): MediaStream[] {
  const streams: MediaStream[] = [];
  for (const participant of room.remoteParticipants.values()) {
    for (const publication of participant.audioTrackPublications.values()) {
      const track = publication.track as RemoteAudioTrack | undefined;
      if (track?.mediaStreamTrack) {
        streams.push(new MediaStream([track.mediaStreamTrack]));
      }
    }
  }
  return streams;
}

function localAudioStream(room: Room): MediaStream | undefined {
  for (const publication of room.localParticipant.audioTrackPublications.values()) {
    const track = publication.track as LocalAudioTrack | undefined;
    if (track?.mediaStreamTrack) {
      return new MediaStream([track.mediaStreamTrack]);
    }
  }
  return undefined;
}

function userFacingEndReason(reason: string | undefined): string {
  switch (reason) {
    case "push_delivery_failed":
      return "Volaného se nepodařilo upozornit.";
    case "media_timeout":
      return "Mediální spojení se nepodařilo navázat včas.";
    case "livekit_connection_failed":
      return "Hlasové spojení se nepodařilo navázat.";
    default:
      return "Hovor se nepodařilo spojit.";
  }
}

function userFacingError(error: unknown, fallback: string): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Povolte prosím COP přístup k mikrofonu a zkuste hovor znovu.";
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

function voiceCallTimelineMessage(call: ServerVoiceCall): MatrixTimelineMessage {
  return {
    body: voiceCallTimelineLabel(call),
    eventId: `voice-call:${call.callId}`,
    kind: "text",
    own: call.direction === "outgoing",
    sender: call.initiatorSubjectId,
    senderDisplayName: call.title,
    timestamp: call.endedAt ?? call.updatedAt
  };
}

function voiceCallTimelineLabel(call: ServerVoiceCall): string {
  switch (call.phase) {
    case "missed":
      return call.direction === "incoming" ? "Nepřijatý hovor" : "Volaný hovor · bez odpovědi";
    case "declined":
      return call.direction === "incoming" ? "Odmítnutý hovor" : "Volaný hovor · odmítnuto";
    case "cancelled":
      return "Zrušený hovor";
    case "failed":
      return `Neúspěšný hovor · ${userFacingEndReason(call.endReason)}`;
    case "ended": {
      const duration = callDurationLabel(call);
      return duration ? `Hovor · ${duration}` : "Ukončený hovor";
    }
    case "created":
    case "ringing":
    case "accepted":
    case "connecting_media":
    case "connected":
      return "Hovor";
  }
}

function callDurationLabel(call: ServerVoiceCall): string | null {
  const startedAt = Date.parse(call.connectedAt ?? "");
  const endedAt = Date.parse(call.endedAt ?? "");
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) {
    return null;
  }
  const totalSeconds = Math.max(0, Math.round((endedAt - startedAt) / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
