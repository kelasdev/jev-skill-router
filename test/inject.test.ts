import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { loadInjectedContent } from "../src/inject.js"

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures")
const allowedRoots = [fixtures]

interface Entry {
  skillId: string
  path: string
}

function meta(name: string, source: "project" | "global" = "project"): Entry {
  return {
    skillId: `${source}:${name}`,
    path: path.join(fixtures, "skills-a", name, "SKILL.md"),
  }
}

describe("loadInjectedContent", () => {
  it("loads selected skills with frontmatter stripped", async () => {
    const out = await loadInjectedContent(
      ["project:security-audit"],
      [meta("security-audit")],
      allowedRoots,
      8000,
    )
    expect(out.blocks).toHaveLength(1)
    expect(out.blocks[0].skillId).toBe("project:security-audit")
    expect(out.blocks[0].text).not.toContain("---")
    expect(out.blocks[0].text).toContain("Audit the code")
    expect(out.skipped).toEqual([])
  })

  it("skips unknown IDs (second gate)", async () => {
    const out = await loadInjectedContent(
      ["project:ghost"],
      [meta("security-audit")],
      allowedRoots,
      8000,
    )
    expect(out.blocks).toEqual([])
    expect(out.skipped).toEqual([{ skillId: "project:ghost", reason: "unknown-id" }])
  })

  it("skips paths outside allowed roots (path traversal)", async () => {
    const evil: Entry = {
      skillId: "project:evil",
      path: path.join(fixtures, "..", "..", "etc", "passwd"),
    }
    const out = await loadInjectedContent(["project:evil"], [evil], allowedRoots, 8000)
    expect(out.blocks).toEqual([])
    expect(out.skipped[0]?.reason).toBe("path-escape")
  })

  it("skips missing files", async () => {
    const gone: Entry = {
      skillId: "project:gone",
      path: path.join(fixtures, "skills-a", "gone", "SKILL.md"),
    }
    const out = await loadInjectedContent(["project:gone"], [gone], allowedRoots, 8000)
    expect(out.skipped[0]?.reason).toBe("missing-file")
  })

  it("includes skills in selection order and sums tokens", async () => {
    const out = await loadInjectedContent(
      ["project:code-review", "project:security-audit"],
      [meta("security-audit"), meta("code-review")],
      allowedRoots,
      8000,
    )
    expect(out.blocks.map((b) => b.skillId)).toEqual([
      "project:code-review",
      "project:security-audit",
    ])
    expect(out.totalTokens).toBeGreaterThan(0)
  })

  it("skips an over-budget skill whole, never truncating", async () => {
    // Both fixtures are small; set a budget that fits one but not two.
    const both = await loadInjectedContent(
      ["project:code-review", "project:security-audit"],
      [meta("security-audit"), meta("code-review")],
      allowedRoots,
      8000,
    )
    const oneToken = both.blocks[0].text.length / 4
    const budget = Math.ceil(oneToken + 5) // fits first block only
    const out = await loadInjectedContent(
      ["project:code-review", "project:security-audit"],
      [meta("security-audit"), meta("code-review")],
      allowedRoots,
      budget,
    )
    expect(out.blocks).toHaveLength(1)
    expect(out.skipped).toEqual([
      { skillId: "project:security-audit", reason: "over-budget" },
    ])
    // The included block is complete, not cut mid-sentence.
    expect(out.blocks[0].text).toContain("Review code quality")
  })

  it("skips everything when the first skill alone exceeds budget", async () => {
    const out = await loadInjectedContent(
      ["project:security-audit"],
      [meta("security-audit")],
      allowedRoots,
      1,
    )
    expect(out.blocks).toEqual([])
    expect(out.skipped[0]?.reason).toBe("over-budget")
  })
})
