import { createHash } from "node:crypto"
import { readFile, readdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { parseFrontmatter } from "./frontmatter.js"
import type { SkillMeta, SkillSource } from "./types.js"

export interface SkillDir {
  dir: string
  source: SkillSource
}

export function isPathInside(candidate: string, allowedRoots: string[]): boolean {
  // Containment via path.relative: a naive prefix check would accept a
  // sibling like "<root>-evil" when <root> is an allowed root.
  const resolved = path.resolve(candidate)
  return allowedRoots.some((root) => {
    const rel = path.relative(path.resolve(root), resolved)
    if (rel === "") return true // the root itself
    if (path.isAbsolute(rel)) return false // different drive on Windows
    return rel !== ".." && !rel.startsWith(`..${path.sep}`)
  })
}

async function collectSkillFiles(dir: string): Promise<string[]> {
  const found: string[] = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...(await collectSkillFiles(full)))
    } else if (entry.isFile() && entry.name === "SKILL.md") {
      found.push(full)
    }
  }
  return found
}

function keywordsFrom(name: string): string[] {
  return name
    .split(/[^A-Za-z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 1)
}

async function scanOne(file: string, source: SkillSource): Promise<SkillMeta | undefined> {
  try {
    const raw = await readFile(file, "utf8")
    const { data } = parseFrontmatter(raw)
    const name = data.name?.trim() || path.basename(path.dirname(file))
    const stats = await stat(file)
    return {
      skillId: `${source}:${name}`,
      name,
      description: data.description?.trim() ?? "",
      keywords: keywordsFrom(name),
      path: file,
      source,
      contentHash: createHash("sha256").update(raw).digest("hex"),
      mtimeMs: stats.mtimeMs,
    }
  } catch (err) {
    console.warn(`jev-skill-router: skipping unreadable skill ${file}:`, err)
    return undefined
  }
}

export async function scanSkills(dirs: SkillDir[]): Promise<SkillMeta[]> {
  const skills: SkillMeta[] = []
  for (const { dir, source } of dirs) {
    const files = await collectSkillFiles(dir)
    for (const file of files) {
      const meta = await scanOne(file, source)
      if (meta) skills.push(meta)
    }
  }
  return skills
}

export async function loadIndex(file: string): Promise<SkillMeta[] | undefined> {
  try {
    const raw = await readFile(file, "utf8")
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return undefined
    return parsed as SkillMeta[]
  } catch {
    return undefined
  }
}

export async function saveIndex(file: string, skills: SkillMeta[]): Promise<void> {
  await writeFile(file, JSON.stringify(skills), "utf8")
}

export async function refreshIndex(
  file: string,
  dirs: SkillDir[],
  opts: { refreshOnStart: boolean },
): Promise<{ skills: SkillMeta[]; rebuilt: boolean }> {
  const existing = opts.refreshOnStart ? undefined : await loadIndex(file)
  if (existing) {
    // Incremental: walk the directories (cheap), but only re-read files that
    // are new or whose mtime changed. Unchanged entries are reused verbatim,
    // so a 10k-skill catalog costs a readdir + stat per file, not a full
    // parse + hash of every SKILL.md.
    const byPath = new Map(existing.map((s) => [s.path, s]))
    const out: SkillMeta[] = []
    const seen = new Set<string>()
    let changed = false
    for (const { dir, source } of dirs) {
      for (const file of await collectSkillFiles(dir)) {
        if (seen.has(file)) continue
        seen.add(file)
        const prev = byPath.get(file)
        if (prev && prev.source === source) {
          try {
            const stats = await stat(file)
            if (stats.mtimeMs === prev.mtimeMs) {
              out.push(prev)
              continue
            }
          } catch {
            changed = true
            continue // unreadable now → drop
          }
        }
        const fresh = await scanOne(file, source)
        if (fresh) out.push(fresh)
        changed = true
      }
    }
    for (const skill of existing) {
      if (!seen.has(skill.path)) {
        changed = true
        break // deleted file → drop
      }
    }
    if (!changed) return { skills: existing, rebuilt: false }
    try {
      await saveIndex(file, out)
    } catch (err) {
      console.warn("jev-skill-router: failed to persist index:", err)
    }
    return { skills: out, rebuilt: true }
  }
  const skills = await scanSkills(dirs)
  try {
    await saveIndex(file, skills)
  } catch (err) {
    console.warn("jev-skill-router: failed to persist index:", err)
  }
  return { skills, rebuilt: true }
}
