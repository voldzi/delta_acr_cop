const releaseRecoveryStorageKey = "cop.pwa.releaseRecovery.v1";
const serviceWorkerUpdateRetryDelaysMs = [1_500, 5_000] as const;
let controllerChangeListenerInstalled = false;
let controllerReloadScheduled = false;
let pendingControllerReloadCleanup: (() => void) | null = null;

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

  installControllerChangeReload();

  const register = () => {
    void navigator.serviceWorker
      .register(scriptUrl, { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        let updateInFlight: Promise<boolean> | null = null;
        const requestUpdate = () => {
          if (updateInFlight) {
            return;
          }
          updateInFlight = updateRegistrationWithRetry(registration).finally(() => {
            updateInFlight = null;
          });
        };
        requestUpdate();
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") {
            requestUpdate();
          }
        });
        window.addEventListener("online", requestUpdate);
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

async function updateRegistrationWithRetry(registration: ServiceWorkerRegistration): Promise<boolean> {
  for (let attempt = 0; attempt <= serviceWorkerUpdateRetryDelaysMs.length; attempt += 1) {
    try {
      await registration.update();
      return true;
    } catch {
      const retryDelay = serviceWorkerUpdateRetryDelaysMs[attempt];
      if (retryDelay === undefined || navigator.onLine === false) {
        return false;
      }
      await wait(retryDelay);
    }
  }
  return false;
}

function installControllerChangeReload(): void {
  if (controllerChangeListenerInstalled) {
    return;
  }
  controllerChangeListenerInstalled = true;
  let observedController = navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    const nextController = navigator.serviceWorker.controller;
    const replacedExistingController = Boolean(
      observedController && nextController && observedController !== nextController
    );
    observedController = nextController;
    if (!replacedExistingController || controllerReloadScheduled) {
      return;
    }
    controllerReloadScheduled = true;
    // The newly activated worker controls future requests, but the open document
    // still references the previous hashed CSS/JS. Reload once to make the release
    // atomic, but never discard a report, attachment or chat draft that is still
    // present in an editable control.
    reloadForControllerChangeWhenSafe();
  });
}

function reloadForControllerChangeWhenSafe(): void {
  const reload = () => {
    pendingControllerReloadCleanup?.();
    pendingControllerReloadCleanup = null;
    window.setTimeout(() => window.location.reload(), 0);
  };
  if (!documentHasPwaUserDraft()) {
    reload();
    return;
  }

  let retryScheduled = false;
  const retryWhenUiSettles = () => {
    if (retryScheduled) {
      return;
    }
    retryScheduled = true;
    window.setTimeout(() => {
      retryScheduled = false;
      if (!documentHasPwaUserDraft()) {
        reload();
      }
    }, 0);
  };
  const documentEvents = ["change", "click", "input", "keyup", "visibilitychange"] as const;
  documentEvents.forEach((type) => document.addEventListener(type, retryWhenUiSettles));
  pendingControllerReloadCleanup = () => {
    documentEvents.forEach((type) => document.removeEventListener?.(type, retryWhenUiSettles));
  };
}

export function documentHasPwaUserDraft(): boolean {
  if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") {
    return false;
  }
  const selector = [
    "textarea",
    "[contenteditable='true']",
    "input:not([type])",
    "input[type='text']",
    "input[type='search']",
    "input[type='email']",
    "input[type='tel']",
    "input[type='url']",
    "input[type='password']",
    "input[type='number']",
    "input[type='file']"
  ].join(",");
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).some((element) => {
    if (
      element.hasAttribute("disabled") ||
      element.hasAttribute("readonly") ||
      element.getAttribute("aria-hidden") === "true"
    ) {
      return false;
    }
    if (element.tagName?.toLocaleLowerCase() === "input" && element.getAttribute("type") === "file") {
      return Boolean((element as HTMLInputElement).files?.length);
    }
    if (element.isContentEditable) {
      return Boolean(element.textContent?.trim());
    }
    return "value" in element && typeof element.value === "string" && element.value.trim().length > 0;
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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
