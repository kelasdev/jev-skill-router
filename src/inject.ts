import { readFile } from "node:fs/promises"
import { parseFrontmatter } from "./frontmatter.js"
import { isPathInside } from "./indexer.js"

export interface InjectedBlock {
  skillId: string
  text: string
}

export interface InjectResult {
  blocks: InjectedBlock[]
  skipped: { skillId: string; reason: string }[]
  totalTokens: number
}

/** Rough estimate: 1 token ~= 4 characters. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export async function loadInjectedContent(
  skillIds: string[],
  skills: { skillId: string; path: string }[],
  allowedRoots: string[],
  maxTotalTokens: number,
): Promise<InjectResult> {
  const byId = new Map(skills.map((s) => [s.skillId, s]))
  const blocks: InjectedBlock[] = []
  const skipped: { skillId: string; reason: string }[] = []
  let totalTokens = 0

  for (const skillId of skillIds) {
    const meta = byId.get(skillId)
    if (!meta) {
      skipped.push({ skillId, reason: "unknown-id" })
      continue
    }
    if (!isPathInside(meta.path, allowedRoots)) {
      skipped.push({ skillId, reason: "path-escape" })
      continue
    }
    let raw: string
    try {
      raw = await readFile(meta.path, "utf8")
    } catch {
      skipped.push({ skillId, reason: "missing-file" })
      continue
    }
    const { body } = parseFrontmatter(raw)
    const cost = estimateTokens(body)
    if (totalTokens + cost > maxTotalTokens) {
      // Skip the whole skill; never truncate instructions mid-text.
      skipped.push({ skillId, reason: "over-budget" })
      continue
    }
    blocks.push({ skillId, text: body })
    totalTokens += cost
  }

  return { blocks, skipped, totalTokens }
}
