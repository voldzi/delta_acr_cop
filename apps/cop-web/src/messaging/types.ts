import type { AuthConfig, AuthSession } from "../auth";
import type {
  CommunityGroup,
  CommunityGroupVisibility,
  MessagingBootstrapResponse,
  MessagingConversationSummary,
  MessagingStatusResponse
} from "../cop-data";

export interface MessagingPanelProps {
  apiBase: string;
  authenticated: boolean;
  authConfig: AuthConfig;
  authToken?: string;
  conversations: MessagingConversationSummary[];
  conversationsError: string | null;
  communityGroups: CommunityGroup[];
  communityGroupsError: string | null;
  error: string | null;
  loading: boolean;
  pinned: boolean;
  session: AuthSession;
  status: MessagingStatusResponse | null;
  onAddGroupMember: (groupId: string, subjectId: string, displayName?: string) => Promise<CommunityGroup>;
  onClose: () => void;
  onCreateGroup: (name: string, visibility: CommunityGroupVisibility) => Promise<CommunityGroup>;
  onLogin: () => void;
  onPinnedChange: (pinned: boolean) => void;
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
  createGroupRoom(name: string, inviteUserIds?: string[]): Promise<string>;
  getRooms(): MatrixRoomSummary[];
  getTimeline(roomId: string): MatrixTimelineMessage[];
  sendMessage(roomId: string, body: string): Promise<void>;
  stop(): void;
}
