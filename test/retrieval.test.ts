import { describe, expect, it } from "vitest"
import { retrieve } from "../src/retrieval.js"
import type { SkillMeta } from "../src/types.js"

function skill(
  skillId: string,
  name: string,
  description: string,
  source: "project" | "global" = "project",
): SkillMeta {
  return {
    skillId,
    name,
    description,
    keywords: name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean),
    path: `/x/${skillId}.md`,
    source,
    contentHash: "h",
    mtimeMs: 1,
  }
}

const catalog: SkillMeta[] = [
  skill("project:security-audit", "security-audit", "Menganalisis kerentanan keamanan pada kode."),
  skill("project:code-review", "code-review", "Meninjau kualitas dan kebenaran implementasi kode."),
  skill("project:xss-testing", "xss-testing", "Tests applications for cross-site scripting flaws."),
  skill("global:security-audit", "security-audit", "Menganalisis kerentanan keamanan pada kode.", "global"),
]

describe("retrieve", () => {
  it("surfaces the security skill for a security request", () => {
    const out = retrieve(catalog, "Analisis keamanan kode ini", 20)
    expect(out.length).toBeGreaterThan(0)
    expect(out[0].skillId).toContain("security")
  })

  it("returns [] for an irrelevant query", () => {
    expect(retrieve(catalog, "zzz qqq www", 20)).toEqual([])
  })

  it("respects the candidate cap", () => {
    const out = retrieve(catalog, "security code review analysis", 2)
    expect(out.length).toBeLessThanOrEqual(2)
  })

  it("orders project before global on equal scores", () => {
    const out = retrieve(catalog, "security audit", 20)
    const secs = out.filter((c) => c.skillId.endsWith(":security-audit"))
    expect(secs).toHaveLength(2)
    expect(secs[0].skillId).toBe("project:security-audit")
  })

  it("includes name, description and keywords in the search document", () => {
    // "scripting" only appears in the description of xss-testing.
    const out = retrieve(catalog, "scripting", 20)
    expect(out[0]?.skillId).toBe("project:xss-testing")
  })
})
