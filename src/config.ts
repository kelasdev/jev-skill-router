import type { RouterConfig } from "./types.js"

const DEFAULTS = {
  enabled: true,
  // Roster cap for the ranking Choice. The Jev/TypeSafe Choice limit is 255
  // options; beyond that BM25 trims the roster (overflow protection only —
  // within the cap, Jev sees EVERY skill, no lexical filtering).
  maxCandidates: 200,
  timeoutMs: 5000,
  maxTotalTokens: 4000,
  refreshOnStart: true,
  diagnosticsEnabled: true,
}

const JEV_DEFAULTS = {
  model: "oc/jev-1.13-free",
  gateThreshold: 0.3,
  fitsThreshold: 0.3,
  shortlist: 3,
  excerptChars: 700,
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function ratio(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : fallback
}

export function resolveConfig(options: unknown): RouterConfig {
  const raw = (options ?? {}) as Record<string, unknown>
  const jev = (raw.jev ?? {}) as Record<string, unknown>
  if (typeof jev.baseUrl !== "string" || jev.baseUrl.length === 0) {
    throw new Error("jev_skill_router: options.jev.baseUrl is required")
  }
  return {
    enabled: bool(raw.enabled, DEFAULTS.enabled),
    maxCandidates: positiveInt(raw.maxCandidates, DEFAULTS.maxCandidates),
    timeoutMs: positiveInt(raw.timeoutMs, DEFAULTS.timeoutMs),
    maxTotalTokens: positiveInt(raw.maxTotalTokens, DEFAULTS.maxTotalTokens),
    refreshOnStart: bool(raw.refreshOnStart, DEFAULTS.refreshOnStart),
    diagnosticsEnabled: bool(raw.diagnosticsEnabled, DEFAULTS.diagnosticsEnabled),
    jev: {
      baseUrl: jev.baseUrl as string,
      apiKey: typeof jev.apiKey === "string" ? jev.apiKey : "",
      model: typeof jev.model === "string" ? jev.model : JEV_DEFAULTS.model,
      gateThreshold: ratio(jev.gateThreshold, JEV_DEFAULTS.gateThreshold),
      fitsThreshold: ratio(jev.fitsThreshold, JEV_DEFAULTS.fitsThreshold),
      shortlist: positiveInt(jev.shortlist, JEV_DEFAULTS.shortlist),
      excerptChars: positiveInt(jev.excerptChars, JEV_DEFAULTS.excerptChars),
    },
  }
}
