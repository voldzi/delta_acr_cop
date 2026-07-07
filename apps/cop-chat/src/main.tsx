import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChatApp } from "./ChatApp";
import "./styles.css";

interface ChatErrorBoundaryState {
  hasError: boolean;
}

class ChatErrorBoundary extends React.Component<{ children: React.ReactNode }, ChatErrorBoundaryState> {
  state: ChatErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ChatErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    // Surface the failure for diagnostics; the UI shows a safe recovery action.
    console.error("COP Chat se neočekávaně ukončil", error);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="chat-fatal-error" role="alert">
          <h1>Chat se neočekávaně ukončil</h1>
          <p>Omlouváme se, došlo k chybě. Zkuste aplikaci načíst znovu.</p>
          <button onClick={() => window.location.reload()} type="button">
            Načíst znovu
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById("root");
const rootWindow = window as Window & { __copChatRoot?: Root };

if (rootElement) {
  const root = rootWindow.__copChatRoot ?? createRoot(rootElement);
  rootWindow.__copChatRoot = root;
  root.render(
    <React.StrictMode>
      <ChatErrorBoundary>
        <ChatApp />
      </ChatErrorBoundary>
    </React.StrictMode>
  );
}
