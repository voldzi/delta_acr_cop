export interface UserLocationWatchPolicy {
  followEnabled: boolean;
  navigationActive: boolean;
  proximityAlertEnabled: boolean;
}

export function shouldMaintainUserLocationWatch({
  followEnabled,
  navigationActive,
  proximityAlertEnabled
}: UserLocationWatchPolicy): boolean {
  return !navigationActive && (followEnabled || proximityAlertEnabled);
}

export function isPendingMapFocusRequest(request: number, handledRequest: number): boolean {
  return request > 0 && request !== handledRequest;
}
