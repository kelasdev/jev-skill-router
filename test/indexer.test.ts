import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  isPathInside,
  loadIndex,
  refreshIndex,
  saveIndex,
  scanSkills,
} from "../src/indexer.js"

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures")
const skillsA = path.join(fixtures, "skills-a")
const skillsB = path.join(fixtures, "skills-b")

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "jev-index-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("scanSkills", () => {
  it("finds skills in both dirs with source-prefixed skillIds", async () => {
    const skills = await scanSkills([
      { dir: skillsA, source: "project" },
      { dir: skillsB, source: "global" },
    ])
    const ids = skills.map((s) => s.skillId).sort()
    expect(ids).toContain("project:security-audit")
    expect(ids).toContain("project:code-review")
    expect(ids).toContain("global:security-audit")
    expect(ids).toContain("global:xss-testing")
  })

  it("populates name, description, keywords, hash and mtime", async () => {
    const skills = await scanSkills([{ dir: skillsA, source: "project" }])
    const audit = skills.find((s) => s.skillId === "project:security-audit")!
    expect(audit.name).toBe("security-audit")
    expect(audit.description).toBe("Menganalisis kerentanan keamanan pada kode.")
    expect(audit.keywords).toContain("security")
    expect(audit.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(audit.mtimeMs).toBeGreaterThan(0)
    expect(audit.path.endsWith("SKILL.md")).toBe(true)
  })

  it("keeps name-colliding skills as distinct IDs", async () => {
    const skills = await scanSkills([
      { dir: skillsA, source: "project" },
      { dir: skillsB, source: "global" },
    ])
    const collisions = skills.filter((s) => s.name === "security-audit")
    expect(collisions).toHaveLength(2)
    expect(new Set(collisions.map((s) => s.skillId)).size).toBe(2)
  })

  it("skips malformed files without aborting the scan", async () => {
    const skills = await scanSkills([{ dir: skillsA, source: "project" }])
    // broken fixture has no closing fence -> body-only, but must not crash;
    // name falls back to the directory name.
    expect(skills.some((s) => s.name === "broken")).toBe(true)
    expect(skills).toHaveLength(3)
  })

  it("returns empty for a missing dir", async () => {
    const skills = await scanSkills([
      { dir: path.join(dir, "nope"), source: "project" },
    ])
    expect(skills).toEqual([])
  })
})

describe("index persistence", () => {
  it("save then load round-trips", async () => {
    const skills = await scanSkills([{ dir: skillsA, source: "project" }])
    const file = path.join(dir, "index.json")
    await saveIndex(file, skills)
    const loaded = await loadIndex(file)
    expect(loaded).toEqual(skills)
  })

  it("loadIndex returns undefined on corrupt JSON", async () => {
    const file = path.join(dir, "index.json")
    await writeFile(file, "{not json", "utf8")
    expect(await loadIndex(file)).toBeUndefined()
  })

  it("loadIndex returns undefined on missing file", async () => {
    expect(await loadIndex(path.join(dir, "missing.json"))).toBeUndefined()
  })
})

describe("refreshIndex", () => {
  it("rebuilds and saves when index is missing", async () => {
    const file = path.join(dir, "index.json")
    const { skills, rebuilt } = await refreshIndex(
      file,
      [{ dir: skillsA, source: "project" }],
      { refreshOnStart: false },
    )
    expect(rebuilt).toBe(true)
    expect(skills).toHaveLength(3)
    expect(await loadIndex(file)).toEqual(skills)
  })

  it("reuses the saved index when refreshOnStart is false and unchanged", async () => {
    const file = path.join(dir, "index.json")
    await refreshIndex(file, [{ dir: skillsA, source: "project" }], {
      refreshOnStart: false,
    })
    const second = await refreshIndex(
      file,
      [{ dir: skillsA, source: "project" }],
      { refreshOnStart: false },
    )
    expect(second.rebuilt).toBe(false)
    expect(second.skills).toHaveLength(3)
  })

  it("forces a rescan when refreshOnStart is true", async () => {
    const file = path.join(dir, "index.json")
    await refreshIndex(file, [{ dir: skillsA, source: "project" }], {
      refreshOnStart: false,
    })
    const second = await refreshIndex(
      file,
      [{ dir: skillsA, source: "project" }],
      { refreshOnStart: true },
    )
    expect(second.rebuilt).toBe(true)
  })

  it("drops entries whose files disappeared", async () => {
    // Copy a real skill tree into temp so we can genuinely delete one.
    const { cp } = await import("node:fs/promises")
    const live = path.join(dir, "live-skills")
    await cp(skillsA, live, { recursive: true })
    const file = path.join(dir, "index.json")
    await refreshIndex(file, [{ dir: live, source: "project" }], {
      refreshOnStart: false,
    })
    // Delete one skill entirely; the rest keep their mtimes.
    await rm(path.join(live, "code-review"), { recursive: true, force: true })
    const { skills, rebuilt } = await refreshIndex(
      file,
      [{ dir: live, source: "project" }],
      { refreshOnStart: false },
    )
    expect(rebuilt).toBe(true)
    expect(skills.map((s) => s.name).sort()).toEqual(["broken", "security-audit"])
  })
})

describe("isPathInside", () => {
  it("accepts a path inside an allowed root", () => {
    expect(isPathInside(path.join(skillsA, "code-review", "SKILL.md"), [skillsA])).toBe(
      true,
    )
  })

  it("rejects traversal escaping the root", () => {
    expect(isPathInside(path.join(skillsA, "..", "..", "etc", "passwd"), [skillsA])).toBe(
      false,
    )
  })

  it("rejects a sibling dir sharing a prefix", () => {
    expect(isPathInside(skillsA + "-evil", [skillsA])).toBe(false)
  })

  it("rejects when no roots are allowed", () => {
    expect(isPathInside(path.join(skillsA, "x"), [])).toBe(false)
  })

  it("accepts a path in a differently-spelled but same root", () => {
    const doubled = path.join(skillsA, ".", "code-review", "SKILL.md")
    expect(isPathInside(doubled, [skillsA])).toBe(true)
  })
})

describe("incremental refresh", () => {
  it("re-reads only the changed file and keeps others verbatim", async () => {
    const { cp, utimes } = await import("node:fs/promises")
    const live = path.join(dir, "live-skills")
    await cp(skillsA, live, { recursive: true })
    const file = path.join(dir, "index.json")
    const first = await refreshIndex(file, [{ dir: live, source: "project" }], {
      refreshOnStart: false,
    })
    const before = new Map(first.skills.map((s) => [s.skillId, s.contentHash]))

    // Modify exactly one skill file and force a distinct mtime.
    const target = path.join(live, "code-review", "SKILL.md")
    await writeFile(target, "---\nname: code-review\ndescription: REVISED.\n---\nNew body.\n", "utf8")
    const future = new Date(Date.now() + 10_000)
    await utimes(target, future, future)

    const second = await refreshIndex(file, [{ dir: live, source: "project" }], {
      refreshOnStart: false,
    })
    expect(second.rebuilt).toBe(true)
    const after = new Map(second.skills.map((s) => [s.skillId, s]))
    // Unchanged skill keeps its exact previous hash (not re-read).
    expect(after.get("project:security-audit")!.contentHash).toBe(
      before.get("project:security-audit"),
    )
    // Changed skill has a new hash and the revised description.
    expect(after.get("project:code-review")!.contentHash).not.toBe(
      before.get("project:code-review"),
    )
    expect(after.get("project:code-review")!.description).toBe("REVISED.")
  })
})
