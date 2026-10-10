import { createHash } from "node:crypto";
import type { AoiRule } from "./alerts.js";
import type { MessagingNotificationIntakeResponse } from "./messaging-provider.js";
import { buildSafetyCandidateNotificationDecision, type CopNotificationDecision } from "./notification-decision.js";
import type { SafetyBbox } from "./safety-data-source.js";
import type {
  SafetyNotificationCandidate,
  SafetyNotificationCandidateCollection,
  SafetyNotificationCandidateQuery
} from "./safety-notification-candidates.js";
import type { SafetyNotificationStore } from "./safety-notification-store.js";
import type { UserProfileRecord, UserProfileStore } from "./user-profile-store.js";

export interface SafetyNotificationWorkerConfig {
  enabled: boolean;
  intervalMs: number;
  pageSize: number;
  maxProfilesPerTick: number;
  maxDispatchesPerTick: number;
  concurrency: number;
  cacheTtlMs: number;
  maxRunMs: number;
  retryMs: number;
  hydroCooldownMs: number;
}

export interface SafetyNotificationWorkerState {
  enabled: boolean;
  running: boolean;
  status: "disabled" | "idle" | "running" | "degraded" | "stopped";
  lastCompletedAt?: string;
  lastFailure?: "candidate_source_unavailable" | "recipient_store_unavailable" | "notification_dispatch_unavailable" | "worker_store_unavailable";
  profilesExamined: number;
  candidatesExamined: number;
  acceptedCount: number;
  skippedCount: number;
  failedCount: number;
}

export interface SafetyNotificationRecipientResult {
  acceptedCount: number;
  skippedCount: number;
  failedCount: number;
}

export interface SafetyNotificationWorkerDependencies {
  /** The configured primary stores, never active*Store() fallback helpers. */
  profileStore: UserProfileStore;
  notificationStore: SafetyNotificationStore;
  fetchCandidates(query: SafetyNotificationCandidateQuery, now: Date): Promise<SafetyNotificationCandidateCollection>;
  hasEligibleDevice(subjectId: string, now: Date): Promise<boolean>;
  /** Call existing provider with actor=undefined and the exact decision audience. */
  dispatch(decision: CopNotificationDecision, now: Date): Promise<MessagingNotificationIntakeResponse>;
  now?: () => Date;
  onState?: (state: SafetyNotificationWorkerState) => void;
}

export function safetyNotificationWorkerConfigFromEnv(env: Record<string, string | undefined> = process.env): SafetyNotificationWorkerConfig {
  return {
    enabled: env.COP_SAFETY_NOTIFICATION_WORKER_ENABLED === "true",
    intervalMs: integer(env.COP_SAFETY_NOTIFICATION_INTERVAL_MS, 60000, 15000, 300000),
    pageSize: integer(env.COP_SAFETY_NOTIFICATION_PAGE_SIZE, 50, 1, 100),
    maxProfilesPerTick: integer(env.COP_SAFETY_NOTIFICATION_MAX_PROFILES, 200, 1, 1000),
    maxDispatchesPerTick: integer(env.COP_SAFETY_NOTIFICATION_MAX_DISPATCHES, 50, 1, 200),
    concurrency: integer(env.COP_SAFETY_NOTIFICATION_CONCURRENCY, 2, 1, 4),
    cacheTtlMs: integer(env.COP_SAFETY_NOTIFICATION_CACHE_MS, 30000, 0, 60000),
    maxRunMs: integer(env.COP_SAFETY_NOTIFICATION_MAX_RUN_MS, 30000, 1000, 120000),
    retryMs: integer(env.COP_SAFETY_NOTIFICATION_RETRY_MS, 60000, 15000, 300000),
    hydroCooldownMs: integer(env.COP_SAFETY_NOTIFICATION_HYDRO_COOLDOWN_MS, 3600000, 60000, 86400000)
  };
}

interface CandidateCacheEntry {
  expiresAt: number;
  collection: SafetyNotificationCandidateCollection;
}

/** A bounded poller. No raw source responses, user IDs, coordinates or notification text are logged. */
export class SafetyNotificationWorker {
  private readonly now: () => Date;
  private timer?: ReturnType<typeof setTimeout>;
  private activeRun?: Promise<SafetyNotificationWorkerState>;
  private stopping = false;
  private started = false;
  private cursor?: string;
  private backoffMs = 0;
  private readonly cache = new Map<string, CandidateCacheEntry>();
  private state: SafetyNotificationWorkerState;

  constructor(private readonly dependencies: SafetyNotificationWorkerDependencies, private readonly config: SafetyNotificationWorkerConfig) {
    this.now = dependencies.now ?? (() => new Date());
    this.state = {
      enabled: config.enabled, running: false, status: config.enabled ? "idle" : "disabled",
      profilesExamined: 0, candidatesExamined: 0, acceptedCount: 0, skippedCount: 0, failedCount: 0
    };
  }

  snapshot(): SafetyNotificationWorkerState { return { ...this.state }; }

  start(): void {
    if (!this.config.enabled || this.started) return;
    this.started = true;
    this.stopping = false;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.activeRun) await this.activeRun;
    this.state.status = this.config.enabled ? "stopped" : "disabled";
    this.emit();
  }

  runOnce(): Promise<SafetyNotificationWorkerState> {
    if (this.activeRun) return this.activeRun;
    if (!this.config.enabled || this.stopping) return Promise.resolve(this.snapshot());
    const run = this.execute();
    this.activeRun = run;
    void run.finally(() => { if (this.activeRun === run) this.activeRun = undefined; });
    return run;
  }

  /** The HTTP caller must independently authorize this exact persisted subjectId. */
  async runForRecipient(subjectId: string, candidates: SafetyNotificationCandidate[]): Promise<SafetyNotificationRecipientResult> {
    const result: SafetyNotificationRecipientResult = { acceptedCount: 0, skippedCount: 0, failedCount: 0 };
    if (!this.config.enabled || this.stopping) return { ...result, skippedCount: candidates.length };
    let dispatches = 0;
    for (const candidate of candidates.slice(0, 500)) {
      const outcome = await this.dispatchCandidate(subjectId, candidate, () => true, () => {
        if (dispatches >= this.config.maxDispatchesPerTick) return false;
        dispatches += 1;
        return true;
      });
      result[outcome === "accepted" ? "acceptedCount" : outcome === "failed" ? "failedCount" : "skippedCount"] += 1;
    }
    return result;
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.runOnce().finally(() => {
        if (this.started && !this.stopping) this.schedule(Math.max(this.config.intervalMs, this.backoffMs));
      });
    }, delayMs);
    this.timer.unref();
  }

  private async execute(): Promise<SafetyNotificationWorkerState> {
    this.state = {
      enabled: true, running: true, status: "running",
      profilesExamined: 0, candidatesExamined: 0, acceptedCount: 0, skippedCount: 0, failedCount: 0,
      ...(this.state.lastCompletedAt ? { lastCompletedAt: this.state.lastCompletedAt } : {})
    };
    this.emit();
    const startedAt = Date.now();
    let dispatches = 0;
    try {
      await this.dependencies.notificationStore.withWorkerLease(async (leaseValid) => {
        while (!this.stopping && leaseValid() && this.state.profilesExamined < this.config.maxProfilesPerTick
          && dispatches < this.config.maxDispatchesPerTick && Date.now() - startedAt < this.config.maxRunMs) {
          let profiles: UserProfileRecord[];
          try {
            profiles = await this.dependencies.profileStore.listSafetyNotificationProfiles(
              this.cursor, Math.min(this.config.pageSize, this.config.maxProfilesPerTick - this.state.profilesExamined)
            );
          } catch {
            this.failure("recipient_store_unavailable");
            break;
          }
          if (profiles.length === 0) { this.cursor = undefined; break; }
          let nextIndex = 0;
          let pageIncomplete = false;
          await Promise.all(Array.from({ length: Math.min(this.config.concurrency, profiles.length) }, async () => {
            while (nextIndex < profiles.length && !this.stopping && leaseValid()
              && dispatches < this.config.maxDispatchesPerTick && Date.now() - startedAt < this.config.maxRunMs) {
              const profile = profiles[nextIndex++];
              if (!profile) continue;
              this.state.profilesExamined += 1;
              if (!hasConsentAndAreas(profile)) { this.state.skippedCount += 1; continue; }
              let candidates: SafetyNotificationCandidate[];
              try { candidates = await this.candidatesForProfile(profile, startedAt + this.config.maxRunMs); } catch {
                this.failure("candidate_source_unavailable");
                continue;
              }
              for (const candidate of candidates) {
                if (this.stopping || !leaseValid() || dispatches >= this.config.maxDispatchesPerTick
                  || Date.now() - startedAt >= this.config.maxRunMs) { pageIncomplete = true; break; }
                this.state.candidatesExamined += 1;
                const outcome = await this.dispatchCandidate(profile.subjectId, candidate, leaseValid, () => {
                  if (dispatches >= this.config.maxDispatchesPerTick) return false;
                  dispatches += 1;
                  return true;
                });
                if (outcome === "accepted") this.state.acceptedCount += 1;
                else if (outcome === "skipped") this.state.skippedCount += 1;
                else this.failure("notification_dispatch_unavailable");
              }
            }
          }));
          // If the budget cuts a page, revisit it: already accepted recipients are durable deduplicated.
          if (nextIndex < profiles.length || pageIncomplete) break;
          this.cursor = profiles.at(-1)?.subjectId;
          if (profiles.length < this.config.pageSize) { this.cursor = undefined; break; }
        }
      });
    } catch { this.failure("worker_store_unavailable"); }
    this.state.running = false;
    if (this.state.failedCount > 0) {
      this.state.status = "degraded";
      this.backoffMs = Math.min(300000, Math.max(this.config.intervalMs, this.backoffMs * 2));
    } else {
      this.state.status = "idle";
      this.backoffMs = 0;
      this.state.lastCompletedAt = this.now().toISOString();
    }
    this.emit();
    return this.snapshot();
  }

  private async dispatchCandidate(
    subjectId: string,
    candidate: SafetyNotificationCandidate,
    leaseValid: () => boolean,
    reserveDispatch: () => boolean
  ): Promise<"accepted" | "skipped" | "failed"> {
    try {
      return await this.dependencies.profileStore.withSafetyNotificationProfile(subjectId, async (current, profileLeaseValid) => {
        if (!current || current.subjectId !== subjectId || !hasConsentAndAreas(current)
          || this.stopping || (!leaseValid() || !profileLeaseValid())) return "skipped";
        const requestNow = this.now();
        const decision = buildSafetyCandidateNotificationDecision(candidate, {
          actor: { subjectId: current.subjectId }, now: requestNow,
          watchedAreas: current.alertPreferences.aoiRules,
          minimumSeverity: current.alertPreferences.minimumSeverity === "critical" ? "critical" : "warning"
        });
        const expiresAt = decision.notification.expiresAt ? new Date(decision.notification.expiresAt) : undefined;
        if (!decision.shouldSend || !expiresAt || !Number.isFinite(expiresAt.getTime())
          || expiresAt.getTime() <= requestNow.getTime() || decision.notification.audience.userIds?.length !== 1
          || decision.notification.audience.userIds[0] !== subjectId) return "skipped";
        if (!await this.dependencies.hasEligibleDevice(subjectId, requestNow)
          || this.stopping || (!leaseValid() || !profileLeaseValid())) return "skipped";
        if (candidate.feature.sourceId === "chmi_hydro") {
          // Hydro severity escalation is a distinct alert; changing polls at the same severity use the cooldown.
          decision.idempotencyKey = `cop.safety:${createHash("sha256").update(JSON.stringify([
            decision.idempotencyKey, candidate.feature.severity
          ])).digest("hex")}`;
        }
        const cooldown = candidate.feature.sourceId === "chmi_hydro" ? {
          key: `cop.safety.cooldown:${createHash("sha256").update(JSON.stringify([
            subjectId, "chmi_hydro", candidate.feature.featureId, candidate.feature.severity
          ])).digest("hex")}`,
          durationMs: this.config.hydroCooldownMs
        } : undefined;
        const claim = await this.dependencies.notificationStore.claim(decision.idempotencyKey, expiresAt, this.now(), 180000, cooldown);
        if (!claim) return "skipped";
        try {
          if (this.stopping || (!leaseValid() || !profileLeaseValid()) || expiresAt.getTime() <= this.now().getTime() || !reserveDispatch()) {
            await this.dependencies.notificationStore.markRetry(claim, this.now(), false);
            return "skipped";
          }
          decision.notification.audience = { userIds: [subjectId] };
          const result = await this.dependencies.dispatch(decision, this.now());
          if (result.status === "online" && result.notificationId && result.deliverySummary
            && result.deliverySummary.targetDeviceCount > 0) {
            // This means Messaging intake acceptance, never physical device delivery.
            await this.dependencies.notificationStore.markAccepted(claim, result.notificationId, this.now());
            return "accepted";
          }
          await this.dependencies.notificationStore.markRetry(claim, new Date(this.now().getTime() + this.config.retryMs));
          return "failed";
        } catch {
          await this.dependencies.notificationStore.markRetry(claim, new Date(this.now().getTime() + this.config.retryMs));
          return "failed";
        }
      });
    } catch { return "failed"; }
  }

  private async candidatesForProfile(profile: UserProfileRecord, deadline: number): Promise<SafetyNotificationCandidate[]> {
    const areas = profile.alertPreferences.aoiRules?.filter((area) => area.enabled).slice(0, 10) ?? [];
    const candidates: SafetyNotificationCandidate[] = [];
    for (const area of areas) {
      if (this.stopping || Date.now() >= deadline) break;
      const query: SafetyNotificationCandidateQuery = {
        bbox: areaBbox(area), layers: ["warnings", "weather_alerts", "flood", "fire"], limit: 500,
        minSeverity: profile.alertPreferences.minimumSeverity === "critical" ? "critical" : "warning"
      };
      const key = createHash("sha256").update(JSON.stringify(query)).digest("hex");
      const now = this.now();
      let collection = this.cache.get(key)?.expiresAt && this.cache.get(key)!.expiresAt > now.getTime()
        ? this.cache.get(key)!.collection : undefined;
      if (!collection) {
        this.cache.delete(key);
        collection = await this.dependencies.fetchCandidates(query, now);
        if (collection.inputReadiness.status !== "ready" || collection.completeness !== "complete") { this.failure("candidate_source_unavailable"); continue; }
        if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value ?? "");
        if (this.config.cacheTtlMs > 0) this.cache.set(key, { collection, expiresAt: now.getTime() + this.config.cacheTtlMs });
      }
      if (collection.completeness === "complete") candidates.push(...collection.candidates);
    }
    return candidates.slice(0, 5000);
  }

  private failure(code: NonNullable<SafetyNotificationWorkerState["lastFailure"]>): void {
    this.state.failedCount += 1;
    this.state.lastFailure = code;
  }

  private emit(): void {
    try { this.dependencies.onState?.(this.snapshot()); } catch { /* Observability must not change dispatch policy. */ }
  }
}

function hasConsentAndAreas(profile: UserProfileRecord): boolean {
  return Boolean(profile.subjectId && profile.alertPreferences.safetyNotificationsEnabled === true
    && profile.alertPreferences.aoiRules?.some((area) => area.enabled));
}

function areaBbox(area: AoiRule): SafetyBbox {
  const polygonPoints = area.polygon?.coordinates.flat();
  if (polygonPoints?.length) {
    return {
      west: Math.min(...polygonPoints.map((point) => point[0])), east: Math.max(...polygonPoints.map((point) => point[0])),
      south: Math.min(...polygonPoints.map((point) => point[1])), north: Math.max(...polygonPoints.map((point) => point[1]))
    };
  }
  const latitudeDelta = area.radiusKm / 110.574;
  const longitudeDelta = area.radiusKm / Math.max(0.01, 111.32 * Math.cos(area.lat * Math.PI / 180));
  const west = area.lon - longitudeDelta;
  const east = area.lon + longitudeDelta;
  return {
    west: west < -180 || east > 180 ? -180 : west,
    east: west < -180 || east > 180 ? 180 : east,
    south: Math.max(-90, area.lat - latitudeDelta), north: Math.min(90, area.lat + latitudeDelta)
  };
}

function integer(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error("Safety notification worker configuration is outside its bounds.");
  return parsed;
}
