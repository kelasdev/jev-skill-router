import { createHash } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import { latestUserText, runRouter } from "../src/router.js"
import { resolveConfig } from "../src/config.js"
import { Diagnostics } from "../src/diagnostics.js"
import { scanSkills } from "../src/indexer.js"
import type {
  JevDecision,
  RouterConfig,
  SkillMeta,
  SessionState,
} from "../src/types.js"

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures")
const skillsA = path.join(fixtures, "skills-a")
const allowedRoots = [fixtures]

const config: RouterConfig = resolveConfig({
  jev: { baseUrl: "http://127.0.0.1:1", apiKey: "k", model: "oc/jev-1.13-free" },
})

async function fixtureSkills(): Promise<SkillMeta[]> {
  return scanSkills([{ dir: skillsA, source: "project" }])
}

function hash(s: string, messageCount = 0): string {
  return createHash("sha256").update(`${s}#${messageCount}`).digest("hex")
}

const suggest = (skillId: string): JevDecision => ({
  decision: "suggest",
  suggested: skillId,
  gate: 0.9,
  gateValues: { acts_on_user_system: 1 },
  shortlist: [skillId],
  fits: { [skillId]: 0.9 },
})

const abstain: JevDecision = {
  decision: "abstain",
  suggested: null,
  gate: 0.05,
  gateValues: { prose_suffices: 0.95 },
  shortlist: [],
  fits: {},
}

describe("latestUserText", () => {
  it("extracts plain string content", () => {
    expect(
      latestUserText([
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
      ]),
    ).toBe("hello")
  })

  it("extracts text from content parts", () => {
    const out = latestUserText([
      {
        role: "user",
        content: [
          { type: "text", text: "part one " },
          { type: "text", text: "part two" },
        ],
      },
    ])
    expect(out).toBe("part one part two")
  })

  it("returns undefined when the latest user message is image-only", () => {
    expect(
      latestUserText([{ role: "user", content: [{ type: "image" }] }]),
    ).toBeUndefined()
  })

  it("returns undefined when there is no user message", () => {
    expect(latestUserText([{ role: "assistant", content: "x" }])).toBeUndefined()
  })

  it("does NOT fall back to an older user message", () => {
    expect(
      latestUserText([
        { role: "user", content: "old request" },
        { role: "assistant", content: "ok" },
        { role: "user", content: [{ type: "image" }] },
      ]),
    ).toBeUndefined()
  })
})

describe("runRouter", () => {
  it("skips selection for a greeting: no systemText, no Jev call", async () => {
    const out = await runRouter({
      sessionID: "s1",
      request: "hi",
      skills: await fixtureSkills(),
      config,
      state: {},
      diagnostics: new Diagnostics(),
      allowedRoots,
    })
    expect(out.systemText).toBeUndefined()
    const d = out.diagnostics!
    expect(d.jevCalled).toBe(false)
  })

  it("injects the ONE suggested skill wrapped in skill_relevance", async () => {
    const jev = vi
      .spyOn(await import("../src/jev.js"), "selectSkills")
      .mockResolvedValue(suggest("project:security-audit"))
    const out = await runRouter({
      sessionID: "s2",
      request: "Analisis keamanan kode ini",
      skills: await fixtureSkills(),
      config,
      state: {},
      diagnostics: new Diagnostics(),
      allowedRoots,
    })
    jev.mockRestore()
    expect(out.systemText).toContain("<jev-selected-skills>")
    expect(out.systemText).toContain("<skill_relevance>")
    expect(out.systemText).toContain(
      "Relevant to the current request: security-audit.",
    )
    expect(out.systemText).toContain("Audit the code")
    expect(out.systemText).not.toContain("Review code quality")
    expect(out.diagnostics!.injectedIds).toEqual(["project:security-audit"])
    expect(out.diagnostics!.decision).toBe("suggest")
    expect(out.diagnostics!.gate).toBe(0.9)
  })

  it("passes the WHOLE roster to Jev when the catalog fits the cap", async () => {
    const selectSpy = vi.fn(async (_input: { roster: unknown[] }) => abstain)
    const skills = await fixtureSkills()
    await runRouter({
      sessionID: "s2r",
      request: "Analisis keamanan kode ini",
      skills,
      config,
      state: {},
      diagnostics: new Diagnostics(),
      allowedRoots,
      selectSkillsImpl: selectSpy as never,
    })
    const arg = selectSpy.mock.calls[0][0] as { roster: unknown[] }
    expect(arg.roster).toHaveLength(skills.length)
  })

  it("trims the roster with BM25 only when it exceeds maxCandidates", async () => {
    const selectSpy = vi.fn(async (_input: { roster: unknown[] }) => abstain)
    const cfgSmall = resolveConfig({
      jev: { baseUrl: "http://127.0.0.1:1" },
      maxCandidates: 2,
    })
    const skills = await fixtureSkills()
    expect(skills.length).toBeGreaterThan(2)
    await runRouter({
      sessionID: "s2c",
      request: "security code review audit analysis testing",
      skills,
      config: cfgSmall,
      state: {},
      diagnostics: new Diagnostics(),
      allowedRoots,
      selectSkillsImpl: selectSpy as never,
    })
    const arg = selectSpy.mock.calls[0][0] as { roster: unknown[] }
    expect(arg.roster).toHaveLength(2)
  })

  it("injects nothing and records signals when Jev abstains", async () => {
    const jev = vi
      .spyOn(await import("../src/jev.js"), "selectSkills")
      .mockResolvedValue(abstain)
    const out = await runRouter({
      sessionID: "s4",
      request: "Analisis keamanan kode ini",
      skills: await fixtureSkills(),
      config,
      state: {},
      diagnostics: new Diagnostics(),
      allowedRoots,
    })
    jev.mockRestore()
    expect(out.systemText).toBeUndefined()
    expect(out.diagnostics!.injectedIds).toEqual([])
    expect(out.diagnostics!.decision).toBe("abstain")
    expect(out.diagnostics!.gate).toBe(0.05)
    expect(out.diagnostics!.jevCalled).toBe(true)
  })

  it("records an error and injects nothing when Jev throws", async () => {
    const jev = vi
      .spyOn(await import("../src/jev.js"), "selectSkills")
      .mockRejectedValue(new Error("ECONNREFUSED"))
    const out = await runRouter({
      sessionID: "s3",
      request: "Analisis keamanan kode ini",
      skills: await fixtureSkills(),
      config,
      state: {},
      diagnostics: new Diagnostics(),
      allowedRoots,
    })
    jev.mockRestore()
    expect(out.systemText).toBeUndefined()
    expect(out.diagnostics!.error).toContain("ECONNREFUSED")
  })

  it("sets lastInjectedHash so a repeat call short-circuits", async () => {
    const state: SessionState = {}
    const request = "Analisis keamanan kode ini"
    const selectSpy = vi.fn(async () => abstain)
    const first = await runRouter({
      sessionID: "s6",
      request,
      skills: await fixtureSkills(),
      config,
      state,
      diagnostics: new Diagnostics(),
      allowedRoots,
      selectSkillsImpl: selectSpy as never,
    })
    expect(state.lastInjectedHash).toBe(hash(request))
    selectSpy.mockClear() // count only the repeat run
    const second = await runRouter({
      sessionID: "s6",
      request,
      skills: await fixtureSkills(),
      config,
      state,
      diagnostics: new Diagnostics(),
      allowedRoots,
      selectSkillsImpl: selectSpy as never,
    })
    // Second run short-circuits entirely: no diagnostics entry appended.
    expect(second.diagnostics).toBeUndefined()
    expect(selectSpy).not.toHaveBeenCalled()
  })

  it("re-runs when the same text arrives as a NEW turn (more messages)", async () => {
    const state: SessionState = {}
    const request = "Analisis keamanan kode ini"
    const selectSpy = vi.fn(async () => abstain)
    const run = async (messageCount: number) =>
      runRouter({
        sessionID: "s6b",
        request,
        messageCount,
        skills: await fixtureSkills(),
        config,
        state,
        diagnostics: new Diagnostics(),
        allowedRoots,
        selectSkillsImpl: selectSpy as never,
      })
    await run(1)
    // Same text, but the conversation grew (a genuine new turn with identical
    // wording) — selection must run again.
    const again = await run(5)
    expect(again.diagnostics).toBeDefined()
  })

  it("keeps sessions independent", async () => {
    const d = new Diagnostics()
    await runRouter({
      sessionID: "A",
      request: "hi",
      skills: await fixtureSkills(),
      config,
      state: {},
      diagnostics: d,
      allowedRoots,
    })
    expect(d.last("A")).toBeDefined()
    expect(d.last("B")).toBeUndefined()
  })

  it("marks a greeting record in diagnostics", async () => {
    const d = new Diagnostics()
    await runRouter({
      sessionID: "s7",
      request: "hi",
      skills: await fixtureSkills(),
      config,
      state: {},
      diagnostics: d,
      allowedRoots,
    })
    const rec = d.last("s7")!
    expect(rec.jevCalled).toBe(false)
    expect(rec.candidatesAfter).toBe(0)
    expect(rec.injectedIds).toEqual([])
  })
})
