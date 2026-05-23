import type { AuthConfig, AuthSession } from "../auth";
import type { MessagingBootstrapResponse, MessagingStatusResponse } from "../cop-data";

export interface MessagingPanelProps {
  apiBase: string;
  authenticated: boolean;
  authConfig: AuthConfig;
  authToken?: string;
  error: string | null;
  loading: boolean;
  session: AuthSession;
  status: MessagingStatusResponse | null;
  onClose: () => void;
  onLogin: () => void;
  onRefresh: () => void;
}

export interface MatrixRoomSummary {
  encrypted: boolean;
  name: string;
  roomId: string;
  unreadCount: number;
}

export interface MatrixTimelineMessage {
  body: string;
  eventId: string;
  own: boolean;
  sender: string;
  timestamp: string;
}

export interface MatrixMessagingSession {
  bootstrap: MessagingBootstrapResponse;
  getRooms(): MatrixRoomSummary[];
  getTimeline(roomId: string): MatrixTimelineMessage[];
  sendMessage(roomId: string, body: string): Promise<void>;
  stop(): void;
}
