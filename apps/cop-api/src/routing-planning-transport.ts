import { isHttpUrlWithoutCredentials, readBoundedBody } from "./bounded-upstream.js";

export interface PlanningTransportContext { actor: string; correlationId: string }
const admittedCodes = new Set(["PLANNING_ORIGIN_CONTEXT_EXPIRED", "PLANNING_ORIGIN_DATASET_CHANGED", "PLANNING_ORIGIN_SELECTION_INVALID",
  "ROUTING_LOCATION_NOT_ROUTABLE", "ROUTING_TARGET_NOT_ROUTABLE", "ROUTING_WAYPOINT_NOT_ROUTABLE", "ROUTING_RESTRICTIONS_RELAXATION_REQUIRED",
  "PLANNING_ORIGIN_LIMIT_EXCEEDED", "ROUTING_BUSY", "PLANNING_ORIGIN_UNAVAILABLE", "ROUTING_KNOWN_CLOSURES_UNAVAILABLE",
  "ROUTING_KNOWN_CLOSURES_CHANGED", "ROUTING_GRAPH_STALE", "ROUTING_PROFILE_UNAVAILABLE", "ROUTING_KNOWN_CLOSURES_ENGINE_FAILED"]);
export class PlanningTransportError extends Error {
  constructor(readonly statusCode: number, readonly retryAfter?: string, readonly code = "PLANNING_ORIGIN_UNAVAILABLE") {
    super("Planning source request failed.");
    this.name = "PlanningTransportError";
  }
}

/** Separate from ordinary routing: no implicit credential reuse, retry or fallback. */
export class PlanningOriginTransport {
  readonly #token: string;
  readonly #root: URL;
  readonly #timeoutMs: number;

  constructor(baseUrl: string, token: string, timeoutMs = 15_000) {
    try {
      const root = new URL(`${baseUrl.replace(/\/$/u, "")}/`);
      if (!isHttpUrlWithoutCredentials(root) || root.search || root.hash ||
        !token || token.length > 8192 || /\s/u.test(token) ||
        !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60_000) throw new Error();
      this.#root = root;
      this.#token = token;
      this.#timeoutMs = timeoutMs;
    } catch { throw new Error("Planning source configuration is invalid."); }
  }

  async request(operation: "candidates" | "preview", body: unknown, context: PlanningTransportContext): Promise<unknown> {
    if (!["candidates", "preview"].includes(operation) || !/^[a-f0-9]{64}$/u.test(context.actor) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(context.correlationId)) {
      throw new PlanningTransportError(503);
    }
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await fetch(new URL(`routing/planning-origin/${operation}`, this.#root), {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { Accept: "application/json", "Content-Type": "application/json",
          Authorization: `Bearer ${this.#token}`, "X-COP-Planning-Actor": context.actor,
          "X-Correlation-ID": context.correlationId },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        let code = "PLANNING_ORIGIN_UNAVAILABLE";
        try {
          const body: unknown = JSON.parse((await readBoundedBody(response, 8192)).toString("utf8"));
          if (body && typeof body === "object" && "code" in body && typeof body.code === "string" && admittedCodes.has(body.code)) code = body.code;
        } catch { /* Never expose upstream text or make another request. */ }
        // Service credentials are COP configuration, not the user's login.
        const status = [409, 422, 429, 503].includes(response.status) ? response.status : 502;
        const mappedStatus = [401, 403].includes(response.status) ? 503 : status;
        const retry = response.headers.get("retry-after");
        const retryAfter = mappedStatus === 429 && retry && /^\d{1,5}$/u.test(retry) && Number(retry) <= 86400 ? retry : undefined;
        throw new PlanningTransportError(mappedStatus, retryAfter, [401, 403, 400].includes(response.status) ? "PLANNING_ORIGIN_UNAVAILABLE" : code);
      }
      if (response.status !== 200) { await response.body?.cancel(); throw new PlanningTransportError(502); }
      return JSON.parse((await readBoundedBody(response, 2 * 1024 * 1024)).toString("utf8")) as unknown;
    } catch (error) {
      if (error instanceof PlanningTransportError) throw error;
      throw new PlanningTransportError(503);
    } finally { clearTimeout(deadline); }
  }
}
