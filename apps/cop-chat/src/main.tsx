import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { recoverStalePwaRelease, registerCopPwaServiceWorker } from "@cop/core/pwa-release";
import { ChatApp } from "./ChatApp";
import "./styles.css";

interface ChatErrorBoundaryState {
  error: Error | null;
  hasError: boolean;
  recovering: boolean;
}

class ChatErrorBoundary extends React.Component<{ children: React.ReactNode }, ChatErrorBoundaryState> {
  state: ChatErrorBoundaryState = { error: null, hasError: false, recovering: false };

  static getDerivedStateFromError(error: Error): ChatErrorBoundaryState {
    return { error, hasError: true, recovering: false };
  }

  componentDidCatch(error: Error): void {
    // Surface the failure for diagnostics; the UI shows a safe recovery action.
    console.error("COP Chat se neočekávaně ukončil", error);
    void recoverStalePwaRelease(error).then((recovering) => {
      if (recovering) {
        this.setState({ recovering: true });
      }
    });
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="chat-fatal-error" role="alert">
          <h1>Chat se neočekávaně ukončil</h1>
          <p>{this.state.recovering ? "Načítám aktuální verzi chatu…" : "Zkuste chat načíst znovu."}</p>
          {this.state.error?.message ? <code>{this.state.error.message}</code> : null}
          <button onClick={() => window.location.reload()} type="button">
            Načíst znovu
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

registerCopPwaServiceWorker({ enabled: import.meta.env.PROD });

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
