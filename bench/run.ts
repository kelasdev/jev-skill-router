/**
 * Offline benchmark for the Jev Skill Router (TypeSafe cookbook pattern).
 *
 * Default mode runs entirely offline: a STUB selector that picks the BM25
 * top-1 — this measures the RETRIEVAL BASELINE, not Jev. Set JEV_BASE_URL
 * (plus optional JEV_API_KEY / JEV_MODEL) to measure the real two-call
 * cookbook flow (rank+gates → rerank shortlist) against a live endpoint,
 * e.g. the capture gateway at http://127.0.0.1:9999.
 *
 * Run: npm run bench          (BENCH_SMALL=1 to skip the 1000-skill pad)
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { scanSkills } from "../src/indexer.js"
import { retrieve } from "../src/retrieval.js"
import { resolveConfig } from "../src/config.js"
import { rosterFrom, selectSkills } from "../src/jev.js"
import type { SkillMeta } from "../src/types.js"

interface DatasetEntry {
  id: string
  request: string
  relevant: string[]
}

const here = path.dirname(fileURLToPath(import.meta.url))

async function main(): Promise<void> {
  const skills: SkillMeta[] = await scanSkills([
    { dir: path.join(here, "fixtures", "skills"), source: "project" },
  ])
  const dataset = (await readFile(path.join(here, "dataset.jsonl"), "utf8"))
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as DatasetEntry)

  const live = process.env.JEV_BASE_URL
  const config = resolveConfig({
    jev: {
      baseUrl: live ?? "http://127.0.0.1:1",
      apiKey: process.env.JEV_API_KEY ?? "",
      model: process.env.JEV_MODEL ?? "oc/jev-1.13-free",
    },
  })

  // Optional large-catalog stress (default on; BENCH_SMALL=1 to skip):
  // pad with synthetic distractors to check roster-trim behavior at scale.
  const largeCatalog = process.env.BENCH_SMALL !== "1"
  let catalog = skills
  if (largeCatalog) {
    const nouns = [
      "deploy", "billing", "cache", "logging", "auth", "queue", "schema",
      "metrics", "search", "upload", "email", "payment", "session", "config",
      "network", "storage", "invoice", "webhook", "dashboard", "export",
    ]
    const adjectives = [
      "robust", "fast", "legacy", "modern", "secure", "minimal", "verbose",
      "regional", "shared", "edge",
    ]
    const pad: SkillMeta[] = []
    for (let i = 0; pad.length < 1000 && i < 5000; i++) {
      const a = adjectives[i % adjectives.length]
      const n = nouns[Math.floor(i / adjectives.length) % nouns.length]
      const name = `${a}-${n}-${pad.length}`
      pad.push({
        skillId: `synthetic:${name}`,
        name,
        description: `Synthetic distractor skill for ${a} ${n} handling and maintenance.`,
        keywords: [],
        path: `/synthetic/${name}/SKILL.md`,
        source: "project",
        contentHash: "synthetic",
        mtimeMs: 0,
      })
    }
    catalog = [...skills, ...pad]
  }

  let trimmed = 0
  let trimKeptGold = 0
  let trimNeeded = 0
  let hitTop1 = 0
  let top1Total = 0
  let abstainCorrect = 0
  let abstainTotal = 0
  let suggestCorrect = 0
  let suggestTotal = 0
  let retrievalSumMs = 0
  let jevSumMs = 0
  let jevRequests = 0
  let injectedTokensEstimate = 0

  for (const entry of dataset) {
    const relevant = new Set(entry.relevant)

    // Roster construction mirrors router.ts: whole catalog unless it
    // exceeds the Choice option cap (config.maxCandidates = 200).
    const t0 = performance.now()
    let rosterInput = catalog
    if (catalog.length > config.maxCandidates) {
      trimmed++
      const topIds = new Set(
        retrieve(catalog, entry.request, config.maxCandidates).map((c) => c.skillId),
      )
      rosterInput = catalog.filter((s) => topIds.has(s.skillId))
      if (relevant.size > 0) {
        trimNeeded++
        if ([...relevant].every((r) => topIds.has(r))) trimKeptGold++
      }
    }
    retrievalSumMs += performance.now() - t0

    if (live) {
      // Real cookbook flow: two calls, gate + fits, at most one suggestion.
      const t1 = performance.now()
      const decision = await selectSkills({
        request: entry.request,
        roster: rosterFrom(rosterInput),
        config,
      })
      jevSumMs += performance.now() - t1
      jevRequests++
      if (relevant.size === 0) {
        abstainTotal++
        if (decision.decision === "abstain") abstainCorrect++
      } else {
        suggestTotal++
        if (
          decision.decision === "suggest" &&
          decision.suggested &&
          relevant.has(decision.suggested)
        ) {
          suggestCorrect++
          const skill = catalog.find((k) => k.skillId === decision.suggested)
          if (skill) injectedTokensEstimate += Math.ceil(skill.description.length / 4)
        }
      }
    } else {
      // Stub selector: BM25 top-1 (retrieval baseline).
      if (relevant.size > 0) {
        top1Total++
        const top1 = retrieve(catalog, entry.request, 1)[0]
        if (top1 && relevant.has(top1.skillId)) hitTop1++
      } else {
        abstainTotal++ // stub cannot abstain by construction
      }
    }
  }

  const pct = (a: number, b: number): string =>
    b === 0 ? "n/a" : `${((100 * a) / b).toFixed(1)}%`

  console.log("=== Jev Skill Router benchmark (cookbook pattern) ===")
  console.log(`catalog skills      : ${catalog.length}${largeCatalog ? " (1000 synthetic distractors)" : ""}`)
  console.log(`dataset requests    : ${dataset.length}`)
  console.log(`selector mode       : ${live ? `live Jev @ ${live}` : "stub (BM25 top-1 baseline)"}`)
  if (trimmed > 0) {
    console.log("--- roster trim (catalog > maxCandidates) ---")
    console.log(`requests trimmed    : ${trimmed}/${dataset.length}`)
    console.log(`trim kept all gold  : ${pct(trimKeptGold, trimNeeded)} (${trimKeptGold}/${trimNeeded})`)
  }
  console.log("--- selection ---")
  if (live) {
    console.log(`suggest precision   : ${pct(suggestCorrect, suggestTotal)} (${suggestCorrect}/${suggestTotal})`)
    console.log(`abstain accuracy    : ${pct(abstainCorrect, abstainTotal)} (${abstainCorrect}/${abstainTotal})`)
    console.log(`avg jev ms/request  : ${(jevSumMs / Math.max(1, jevRequests)).toFixed(2)} (2 calls each)`)
  } else {
    console.log(`baseline top-1 prec.: ${pct(hitTop1, top1Total)} (${hitTop1}/${top1Total})  [retrieval only, NOT Jev]`)
    console.log(`abstain accuracy    : n/a (stub cannot abstain)`)
  }
  console.log(`avg roster trim ms  : ${(retrievalSumMs / dataset.length).toFixed(2)}`)
  if (live) {
    console.log(`est. injected tokens: ${injectedTokensEstimate} (budget ${config.maxTotalTokens}/req)`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
