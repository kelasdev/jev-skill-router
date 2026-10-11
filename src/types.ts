export type SkillSource = "project" | "global"

export interface SkillMeta {
  skillId: string
  name: string
  description: string
  keywords: string[]
  path: string
  source: SkillSource
  contentHash: string
  mtimeMs: number
}

export interface Candidate {
  skillId: string
  name: string
  description: string
  score: number
}

/** One selection outcome, shaped after the TypeSafe cookbook pattern. */
export interface JevDecision {
  decision: "suggest" | "abstain"
  /** The one skill_id to load, or null on abstain. */
  suggested: string | null
  /** Mean of the oriented gate nouls (0..1). */
  gate: number
  gateValues: Record<string, number>
  /** Top-N skill_ids from call 1's ranking (empty if call 2 never ran). */
  shortlist: string[]
  /** fits-noul per shortlisted skill from call 2. */
  fits: Record<string, number>
  usage1?: JevUsage
  usage2?: JevUsage
}

export interface JevUsage {
  input_tokens?: number
  output_tokens?: number
}

export interface JevConfig {
  baseUrl: string
  apiKey: string
  model: string
  /** Gate mean below this → abstain, call 2 skipped. */
  gateThreshold: number
  /** Every fits-noul below this → abstain. */
  fitsThreshold: number
  /** Shortlist size for the rerank call. */
  shortlist: number
  /** SKILL.md excerpt chars sent with each shortlisted candidate. */
  excerptChars: number
}

export interface RouterConfig {
  enabled: boolean
  /** Roster cap for the ranking Choice (Choice limit is 255 options). */
  maxCandidates: number
  timeoutMs: number
  maxTotalTokens: number
  injectOnError: boolean
  refreshOnStart: boolean
  watchFiles: boolean
  diagnosticsEnabled: boolean
  jev: JevConfig
}

export interface SessionState {
  lastInjectedHash?: string
}

export interface DiagnosticRecord {
  sessionID: string
  requestExcerpt: string
  indexSize: number
  candidatesBefore: number
  candidatesAfter: number
  jevCalled: boolean
  retrievalMs: number
  selectionMs: number
  selectedIds: string[]
  injectedIds: string[]
  skipped: { skillId: string; reason: string }[]
  injectedTokens: number
  decision?: "suggest" | "abstain"
  gate?: number
  gateValues?: Record<string, number>
  shortlist?: string[]
  fits?: Record<string, number>
  error?: string
  at: number
}
