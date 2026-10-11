# Jev Skill Router

OpenCode V2 plugin: Jev (TypeSafe decision model) picks **at most one**
`SKILL.md` to inject into the main model's system prompt — using the
TypeSafe cookbook "skill suggestion" pattern (two decision calls, gated).
When nothing is relevant, or anything fails, nothing is injected and the
main task continues untouched.

Pipeline:

```
user message → local pre-check (greetings etc.)
   → roster = ALL indexed skills (BM25 trims ONLY if catalog > 200)
   → Call 1: Choice rank over the roster + 3 Noul gates   (POST {baseUrl}/v1/systemone)
      gate mean < 0.30 → abstain, done
   → Call 2: rerank top-3 (full description + 700-char body excerpt) + fits-Nouls
      all fits < 0.30 → abstain
   → budget-checked load of the ONE winner (frontmatter stripped)
   → <jev-selected-skills> block pushed into event.system
```

This is a plugin, not an MCP server — it hooks `session context` inside
OpenCode; no separate process, no tool the agent must call.

## How it works — the actual wire format

> All payloads below are **real captures**, replayed through `src/jev.ts`
> against the live gateway (`npx vite-node bench/live-wire.ts`) for the
> request `"Analisis keamanan kode ini dan cari kerentanan XSS"` over a
> 10-skill fixture roster. Nothing here is hand-written.

Endpoint and auth (exactly as configured):

```http
POST http://127.0.0.1:9999/v1/systemone
Authorization: Bearer test
Content-Type: application/json
```

The adapter sends **two** POSTs per routed request (TypeSafe Decisions
protocol: `{state, questions}` in, typed `{answers}` out — **not**
chat/completions).

### Call 1 — rank seluruh roster + 3 gerbang

Request (verbatim body, pretty-printed):

```json
{
  "model": "oc/jev-1.13-free",
  "state": {
    "request": "Analisis keamanan kode ini dan cari kerentanan XSS",
    "recent_context": ""
  },
  "questions": {
    "which": {
      "type": "choice",
      "instructions": "Which of these skills, if any, is the right one to load to help with the user's latest request?",
      "criteria": {
        "project:api-testing": "Menguji endpoint API: autentikasi, autorisasi, skema respons, dan rate limit.",
        "project:code-review": "Review kualitas dan kebenaran implementasi kode, bug, dan style.",
        "project:database": "Desain skema database, optimasi query, index, dan migrasi.",
        "project:deployment": "Konfigurasi deployment, pipeline rilis, docker, dan rollback produksi.",
        "project:docs-writing": "Menulis dokumentasi teknis, README, dan penjelasan API.",
        "project:git-workflow": "Membantu alur kerja git: branch, merge, rebase, dan resolve conflict.",
        "project:performance": "Analisis performa dan optimasi aplikasi: latensi, memori, loading lambat.",
        "project:security-audit": "Analisis kerentanan keamanan pada kode: injection, auth bypass, XSS, kelemahan autentikasi.",
        "project:ssrf-testing": "Menguji server-side request forgery pada endpoint yang mengambil URL, webhook, dan link preview.",
        "project:xss-testing": "Testing cross-site scripting pada aplikasi web: reflected, stored, DOM XSS."
      }
    },
    "gate::acts_on_user_system": { "type": "noul", "instructions": "Is the assistant being asked to act on the user's files, accounts, devices, or online services, rather than only to explain or advise?" },
    "gate::would_follow_documented_procedure": { "type": "noul", "instructions": "Would a careful expert answering this consult a specific documented procedure or set of commands, rather than answering from general understanding?" },
    "gate::prose_suffices": { "type": "noul", "instructions": "Could a knowledgeable generalist fully satisfy this request in prose, with no tools, no documentation, and no access to the user's files or accounts?" }
  }
}
```

Only **metadata** (id + description) is sent — never skill content.
Response (verbatim, `HTTP 200`):

```json
{
  "model": "jev-1.13-free",
  "answers": {
    "which": {
      "type": "choice",
      "choice": "project:security-audit",
      "confidence": 0.71,
      "probabilities": {
        "project:api-testing": 0,
        "project:code-review": 0,
        "project:database": 0,
        "project:deployment": 0,
        "project:docs-writing": 0,
        "project:git-workflow": 0,
        "project:performance": 0,
        "project:security-audit": 0.74,
        "project:ssrf-testing": 0,
        "project:xss-testing": 0.26
      }
    },
    "gate::acts_on_user_system": { "type": "noul", "noul": 0.16 },
    "gate::would_follow_documented_procedure": { "type": "noul", "noul": 0.4 },
    "gate::prose_suffices": { "type": "noul", "noul": 0.13 }
  },
  "usage": { "input_tokens": 762, "output_tokens": 199 }
}
```

(The request sends `model: "oc/jev-1.13-free"`; the gateway echoes back
`"jev-1.13-free"` — that normalization is upstream, not ours.)

Gate = oriented mean (`prose_suffices` inverted: `1 - noul`).
Here: `(0.16 + 0.40 + 0.87)/3 = 0.477` → above the 0.30 threshold, so
call 2 runs. Below threshold → `abstain`, call 2 is never sent.

### Call 2 — rerank top-3 dengan deskripsi penuh + cuplikan body

Request (verbatim body, pretty-printed):

```json
{
  "model": "oc/jev-1.13-free",
  "state": {
    "request": "Analisis keamanan kode ini dan cari kerentanan XSS",
    "recent_context": ""
  },
  "questions": {
    "which": {
      "type": "choice",
      "instructions": "Exactly one of these skills is the right one to load for the user's latest request. Which one? Read what each actually does, not just its name.",
      "criteria": {
        "project:security-audit": "Analisis kerentanan keamanan pada kode: injection, auth bypass, XSS, kelemahan autentikasi. — Periksa alur autentikasi, validasi input, dan sink berbahaya.\n",
        "project:xss-testing": "Testing cross-site scripting pada aplikasi web: reflected, stored, DOM XSS. — Uji input pengguna yang dirender ke HTML dan DOM sink.\n",
        "project:api-testing": "Menguji endpoint API: autentikasi, autorisasi, skema respons, dan rate limit. — Uji perilaku API dari sisi klien tanpa mengubah server.\n"
      }
    },
    "fits::project:security-audit": { "type": "noul", "instructions": "Does the skill 'security-audit' do the specific thing the user's request asks for? It is described as: Analisis kerentanan keamanan pada kode: injection, auth bypass, XSS, kelemahan autentikasi." },
    "fits::project:xss-testing": { "type": "noul", "instructions": "Does the skill 'xss-testing' do the specific thing the user's request asks for? It is described as: Testing cross-site scripting pada aplikasi web: reflected, stored, DOM XSS." },
    "fits::project:api-testing": { "type": "noul", "instructions": "Does the skill 'api-testing' do the specific thing the user's request asks for? It is described as: Menguji endpoint API: autentikasi, autorisasi, skema respons, dan rate limit." }
  }
}
```

Criteria values are `<description> — <first 700 chars of SKILL.md>`.
Response (verbatim, `HTTP 200`):

```json
{
  "model": "jev-1.13-free",
  "answers": {
    "which": {
      "type": "choice",
      "choice": "project:security-audit",
      "confidence": 0.74,
      "probabilities": {
        "project:security-audit": 0.83,
        "project:xss-testing": 0.17,
        "project:api-testing": 0
      }
    },
    "fits::project:security-audit": { "type": "noul", "noul": 0.97 },
    "fits::project:xss-testing": { "type": "noul", "noul": 0.92 },
    "fits::project:api-testing": { "type": "noul", "noul": 0.07 }
  },
  "usage": { "input_tokens": 646, "output_tokens": 123 }
}
```

All `fits` < 0.30 → `abstain`. Otherwise `which.choice` is the single
winning skill (criteria keys are defined by us, so Jev structurally cannot
invent ids; an unknown choice falls back to shortlist[0]).

### Final decision returned by the adapter

```json
{
  "decision": "suggest",
  "suggested": "project:security-audit",
  "gate": 0.47666666666666674,
  "gateValues": {
    "acts_on_user_system": 0.16,
    "would_follow_documented_procedure": 0.4,
    "prose_suffices": 0.13
  },
  "shortlist": ["project:security-audit", "project:xss-testing", "project:api-testing"],
  "fits": {
    "project:security-audit": 0.97,
    "project:xss-testing": 0.92,
    "project:api-testing": 0.07
  },
  "usage1": { "input_tokens": 762, "output_tokens": 199 },
  "usage2": { "input_tokens": 646, "output_tokens": 123 }
}
```

### Bentuk injeksi ke model utama

Pemenang dibaca dari disk, frontmatter dilepas, lalu di hook `context`
plugin menambahkan **satu blok** ke `event.system` (hanya untuk panggilan
model keluaran itu — tidak mengubah riwayat sesi):

```
<jev-selected-skills>
<skill_relevance>
Relevant to the current request: security-audit. Ignore this if it does not fit what the user actually asked for.
</skill_relevance>

<skill name="security-audit">
Periksa alur autentikasi, validasi input, dan sink berbahaya.
</skill>
</jev-selected-skills>
```

Blok `<skill_relevance>` mengikuti bentuk cookbook (di Hermes block ini
ditempel setelah roster; di OpenCode roster tidak ada di system prompt,
jadi isi skill ikut di dalam wrapper yang sama). Total dibatasi
`maxTotalTokens` (≈4000 token, estimasi `chars/4`) — skill kelebihan ukuran
**dilewatkan utuh**, tidak pernah dipotong. `abstain` atau error apa pun →
`event.system` tidak disentuh sama sekali.

## Install

The plugin ships as a local package. In your project's `opencode.json(c)`:

```jsonc
{
  "plugins": [
    {
      "package": "file:///<abs path>/jev-skill-router",
      "options": {
        "jev": {
          "baseUrl": "http://127.0.0.1:9999",
          "apiKey": "test",
          "model": "oc/jev-1.13-free"
        }
      }
    }
  ]
}
```

`baseUrl` must expose `POST /v1/systemone` (TypeSafe Decisions protocol).
The defaults above match the live capture gateway (`http://127.0.0.1:9999`,
`Bearer test`, `oc/jev-1.13-free`) — inspect every request and response in
`monitor.html` (open it before the first request). The root `index.ts`
(one-line re-export of `src/index.ts`) is the entrypoint OpenCode resolves
when `package` points at this directory — do not delete it. After any plugin
code change run `opencode service restart` — plugins load in the background
service. Verify with `opencode plugin list` — a working install shows:

```text
ID                VERSION  SOURCE
jev-skill-router  local    <abs path>/jev-skill-router/index.ts
```

## Configuration

All values are optional except `jev.baseUrl`. Thresholds and shortlist are the
cookbook defaults, pending calibration on real traffic; `jev.baseUrl`,
`jev.apiKey`, and `jev.model` below match the live capture gateway:

| Option | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch |
| `maxCandidates` | `200` | Roster cap (Jev Choice limit is 255); BM25 trims only above it |
| `timeoutMs` | `5000` | Per-call Jev timeout |
| `maxTotalTokens` | `4000` | Injection budget (1 token ≈ 4 chars, estimated) |
| `refreshOnStart` | `true` | Rebuild the index at plugin setup |
| `diagnosticsEnabled` | `true` | Register the `jev_router_last_injected` tool |
| `jev.model` | `oc/jev-1.13-free` | Decisions model id sent to `/v1/systemone` |
| `jev.gateThreshold` | `0.30` | Gate mean below this → abstain (call 2 skipped) |
| `jev.fitsThreshold` | `0.30` | Every fits-noul below this → abstain |
| `jev.shortlist` | `3` | Candidates reranked in call 2 |
| `jev.excerptChars` | `700` | SKILL.md excerpt sent per shortlisted candidate |

Skill directories scanned: `<project>/.opencode/skills/**/SKILL.md` (source
`project:`), `~/.config/opencode/skills/**/SKILL.md` (source `global:`),
and `~/.agents/skills/**/SKILL.md` (source `global:`).
`skill_id` is `"<source>:<name>"`, so equal names never collide. Invariant:
project beats global **only as a tie-breaker on identical retrieval scores**;
when scores differ, both candidates are visible to Jev and it picks on
metadata alone.

## Diagnostics

Tool `jev_router_last_injected` returns the 5 most recent decisions
**for the calling session only** (filtered by `sessionID`):
candidates found, whether Jev was called, selected vs injected IDs, skipped
skills with reasons (`unknown-id`, `path-escape`, `missing-file`,
`over-budget`), timings, and the error on any failure.

Per decision the shape is: `decision: "suggest" | "abstain"`,
`suggested` (the one skill_id, or `null`), `gate` / `gateValues`,
`shortlist`, `fits` (why it decided), and `suggestionBlock` (the exact
`<jev-selected-skills>` text injected into the system prompt — present
only when `decision === "suggest"`).

### Payload guards

The Jev request carries the raw user request and a Choice over the whole
roster, which can exceed the selector model's context (observed:
73k-char request + 50k-char criteria → `max_tokens_exceeded`). Three
guards cap it: the request is tail-truncated to 4000 chars (the ask lives
at the end; the head is boilerplate), every criterion to 200 chars, and
HTTP error bodies are surfaced (first 500 chars) in `diagnostics.error`
so a limit rejection is distinguishable from a plain HTTP error.

## Failure behavior (by design)

- Jev timeout / invalid JSON / HTTP error → no injection, error recorded.
- Gate mean < `gateThreshold` → **abstain** (first-class outcome, not an error).
- All `fits` < `fitsThreshold` → **abstain**.
- Choice winner not in the shortlist (hallucinated id) → shortlist[0] used;
  criteria keys are defined by us, so Jev structurally cannot invent ids.
- Same user request re-dispatched within the same turn (tool continuation,
  same message count) → selection runs once; the dedupe key is
  `sessionID + sha256(request + messageCount)`, so the same wording as a
  genuinely NEW turn runs selection again.
- Oversized skill → skipped whole, never truncated mid-instruction.

## Benchmark (offline, fixture catalog padded to 1010 skills, 30 labeled requests)

`npm run bench` (set `JEV_BASE_URL` to measure the real two-call flow;
`BENCH_SMALL=1` for the unpadded 10-skill catalog):

```
catalog skills      : 1010 (1000 synthetic distractors)
requests trimmed    : 30/30      [catalog > 200 → BM25 roster trim]
trim kept all gold  : 100.0% (25/25)
baseline top-1 prec.: 96.0% (24/25)  [retrieval only, NOT Jev]
avg roster trim ms  : 5.81
```

The stub number is the **retrieval baseline** — it is NOT Jev's selection
quality. Real precision/abstain-accuracy must be measured with
`JEV_BASE_URL=<endpoint> npm run bench` against the labeled dataset.

## Recovery

Delete `~/.jev-skill-router/index-*.json` to force a full rebuild; the index
is always derived from `SKILL.md` sources and never the other way around.

## Limitations (v1)

- Lexical BM25 only — synonym-heavy phrasing (ID↔EN paraphrase) relies on
  shared tokens; a vector stage is deferred until benchmarks prove need.
- Index refresh: `refreshOnStart: true` (default) always does a full
  re-scan of the skill dirs at plugin setup. Incremental reuse (walk the
  dirs, re-read only files whose mtime changed, reuse unchanged entries
  verbatim from `index-*.json`) applies only when `refreshOnStart: false`.
  A 10k-skill catalog then costs readdir+stat per file, not a full parse
  of every SKILL.md. No file watcher; changes are picked up
  on plugin restart or next `refreshOnStart`. Selection results are not cached
  across turns — the dedupe key covers repeats within a turn only.
- Token counts are a `chars/4` estimate, not a real tokenizer.
