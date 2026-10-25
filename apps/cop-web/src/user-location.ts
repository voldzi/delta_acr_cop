import type { UserLocation } from "./proximity-alerts";

class LocationError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message);
  }
}

function locationError(error: { code?: number }): LocationError {
  if (error.code === 1) {
    return new LocationError(
      1,
      "Přístup k poloze je zakázaný. Povolte polohu pro COP v nastavení prohlížeče a případně i v nastavení zařízení."
    );
  }
  if (error.code === 3) {
    return new LocationError(
      3,
      "Polohu se nepodařilo zaměřit v časovém limitu. Zkontrolujte zapnuté polohové služby a zkuste to znovu."
    );
  }
  return new LocationError(
    2,
    "Poloha zařízení není dostupná. Zkontrolujte polohové služby; pokud tento prohlížeč polohu nepodporuje, otevřete COP v Safari nebo Chrome."
  );
}

export async function readCurrentUserLocation(): Promise<UserLocation> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    throw new LocationError(
      2,
      "Tento prohlížeč neposkytuje polohu. Otevřete COP v prohlížeči s podporou polohových služeb, například Safari nebo Chrome."
    );
  }
  try {
    return await readPosition(false, { enableHighAccuracy: true, maximumAge: 0, timeout: 8_000 });
  } catch (error) {
    // A denied permission cannot be repaired by asking the same API again.
    if (error instanceof LocationError && error.code === 1) throw error;
    return readPosition(true, { enableHighAccuracy: false, maximumAge: 0, timeout: 16_000 });
  }
}

function readPosition(watch: boolean, options: PositionOptions): Promise<UserLocation> {
  return new Promise((resolve, reject) => {
    const geolocation = navigator.geolocation;
    let settled = false;
    let watchId: number | undefined;
    const finish = (result: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (watchId !== undefined) geolocation.clearWatch?.(watchId);
      result();
    };
    // Some embedded browsers never invoke either callback. Bound that wait too.
    const timer = setTimeout(() => finish(() => reject(locationError({ code: 3 }))), options.timeout);
    const success: PositionCallback = (position) => {
      try {
        const location = userLocationFromPosition(position);
        finish(() => resolve(location));
      } catch (error) {
        finish(() => reject(error));
      }
    };
    const failure: PositionErrorCallback = (error) => finish(() => reject(locationError(error)));
    try {
      if (watch && geolocation.watchPosition) {
        watchId = geolocation.watchPosition(success, failure, options);
        // Also clear a watch whose provider invokes a callback synchronously.
        if (settled) geolocation.clearWatch?.(watchId);
      } else {
        geolocation.getCurrentPosition(success, failure, options);
      }
    } catch (error) {
      const denied = error instanceof Error && ["SecurityError", "NotAllowedError"].includes(error.name);
      finish(() => reject(locationError({ code: denied ? 1 : 2 })));
    }
  });
}

export function userLocationFromPosition(position: GeolocationPosition): UserLocation {
  const { latitude: lat, longitude: lon } = position.coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new LocationError(2, "Poloha zařízení nemá platné souřadnice.");
  }
  return {
    accuracyM: position.coords.accuracy,
    headingDeg: Number.isFinite(position.coords.heading) ? position.coords.heading : null,
    lat,
    lon,
    speedMps: Number.isFinite(position.coords.speed) ? position.coords.speed : null,
    updatedAt: new Date().toISOString()
  };
}
