export interface AsyncRefreshCoordinator {
  refresh(options?: { force?: boolean }): Promise<boolean>;
}

export function createAsyncRefreshCoordinator<T>({
  load,
  minimumIntervalMs = 5_000,
  now = Date.now,
  onError,
  onSuccess
}: {
  load: () => Promise<T>;
  minimumIntervalMs?: number;
  now?: () => number;
  onError: (error: unknown) => void;
  onSuccess: (value: T) => void;
}): AsyncRefreshCoordinator {
  let inFlight: Promise<boolean> | null = null;
  let lastStartedAt = Number.NEGATIVE_INFINITY;

  return {
    refresh({ force = false } = {}) {
      if (inFlight) {
        return inFlight;
      }
      const startedAt = now();
      if (!force && startedAt - lastStartedAt < minimumIntervalMs) {
        return Promise.resolve(false);
      }
      lastStartedAt = startedAt;
      const pending = load()
        .then((value) => {
          onSuccess(value);
          return true;
        })
        .catch((error: unknown) => {
          onError(error);
          return false;
        });
      inFlight = pending;
      const clear = () => {
        if (inFlight === pending) {
          inFlight = null;
        }
      };
      void pending.then(clear, clear);
      return pending;
    }
  };
}
