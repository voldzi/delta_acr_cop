import * as React from "react";

export function useVisibleNow(enabled: boolean, intervalMs: number): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    let timer: number | null = null;
    const clearTimer = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    const syncTimer = () => {
      clearTimer();
      if (document.visibilityState !== "visible") {
        return;
      }
      setNow(Date.now());
      timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    };
    document.addEventListener("visibilitychange", syncTimer);
    syncTimer();
    return () => {
      document.removeEventListener("visibilitychange", syncTimer);
      clearTimer();
    };
  }, [enabled, intervalMs]);
  return now;
}
