/** Limits apply while reading the response, including when Content-Length is absent. */
export class UpstreamBodyTooLargeError extends Error {
  constructor() {
    super("Upstream response exceeded its permitted size.");
    this.name = "UpstreamBodyTooLargeError";
  }
}

export async function readBoundedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new UpstreamBodyTooLargeError();
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new UpstreamBodyTooLargeError();
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function fetchBoundedProxyResource(
  initialUrl: URL,
  options: {
    headers: Record<string, string>;
    isAllowedUrl: (url: URL) => boolean;
    maxBytes: number;
    timeoutMs: number;
  }
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  let url = initialUrl;
  try {
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      if (!isHttpUrlWithoutCredentials(url) || !options.isAllowedUrl(url)) {
        throw new Error("Upstream redirect destination is not allowed.");
      }
      const response = await fetch(url.toString(), {
        headers: options.headers,
        redirect: "manual",
        signal: controller.signal
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || redirects === 3) throw new Error("Upstream redirect limit exceeded.");
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        return new Response(null, { headers: response.headers, status: response.status });
      }
      const body = await readBoundedBody(response, options.maxBytes);
      return new Response(response.status === 204 || response.status === 205 ? null : new Uint8Array(body), {
        headers: response.headers,
        status: response.status
      });
    }
    throw new Error("Upstream redirect limit exceeded.");
  } finally {
    // Fetch resolves at headers; retain the deadline until the body has finished.
    clearTimeout(timeout);
  }
}

export function isHttpUrlWithoutCredentials(url: URL): boolean {
  return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
}
