const releaseRecoveryStorageKey = "cop.pwa.releaseRecovery.v1";

export interface CopPwaRegistrationOptions {
  enabled: boolean;
  scriptUrl?: string;
}

export function registerCopPwaServiceWorker({
  enabled,
  scriptUrl = "/cop-service-worker.js"
}: CopPwaRegistrationOptions): void {
  if (
    !enabled ||
    typeof window === "undefined" ||
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator)
  ) {
    return;
  }

  const register = () => {
    void navigator.serviceWorker
      .register(scriptUrl, { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        void registration.update().catch(() => undefined);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") {
            void registration.update().catch(() => undefined);
          }
        });
      })
      .catch(() => {
        // A blocked service worker must not prevent the online application from starting.
      });
  };

  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
}

export function isStalePwaReleaseError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  return /ChunkLoadError|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed/iu.test(
    message
  );
}

export async function recoverStalePwaRelease(error: unknown): Promise<boolean> {
  if (
    !isStalePwaReleaseError(error) ||
    typeof window === "undefined" ||
    typeof navigator === "undefined" ||
    navigator.onLine === false ||
    releaseRecoveryAlreadyAttempted()
  ) {
    return false;
  }

  markReleaseRecoveryAttempted();
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
    if ("caches" in window) {
      const keys = await window.caches.keys();
      await Promise.all(
        keys.filter((key) => key.startsWith("cop-pwa-offline-")).map((key) => window.caches.delete(key))
      );
    }
  } finally {
    window.location.reload();
  }
  return true;
}

function releaseRecoveryAlreadyAttempted(): boolean {
  try {
    return window.sessionStorage.getItem(releaseRecoveryStorageKey) === window.location.pathname;
  } catch {
    return false;
  }
}

function markReleaseRecoveryAttempted(): void {
  try {
    window.sessionStorage.setItem(releaseRecoveryStorageKey, window.location.pathname);
  } catch {
    // Reload is still useful when session storage is unavailable.
  }
}
