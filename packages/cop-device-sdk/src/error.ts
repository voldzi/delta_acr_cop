import type { CopDeviceErrorCode, CopDeviceErrorPayload } from "@cop/cop-device-contract";

export class CopDeviceError extends Error {
  readonly code: CopDeviceErrorCode;
  readonly retryable: boolean;
  readonly details?: CopDeviceErrorPayload["details"];

  constructor(payload: CopDeviceErrorPayload) {
    super(payload.message);
    this.name = "CopDeviceError";
    this.code = payload.code;
    this.retryable = payload.retryable;
    this.details = payload.details;
  }
}

export function unsupported(method: string): CopDeviceError {
  return new CopDeviceError({
    code: "UNSUPPORTED",
    message: `${method} is not supported by this device adapter.`,
    retryable: false
  });
}
