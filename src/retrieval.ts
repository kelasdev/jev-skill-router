import { scoreBM25, tokenize } from "./bm25.js"
import type { Candidate, SkillMeta } from "./types.js"

export function retrieve(
  skills: SkillMeta[],
  query: string,
  maxCandidates: number,
): Candidate[] {
  if (skills.length === 0) return []
  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) return []

  const docs = skills.map((s) =>
    tokenize(`${s.name} ${s.description} ${s.keywords.join(" ")}`),
  )
  const scores = scoreBM25(queryTokens, docs)

  const candidates: Candidate[] = []
  for (let i = 0; i < skills.length; i++) {
    if (scores[i] <= 0) continue
    candidates.push({
      skillId: skills[i].skillId,
      name: skills[i].name,
      description: skills[i].description,
      score: scores[i],
    })
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    // Tie-break: project source before global.
    const aProj = a.skillId.startsWith("project:") ? 0 : 1
    const bProj = b.skillId.startsWith("project:") ? 0 : 1
    return aProj - bProj
  })

  return candidates.slice(0, maxCandidates)
}
