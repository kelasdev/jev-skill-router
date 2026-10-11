import { describe, expect, it } from "vitest"
import { Diagnostics, type DiagnosticRecord } from "../src/diagnostics.js"

function rec(sessionID: string, at: number, excerpt = "req"): DiagnosticRecord {
  return {
    sessionID,
    requestExcerpt: excerpt,
    indexSize: 10,
    suggested: null,
    candidatesBefore: 5,
    candidatesAfter: 3,
    jevCalled: true,
    retrievalMs: 1,
    selectionMs: 2,
    selectedIds: [],
    injectedIds: [],
    skipped: [],
    injectedTokens: 0,
    at,
  }
}

describe("Diagnostics", () => {
  it("keeps sessions independent", () => {
    const d = new Diagnostics()
    d.record(rec("A", 1))
    d.record(rec("B", 2))
    d.record(rec("A", 3))
    expect(d.last("A")?.at).toBe(3)
    expect(d.last("B")?.at).toBe(2)
  })

  it("returns undefined for an unknown session", () => {
    expect(new Diagnostics().last("nope")).toBeUndefined()
  })

  it("bounds the buffer at 100 records", () => {
    const d = new Diagnostics()
    for (let i = 0; i < 150; i++) d.record(rec("s", i))
    expect(d.recent(200)).toHaveLength(100)
    expect(d.recent(200)[0].at).toBe(149) // newest first
  })

  it("truncates the request excerpt to 120 chars", () => {
    const d = new Diagnostics()
    d.record(rec("A", 1, "x".repeat(500)))
    expect(d.last("A")?.requestExcerpt).toHaveLength(120)
  })

  it("returns recent records newest-first", () => {
    const d = new Diagnostics()
    d.record(rec("A", 1))
    d.record(rec("B", 2))
    const recent = d.recent(5)
    expect(recent.map((r) => r.at)).toEqual([2, 1])
  })

  it("caps recent() to the available count", () => {
    const d = new Diagnostics()
    d.record(rec("A", 1))
    expect(d.recent(5)).toHaveLength(1)
  })

  it("returns only the calling session's records", () => {
    const d = new Diagnostics()
    d.record(rec("A", 1))
    d.record(rec("B", 2))
    d.record(rec("A", 3))
    expect(d.recentForSession("A", 5).map((r) => r.at)).toEqual([3, 1])
    expect(d.recentForSession("B", 5).map((r) => r.at)).toEqual([2])
    expect(d.recentForSession("nope", 5)).toEqual([])
  })
})
