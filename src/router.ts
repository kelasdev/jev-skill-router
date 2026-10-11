import { createHash } from "node:crypto"
import { selectSkills as defaultSelectSkills, rosterFrom } from "./jev.js"
import { retrieve } from "./retrieval.js"
import { needsSelection } from "./precheck.js"
import { loadInjectedContent } from "./inject.js"
import type { Diagnostics } from "./diagnostics.js"
import type {
  DiagnosticRecord,
  JevDecision,
  RouterConfig,
  SkillMeta,
  SessionState,
} from "./types.js"

interface MessageLike {
  role: string
  content: unknown
}

function contentToText(content: unknown): string | undefined {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    const parts = content
      .filter(
        (p): p is { type: string; text: string } =>
          !!p && typeof p === "object" && (p as { type?: unknown }).type === "text",
      )
      .map((p) => p.text)
    if (parts.length === 0) return undefined
    return parts.join("")
  }
  return undefined
}

/** Text of the LAST user message only — never falls back to older ones. */
export function latestUserText(
  messages: readonly MessageLike[],
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      return contentToText(messages[i].content)
    }
  }
  return undefined
}

function requestHash(request: string, messageCount: number): string {
  // Key includes the conversation size so the SAME text as a NEW turn
  // (more messages) re-runs selection, while a tool continuation of the
  // same turn (identical message count) short-circuits.
  return createHash("sha256").update(`${request}#${messageCount}`).digest("hex")
}

export interface RunRouterInput {
  sessionID: string
  request: string
  /** Number of messages in the conversation; part of the dedupe key. */
  messageCount?: number
  skills: SkillMeta[]
  config: RouterConfig
  state: SessionState
  diagnostics: Diagnostics
  allowedRoots: string[]
  now?: () => number
  selectSkillsImpl?: typeof defaultSelectSkills
}

export interface RunRouterResult {
  systemText?: string
  diagnostics?: DiagnosticRecord
}

export async function runRouter(
  input: RunRouterInput,
): Promise<RunRouterResult> {
  const {
    sessionID,
    request,
    messageCount = 0,
    skills,
    config,
    state,
    diagnostics,
    allowedRoots,
    now = Date.now,
    selectSkillsImpl = defaultSelectSkills,
  } = input

  // One injection per user request per turn; a repeat of the same
  // request (tool continuation, retried dispatch) short-circuits entirely.
  const hash = requestHash(request, messageCount)
  if (state.lastInjectedHash === hash) {
    return {}
  }

  const base: Omit<
    DiagnosticRecord,
    | "candidatesBefore"
    | "candidatesAfter"
    | "jevCalled"
    | "retrievalMs"
    | "selectionMs"
    | "selectedIds"
    | "injectedIds"
    | "skipped"
    | "injectedTokens"
    | "at"
  > = {
    sessionID,
    requestExcerpt: request,
    indexSize: skills.length,
    suggested: null,
  }
  const finish = (partial: Partial<DiagnosticRecord>): RunRouterResult => {
    state.lastInjectedHash = hash
    const record: DiagnosticRecord = {
      candidatesBefore: 0,
      candidatesAfter: 0,
      jevCalled: false,
      retrievalMs: 0,
      selectionMs: 0,
      selectedIds: [],
      injectedIds: [],
      skipped: [],
      injectedTokens: 0,
      ...base,
      ...partial,
      at: now(),
    }
    diagnostics.record(record)
    return { diagnostics: record }
  }

  // Cheap local pre-check; ambiguous input always continues.
  const pre = needsSelection(request)
  if (!pre.needed) {
    return finish({})
  }

  // Roster: Jev ranks EVERY skill unless the catalog exceeds the Choice
  // option limit (255) — only then does BM25 trim it (overflow protection).
  const t0 = now()
  let rosterInput = skills
  if (skills.length > config.maxCandidates) {
    const topIds = new Set(
      retrieve(skills, request, config.maxCandidates).map((c) => c.skillId),
    )
    rosterInput = skills.filter((s) => topIds.has(s.skillId))
  }
  const retrievalMs = now() - t0
  if (rosterInput.length === 0) {
    return finish({ retrievalMs })
  }
  const roster = rosterFrom(rosterInput)

  // Cookbook selection: call 1 (rank + gates) → call 2 (rerank shortlist).
  const t1 = now()
  let decision: JevDecision
  try {
    decision = await selectSkillsImpl({ request, roster, config })
  } catch (err) {
    // Fail-safe = inject nothing, record the cause.
    return finish({
      retrievalMs,
      selectionMs: now() - t1,
      candidatesBefore: roster.length,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  const selectionMs = now() - t1

  const signals = {
    decision: decision.decision,
    suggested: decision.suggested ?? null,
    gate: decision.gate,
    gateValues: decision.gateValues,
    shortlist: decision.shortlist,
    fits: decision.fits,
  }

  // Abstain (gate/fits below threshold) = no injection — a first-class
  // outcome, not an error.
  if (decision.decision === "abstain" || !decision.suggested) {
    return finish({
      retrievalMs,
      selectionMs,
      candidatesBefore: roster.length,
      jevCalled: true,
      ...signals,
    })
  }

  // Load the ONE suggested skill, budget-checked.
  const loaded = await loadInjectedContent(
    [decision.suggested],
    skills,
    allowedRoots,
    config.maxTotalTokens,
  )
  if (loaded.blocks.length === 0) {
    return finish({
      retrievalMs,
      selectionMs,
      candidatesBefore: roster.length,
      selectedIds: [decision.suggested],
      ...signals,
      skipped: loaded.skipped,
    })
  }

  const nameById = new Map(skills.map((s) => [s.skillId, s.name]))
  const name = nameById.get(decision.suggested) ?? decision.suggested
  const inner = loaded.blocks
    .map(
      (b) =>
        `<skill name="${nameById.get(b.skillId) ?? b.skillId}">\n${b.text.trim()}\n</skill>`,
    )
    .join("\n\n")
  // <skill_relevance> mirrors the cookbook's post-roster block; inside an
  // OpenCode plugin the roster is not in the system prompt, so the chosen
  // skill's content rides along in the same wrapper.
  const systemText =
    `<jev-selected-skills>\n` +
    `<skill_relevance>\n` +
    `Relevant to the current request: ${name}. Ignore this if it does not ` +
    `fit what the user actually asked for.\n` +
    `</skill_relevance>\n\n` +
    `${inner}\n` +
    `</jev-selected-skills>`

  state.lastInjectedHash = hash
  const record: DiagnosticRecord = {
    ...base,
    candidatesBefore: roster.length,
    candidatesAfter: 1,
    jevCalled: true,
    retrievalMs,
    selectionMs,
    selectedIds: [decision.suggested],
    injectedIds: loaded.blocks.map((b) => b.skillId),
    skipped: loaded.skipped,
    injectedTokens: loaded.totalTokens,
    ...signals,
    suggestionBlock: systemText,
    at: now(),
  }
  diagnostics.record(record)
  return { systemText, diagnostics: record }
}
