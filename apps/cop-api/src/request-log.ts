/** Operational request logs need the route, never OAuth codes, signed media tickets or coordinates. */
export function safeRequestLog(request: {
  method: string;
  url: string;
  headers?: Record<string, unknown>;
  host?: string;
  ip?: string;
  socket?: { remotePort?: number };
}): Record<string, unknown> {
  const path = request.url.split(/[?#]/u, 1)[0] ?? "/";
  return {
    method: request.method,
    // Pairing invitations are credentials carried in a path segment.
    url: path.startsWith("/mobile/pair/") ? "/mobile/pair/[redacted]" : path,
    version: request.headers?.["accept-version"],
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort
  };
}
