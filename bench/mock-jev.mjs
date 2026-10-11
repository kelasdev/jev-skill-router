/**
 * Minimal stand-in Jev endpoint speaking the TypeSafe Decisions protocol
 * (POST /v1/systemone, {state, questions} -> {answers, usage}).
 *
 * Call 1 (has gate:: questions): ranks criteria keys, all gates HIGH
 *   (→ gate passes, call 2 runs).
 * Call 2 (has fits:: questions): picks the first criteria key, all fits
 *   HIGH (→ a skill is suggested).
 *
 *   node bench/mock-jev.mjs              # listens on 127.0.0.1:8787
 *   JEV_MOCK_PORT=9000 node bench/mock-jev.mjs
 *
 * Point the plugin's options.jev.baseUrl at it and restart the OpenCode
 * service; verify via monitor/diagnostics.
 */
import { createServer } from "node:http"

const port = Number(process.env.JEV_MOCK_PORT ?? 8787)

const server = createServer((req, res) => {
  if (req.method !== "POST" || !req.url?.includes("/v1/systemone")) {
    res.writeHead(404).end()
    return
  }
  let raw = ""
  req.on("data", (c) => (raw += c))
  req.on("end", () => {
    let questions = {}
    try {
      questions = JSON.parse(raw).questions ?? {}
    } catch {
      /* keep empty */
    }
    const keys = Object.keys(questions)
    const isFirst = keys.some((k) => k.startsWith("gate::"))
    const criteriaKeys = Object.keys(
      (questions.which ?? {}).criteria ?? {},
    ).filter((k) => k !== "none")

    let answers
    if (isFirst) {
      // Call 1: uniform-ish ranking on the first option + all gates high.
      const probabilities = {}
      criteriaKeys.forEach((k, i) => (probabilities[k] = i === 0 ? 0.85 : 0.15 / Math.max(1, criteriaKeys.length - 1)))
      answers = {
        which: {
          type: "choice",
          choice: criteriaKeys[0] ?? "none",
          probabilities,
          confidence: 0.9,
        },
        "gate::acts_on_user_system": { type: "noul", noul: 0.95 },
        "gate::would_follow_documented_procedure": { type: "noul", noul: 0.9 },
        "gate::prose_suffices": { type: "noul", noul: 0.1 },
      }
    } else {
      // Call 2: winner = first shortlisted option, all fits high.
      answers = { which: { type: "choice", choice: criteriaKeys[0] ?? "none" } }
      for (const k of keys) {
        if (k.startsWith("fits::")) answers[k] = { type: "noul", noul: 0.9 }
      }
    }
    res.writeHead(200, { "content-type": "application/json" })
    res.end(
      JSON.stringify({
        model: "jev-mock",
        answers,
        usage: { input_tokens: 300, output_tokens: 30 },
      }),
    )
    console.log(`[mock-jev] ${new Date().toISOString()} ${isFirst ? "call1 rank+gates" : "call2 rerank"} ->`, answers.which?.choice)
  })
})

server.listen(port, "127.0.0.1", () => {
  console.log(`mock Jev listening on http://127.0.0.1:${port}/v1/systemone`)
})
