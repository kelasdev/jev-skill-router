import { describe, expect, it } from "vitest"
import { scoreBM25, tokenize } from "../src/bm25.js"

describe("tokenize", () => {
  it("lowercases and splits on non-alphanumerics", () => {
    expect(tokenize("Security-Audit & XSS!")).toEqual(["security", "audit", "xss"])
  })

  it("drops single-character tokens", () => {
    expect(tokenize("a bb c dd")).toEqual(["bb", "dd"])
  })

  it("removes common English and Indonesian stopwords", () => {
    expect(tokenize("the code for the dan untuk review")).toEqual(["code", "review"])
  })

  it("returns empty for empty or symbol-only input", () => {
    expect(tokenize("")).toEqual([])
    expect(tokenize("!!! ???")).toEqual([])
  })
})

describe("scoreBM25", () => {
  const docs = [
    tokenize("security audit vulnerability analysis of code"),
    tokenize("code review quality correctness implementation"),
    tokenize("security testing cross site scripting xss"),
  ]

  it("ranks a doc containing the query term above unrelated docs", () => {
    const scores = scoreBM25(tokenize("security"), docs)
    expect(scores[0]).toBeGreaterThan(scores[1])
    expect(scores[2]).toBeGreaterThan(scores[1])
    expect(scores[1]).toBe(0)
  })

  it("prefers the doc with more query-term coverage", () => {
    const scores = scoreBM25(tokenize("security audit"), docs)
    expect(scores[0]).toBeGreaterThan(scores[2])
  })

  it("saturates repetition (6 hits less than double 3 hits)", () => {
    const three = [tokenize("security security security other words here")]
    const six = [
      tokenize("security security security security security security other words here"),
    ]
    const q = tokenize("security")
    const s3 = scoreBM25(q, three)[0]
    const s6 = scoreBM25(q, six)[0]
    expect(s6).toBeGreaterThan(s3)
    expect(s6).toBeLessThan(s3 * 2)
  })

  it("returns all zeros for an empty query", () => {
    expect(scoreBM25([], docs)).toEqual([0, 0, 0])
  })

  it("returns an empty array for no docs", () => {
    expect(scoreBM25(tokenize("security"), [])).toEqual([])
  })
})
