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
  if (path === "/api/v1/driver-measurements" || path.startsWith("/api/v1/driver-measurements/")) {
    const known = ["/api/v1/driver-measurements/v1/consent", "/api/v1/driver-measurements/v1/batches"];
    return { method: request.method, url: known.includes(path) ? path : "/api/v1/driver-measurements/[redacted]" };
  }
  if (path.startsWith("/api/v1/routing/planning-origin/")) {
    const known = ["/api/v1/routing/planning-origin/candidates", "/api/v1/routing/planning-origin/preview"];
    return { method: request.method, url: known.includes(path) ? path : "/api/v1/routing/planning-origin/[redacted]" };
  }
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
