/**
 * Jev adapter — TypeSafe cookbook "skill suggestion" pattern.
 *
 * Two decisions per request, both via POST {baseUrl}/v1/systemone
 * ({state, questions} in, typed answers out):
 *
 *  Call 1 (rank + gate): ONE Choice over the whole roster (criteria =
 *    skill_id → index description) plus 3 Noul gates asking whether the
 *    turn wants a skill at all. Mean of the ORIENTED gate values below
 *    gateThreshold → abstain, call 2 never runs.
 *  Call 2 (rerank): the shortlist top-N come back with FULL description +
 *    the first excerptChars chars of SKILL.md, one fits-Noul each. All
 *    fits below fitsThreshold → abstain. Otherwise the Choice winner is
 *    the single suggested skill.
 *
 * Ported 1:1 from the cookbook shape (ydmw74/jev-skill-router, TypeSafe
 * docs) — thresholds 0.30/0.30, shortlist 3, excerpt 700 are its defaults.
 */
import { readFile } from "node:fs/promises"
import { parseFrontmatter } from "./frontmatter.js"
import type {
  Candidate,
  JevConfig,
  JevDecision,
  JevUsage,
  RouterConfig,
  SkillMeta,
} from "./types.js"

export class JevResponseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "JevResponseError"
  }
}

const CHOICE_INSTRUCTIONS =
  "Which of these skills, if any, is the right one to load to help with the " +
  "user's latest request?"

const RERANK_INSTRUCTIONS =
  "Exactly one of these skills is the right one to load for the user's " +
  "latest request. Which one? Read what each actually does, not just its name."

const GATE_QUESTIONS: Record<string, string> = {
  acts_on_user_system:
    "Is the assistant being asked to act on the user's files, accounts, " +
    "devices, or online services, rather than only to explain or advise?",
  would_follow_documented_procedure:
    "Would a careful expert answering this consult a specific documented " +
    "procedure or set of commands, rather than answering from general " +
    "understanding?",
  prose_suffices:
    "Could a knowledgeable generalist fully satisfy this request in " +
    "prose, with no tools, no documentation, and no access to the user's " +
    "files or accounts?",
}
/** Gates where a HIGH value means "no skill needed". */
const INVERTED = new Set(["prose_suffices"])

const NONE_OPTION = "none"

export interface RosterEntry {
  skillId: string
  name: string
  description: string
  /** SKILL.md body (frontmatter stripped); empty until loaded. */
  body: string
}

export type CallJev = (document: {
  state: unknown
  questions: Record<string, unknown>
}) => Promise<Record<string, unknown>>

/** One backend call: {state, questions} -> raw answer. */
export function makeCallJev(config: RouterConfig): CallJev {
  const jev: JevConfig = config.jev
  return async (document) => {
    const url = jev.baseUrl.replace(/\/+$/, "") + "/v1/systemone"
    const headers: Record<string, string> = { "content-type": "application/json" }
    if (jev.apiKey) headers["authorization"] = `Bearer ${jev.apiKey}`
    const response = await fetch(url, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(config.timeoutMs),
      body: JSON.stringify({ model: jev.model, ...document }),
    })
    if (!response.ok) {
      throw new Error(`Jev endpoint returned HTTP ${response.status}`)
    }
    return (await response.json()) as Record<string, unknown>
  }
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function answersOf(payload: unknown): Record<string, Record<string, unknown>> {
  if (!payload || typeof payload !== "object") {
    throw new JevResponseError("Jev response is not an object")
  }
  const answers = (payload as { answers?: unknown }).answers
  if (!answers || typeof answers !== "object") {
    throw new JevResponseError("Jev response missing 'answers'")
  }
  return answers as Record<string, Record<string, unknown>>
}

function usageOf(payload: unknown): JevUsage | undefined {
  if (!payload || typeof payload !== "object") return undefined
  return (payload as { usage?: JevUsage }).usage
}

export async function selectSkills(input: {
  request: string
  roster: RosterEntry[]
  config: RouterConfig
  callJev?: CallJev
}): Promise<JevDecision> {
  const { request, roster, config } = input
  const call = input.callJev ?? makeCallJev(config)
  const { gateThreshold, fitsThreshold, shortlist: shortlistSize, excerptChars } =
    config.jev
  const state = { request, recent_context: "" }
  const ids = roster.map((r) => r.skillId)
  const byId = new Map(roster.map((r) => [r.skillId, r]))

  const abstain = (partial: Partial<JevDecision>): JevDecision => ({
    decision: "abstain",
    suggested: null,
    gate: 0,
    gateValues: {},
    shortlist: [],
    fits: {},
    ...partial,
  })

  // ---- Call 1: rank the roster + gates (one round trip).
  const questions1: Record<string, unknown> = {
    which: {
      type: "choice",
      instructions: CHOICE_INSTRUCTIONS,
      criteria: Object.fromEntries(
        roster.map((r) => [r.skillId, r.description || r.name]),
      ),
    },
  }
  for (const [key, text] of Object.entries(GATE_QUESTIONS)) {
    questions1[`gate::${key}`] = { type: "noul", instructions: text }
  }
  const resp1 = await call({ state, questions: questions1 })
  const answers1 = answersOf(resp1)

  const which1 = answers1.which ?? {}
  const probabilities = (which1.probabilities ?? {}) as Record<string, unknown>
  const ranked = ids
    .filter((id) => typeof probabilities[id] === "number")
    .sort((a, b) => (probabilities[b] as number) - (probabilities[a] as number))

  const gateValues: Record<string, number> = {}
  for (const key of Object.keys(GATE_QUESTIONS)) {
    const answer = answers1[`gate::${key}`]
    gateValues[key] = num(answer?.noul) ?? 0
  }
  const gate = mean(
    Object.entries(gateValues).map(([k, v]) => (INVERTED.has(k) ? 1 - v : v)),
  )
  const usage1 = usageOf(resp1)

  if (gate < gateThreshold || ranked.length === 0) {
    return abstain({ gate, gateValues, usage1 })
  }

  // ---- Call 2: rerank the shortlist with full descriptions + body excerpt.
  const shortlist = ranked.slice(0, shortlistSize).filter((id) => byId.has(id))
  if (shortlist.length === 0) {
    return abstain({ gate, gateValues, usage1 })
  }
  const bodies = await Promise.all(
    shortlist.map(async (id) => {
      const entry = byId.get(id)!
      if (entry.body) return entry.body
      try {
        const raw = await readFile(entryPath(entry), "utf8")
        return parseFrontmatter(raw).body
      } catch {
        return ""
      }
    }),
  )
  const questions2: Record<string, unknown> = {
    which: {
      type: "choice",
      instructions: RERANK_INSTRUCTIONS,
      criteria: Object.fromEntries(
        shortlist.map((id, i) => [
          id,
          `${byId.get(id)!.description} — ${bodies[i].slice(0, excerptChars)}`,
        ]),
      ),
    },
  }
  for (const id of shortlist) {
    questions2[`fits::${id}`] = {
      type: "noul",
      instructions:
        `Does the skill '${byId.get(id)!.name}' do the specific thing the user's request ` +
        `asks for? It is described as: ${byId.get(id)!.description}`,
    }
  }
  const resp2 = await call({ state, questions: questions2 })
  const answers2 = answersOf(resp2)

  const fits: Record<string, number> = {}
  for (const id of shortlist) {
    fits[id] = num(answers2[`fits::${id}`]?.noul) ?? 0
  }
  const usage2 = usageOf(resp2)

  if (Object.keys(fits).length === 0 || Math.max(...Object.values(fits)) < fitsThreshold) {
    return abstain({ gate, gateValues, shortlist, fits, usage1, usage2 })
  }
  const winner = (answers2.which?.choice ?? NONE_OPTION) as string
  return {
    decision: "suggest",
    suggested: byId.has(winner) ? winner : shortlist[0],
    gate,
    gateValues,
    shortlist,
    fits,
    usage1,
    usage2,
  }
}

/** Where the roster entry's SKILL.md lives (needed for the rerank excerpt). */
export function entryPath(entry: RosterEntry): string {
  return (entry as RosterEntry & { path?: string }).path ?? ""
}

/** Build roster entries from the local index, attaching file paths. */
export function rosterFrom(skills: SkillMeta[]): RosterEntry[] {
  return skills.map((s) => ({
    skillId: s.skillId,
    name: s.name,
    description: s.description,
    body: "",
    path: s.path,
  }))
}
