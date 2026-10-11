import { createServer, type Server } from "node:http"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { selectSkills, type RosterEntry } from "../src/jev.js"
import { resolveConfig } from "../src/config.js"
import type { RouterConfig } from "../src/types.js"

const config: RouterConfig = resolveConfig({
  jev: { baseUrl: "http://127.0.0.1:1", apiKey: "k", model: "oc/jev-1.13-free" },
})

const roster: RosterEntry[] = [
  {
    skillId: "project:security-audit",
    name: "security-audit",
    description: "Keamanan kode.",
    body: "Audit the code for vulnerabilities.",
  },
  {
    skillId: "project:code-review",
    name: "code-review",
    description: "Review kode.",
    body: "Review code quality.",
  },
  {
    skillId: "project:xss-testing",
    name: "xss-testing",
    description: "XSS testing.",
    body: "Test for XSS.",
  },
]

type Doc = { state: unknown; questions: Record<string, unknown> }
type Responder = (doc: Doc, callIndex: number) => Record<string, unknown>

function fakeCall(responder: Responder) {
  const docs: Doc[] = []
  const fn = async (doc: Doc) => {
    docs.push(doc)
    // The responder builds the ANSWERS object (+ optional top-level usage);
    // wrap it in the real wire shape { answers, usage? }.
    const raw = responder(doc, docs.length - 1)
    const { usage, ...answers } = raw as Record<string, unknown> & { usage?: unknown }
    return usage ? { answers, usage } : { answers }
  }
  return { fn, docs }
}

const allHigh = {
  acts_on_user_system: { type: "noul", noul: 0.9 },
  would_follow_documented_procedure: { type: "noul", noul: 0.9 },
  prose_suffices: { type: "noul", noul: 0.1 },
}

function rankAnswer(picks: Record<string, number>): Record<string, unknown> {
  return {
    which: {
      type: "choice",
      choice: Object.entries(picks).sort((a, b) => b[1] - a[1])[0][0],
      probabilities: picks,
      confidence: 0.9,
    },
    ...allHigh,
  }
}

describe("selectSkills — cookbook two-call flow", () => {
  it("ranks the WHOLE roster in call 1 (criteria = skill_id → description)", async () => {
    const { fn, docs } = fakeCall((doc, i) =>
      i === 0
        ? rankAnswer({
            "project:security-audit": 0.8,
            "project:code-review": 0.1,
            "project:xss-testing": 0.1,
          })
        : {
            which: { type: "choice", choice: "project:security-audit" },
            "fits::project:security-audit": { type: "noul", noul: 0.9 },
            "fits::project:code-review": { type: "noul", noul: 0.2 },
            "fits::project:xss-testing": { type: "noul", noul: 0.1 },
          },
    )
    const out = await selectSkills({ request: "fix", roster, config, callJev: fn })
    const criteria = (docs[0].questions.which as { criteria: object }).criteria
    expect(Object.keys(criteria)).toEqual([
      "project:security-audit",
      "project:code-review",
      "project:xss-testing",
    ])
    expect(out.decision).toBe("suggest")
    expect(out.suggested).toBe("project:security-audit")
  })

  it("sends the 3 gate questions in call 1", async () => {
    const { fn, docs } = fakeCall(() => rankAnswer({ "project:security-audit": 1 }))
    await selectSkills({ request: "fix", roster, config, callJev: fn })
    const q = docs[0].questions
    expect(Object.keys(q)).toEqual(
      expect.arrayContaining([
        "gate::acts_on_user_system",
        "gate::would_follow_documented_procedure",
        "gate::prose_suffices",
      ]),
    )
  })

  it("abstains when the gate mean is below threshold — call 2 never runs", async () => {
    const { fn, docs } = fakeCall(() => ({
      which: { type: "choice", choice: "project:security-audit" },
      "gate::acts_on_user_system": { type: "noul", noul: 0.1 },
      "gate::would_follow_documented_procedure": { type: "noul", noul: 0.1 },
      "gate::prose_suffices": { type: "noul", noul: 0.95 }, // inverted → 0.05
    }))
    const out = await selectSkills({ request: "hi", roster, config, callJev: fn })
    expect(out.decision).toBe("abstain")
    expect(out.suggested).toBeNull()
    expect(docs).toHaveLength(1)
    // oriented mean: (0.1 + 0.1 + 0.05)/3 ≈ 0.083
    expect(out.gate).toBeLessThan(0.3)
    expect(out.gateValues.prose_suffices).toBe(0.95)
  })

  it("inverts prose_suffices when computing the gate mean", async () => {
    const { fn } = fakeCall(() => ({
      which: { type: "choice", choice: "project:security-audit" },
      "gate::acts_on_user_system": { type: "noul", noul: 1 },
      "gate::would_follow_documented_procedure": { type: "noul", noul: 1 },
      "gate::prose_suffices": { type: "noul", noul: 1 }, // inverted → 0
    }))
    const out = await selectSkills({ request: "x", roster, config, callJev: fn })
    // (1 + 1 + 0)/3 = 0.667 — not 1.0: a full-prose request lowers the gate.
    expect(out.gate).toBeCloseTo(0.667, 2)
  })

  it("reranks only the shortlist top-N with body excerpts (call 2)", async () => {
    const { fn, docs } = fakeCall((doc, i) =>
      i === 0
        ? rankAnswer({
            "project:security-audit": 0.6,
            "project:code-review": 0.3,
            "project:xss-testing": 0.1,
          })
        : {
            which: { type: "choice", choice: "project:code-review" },
            "fits::project:security-audit": { type: "noul", noul: 0.2 },
            "fits::project:code-review": { type: "noul", noul: 0.9 },
            "fits::project:xss-testing": { type: "noul", noul: 0.1 },
          },
    )
    const out = await selectSkills({ request: "review", roster, config, callJev: fn })
    const criteria = (docs[1].questions.which as { criteria: Record<string, string> })
      .criteria
    expect(Object.keys(criteria)).toHaveLength(3) // shortlist=3 default
    expect(criteria["project:security-audit"]).toContain("Keamanan kode.")
    expect(criteria["project:security-audit"]).toContain("Audit the code")
    expect(out.decision).toBe("suggest")
    expect(out.suggested).toBe("project:code-review")
    expect(out.fits["project:code-review"]).toBe(0.9)
  })

  it("respects a custom shortlist size", async () => {
    const small: RouterConfig = resolveConfig({
      jev: { baseUrl: "http://127.0.0.1:1", shortlist: 1 },
    })
    const { fn, docs } = fakeCall((doc, i) =>
      i === 0
        ? rankAnswer({
            "project:security-audit": 0.6,
            "project:code-review": 0.3,
            "project:xss-testing": 0.1,
          })
        : {
            which: { type: "choice", choice: "project:security-audit" },
            "fits::project:security-audit": { type: "noul", noul: 0.9 },
          },
    )
    await selectSkills({ request: "review", roster, config: small, callJev: fn })
    const criteria = (docs[1].questions.which as { criteria: object }).criteria
    expect(Object.keys(criteria)).toEqual(["project:security-audit"])
  })

  it("truncates body excerpts to excerptChars", async () => {
    const small: RouterConfig = resolveConfig({
      jev: { baseUrl: "http://127.0.0.1:1", excerptChars: 10 },
    })
    const { fn, docs } = fakeCall((doc, i) =>
      i === 0
        ? rankAnswer({ "project:security-audit": 1 })
        : {
            which: { type: "choice", choice: "project:security-audit" },
            "fits::project:security-audit": { type: "noul", noul: 0.9 },
          },
    )
    await selectSkills({ request: "x", roster, config: small, callJev: fn })
    const criteria = (docs[1].questions.which as { criteria: Record<string, string> })
      .criteria
    const value = criteria["project:security-audit"]
    const afterDash = value.split(" — ")[1]
    expect(afterDash.length).toBeLessThanOrEqual(10)
  })

  it("abstains when every fits-noul is below threshold", async () => {
    const { fn, docs } = fakeCall((doc, i) =>
      i === 0
        ? rankAnswer({
            "project:security-audit": 0.6,
            "project:code-review": 0.3,
            "project:xss-testing": 0.1,
          })
        : {
            which: { type: "choice", choice: "project:security-audit" },
            "fits::project:security-audit": { type: "noul", noul: 0.1 },
            "fits::project:code-review": { type: "noul", noul: 0.2 },
            "fits::project:xss-testing": { type: "noul", noul: 0.05 },
          },
    )
    const out = await selectSkills({ request: "vague", roster, config, callJev: fn })
    expect(out.decision).toBe("abstain")
    expect(out.suggested).toBeNull()
    expect(docs).toHaveLength(2)
  })

  it("falls back to shortlist[0] when the winner is not a valid id", async () => {
    const { fn } = fakeCall((doc, i) =>
      i === 0
        ? rankAnswer({ "project:security-audit": 0.7, "project:code-review": 0.3 })
        : {
            which: { type: "choice", choice: "hallucinated-id" },
            "fits::project:security-audit": { type: "noul", noul: 0.9 },
            "fits::project:code-review": { type: "noul", noul: 0.4 },
          },
    )
    const out = await selectSkills({ request: "x", roster, config, callJev: fn })
    expect(out.suggested).toBe("project:security-audit")
  })

  it("reports usage from both calls", async () => {
    const { fn } = fakeCall((doc, i) =>
      i === 0
        ? { ...rankAnswer({ "project:security-audit": 1 }), usage: { input_tokens: 100, output_tokens: 30 } }
        : {
            which: { type: "choice", choice: "project:security-audit" },
            "fits::project:security-audit": { type: "noul", noul: 0.9 },
            usage: { input_tokens: 50, output_tokens: 10 },
          },
    )
    const out = await selectSkills({ request: "x", roster, config, callJev: fn })
    expect(out.usage1?.input_tokens).toBe(100)
    expect(out.usage2?.input_tokens).toBe(50)
  })
})

describe("selectSkills against a real HTTP endpoint (/v1/systemone)", () => {
  let server: Server
  let baseUrl: string
  let lastBody: Record<string, unknown> | undefined
  let mode: "ok" | "slow" | "error" = "ok"

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = ""
      req.on("data", (c) => (raw += c))
      req.on("end", () => {
        lastBody = JSON.parse(raw)
        if (mode === "slow") {
          setTimeout(() => {
            res.writeHead(200, { "content-type": "application/json" })
            res.end(JSON.stringify({ answers: {}, usage: {} }))
          }, 3000)
          return
        }
        if (mode === "error") {
          res.writeHead(500)
          res.end("boom")
          return
        }
        const isFirst = Object.keys(lastBody!.questions as object).some((k) =>
          k.startsWith("gate::"),
        )
        res.writeHead(200, { "content-type": "application/json" })
        if (isFirst) {
          res.end(
            JSON.stringify({
              model: "oc/jev-1.13-free",
              answers: {
                which: {
                  type: "choice",
                  choice: "project:security-audit",
                  probabilities: {
                    "project:security-audit": 0.85,
                    "project:code-review": 0.1,
                    "project:xss-testing": 0.05,
                  },
                  confidence: 0.9,
                },
                ...allHigh,
              },
              usage: { input_tokens: 300, output_tokens: 40 },
            }),
          )
        } else {
          res.end(
            JSON.stringify({
              model: "oc/jev-1.13-free",
              answers: {
                which: { type: "choice", choice: "project:security-audit" },
                "fits::project:security-audit": { type: "noul", noul: 0.95 },
                "fits::project:code-review": { type: "noul", noul: 0.1 },
                "fits::project:xss-testing": { type: "noul", noul: 0.05 },
              },
              usage: { input_tokens: 120, output_tokens: 25 },
            }),
          )
        }
      })
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()))
    const addr = server.address()
    baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`
  })

  afterAll(() => new Promise<void>((r) => server.close(() => r())))

  it("POSTs {state, questions} to /v1/systemone and returns the winner", async () => {
    mode = "ok"
    const cfg = resolveConfig({ jev: { baseUrl, apiKey: "k", model: "oc/jev-1.13-free" } })
    const out = await selectSkills({ request: "Analisis keamanan", roster, config: cfg })
    expect(out.decision).toBe("suggest")
    expect(out.suggested).toBe("project:security-audit")
    expect(out.gate).toBeGreaterThan(0.3)
    // state carries the request; questions use typed objects.
    expect(JSON.stringify(lastBody)).toContain("Analisis keamanan")
    expect(lastBody!.state).toMatchObject({ request: "Analisis keamanan" })
    expect((lastBody!.questions as Record<string, unknown>).which).toMatchObject({
      type: "choice",
    })
  })

  it("times out within the configured limit", async () => {
    mode = "slow"
    const cfg = resolveConfig({
      jev: { baseUrl, apiKey: "k", model: "oc/jev-1.13-free" },
      timeoutMs: 300,
    })
    const start = Date.now()
    await expect(selectSkills({ request: "x", roster, config: cfg })).rejects.toThrow()
    expect(Date.now() - start).toBeLessThan(2500)
  }, 10000)

  it("throws on non-2xx status", async () => {
    mode = "error"
    const cfg = resolveConfig({ jev: { baseUrl, apiKey: "k", model: "oc/jev-1.13-free" } })
    await expect(selectSkills({ request: "x", roster, config: cfg })).rejects.toThrow()
  })
})
