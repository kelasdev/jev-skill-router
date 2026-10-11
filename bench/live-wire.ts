/**
 * LIVE wire-format test against the real capture gateway.
 *
 * Uses the ACTUAL adapter code (src/jev.ts selectSkills) — not hand-written
 * payloads — against the real endpoint, and prints the exact request and
 * response bodies so the README can show real captures, not guesses.
 *
 *   npx vite-node bench/live-wire.ts
 *
 * Env override: JEV_LIVE_URL / JEV_LIVE_KEY / JEV_LIVE_MODEL
 */
import { createServer } from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { scanSkills } from "../src/indexer.js"
import { rosterFrom, selectSkills } from "../src/jev.js"
import { resolveConfig } from "../src/config.js"

const URL_ = process.env.JEV_LIVE_URL ?? "http://127.0.0.1:9999/v1/systemone"
const KEY = process.env.JEV_LIVE_KEY ?? "test"
const MODEL = process.env.JEV_LIVE_MODEL ?? "oc/jev-1.13-free"
const BASE = URL_.replace(/\/v1\/systemone\/?$/, "")

const here = path.dirname(fileURLToPath(import.meta.url))

// Mirror what the plugin would have indexed: the bench fixture roster.
const skills = await scanSkills([
  { dir: path.join(here, "fixtures", "skills"), source: "project" },
])

const config = resolveConfig({
  jev: { baseUrl: BASE, apiKey: KEY, model: MODEL },
})

// Tap the wire: log every request/response body exactly as sent/received.
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  console.log("\n>>> REQUEST", init?.method ?? "GET", String(input))
  console.log(">>> HEADERS", JSON.stringify(init?.headers))
  console.log(">>> BODY", init?.body)
  const res = await realFetch(input as RequestInfo, init)
  const clone = res.clone()
  const text = await clone.text().catch(() => "")
  console.log("<<< STATUS", res.status)
  console.log("<<< RESPONSE", text)
  return res
}

const request = "Analisis keamanan kode ini dan cari kerentanan XSS"
console.log("=== roster ===")
console.log(rosterFrom(skills).map((r) => r.skillId))

const decision = await selectSkills({ request, roster: rosterFrom(skills), config })

console.log("\n=== final decision ===")
console.log(JSON.stringify(decision, null, 2))
