# Live Smoke Test — Jev Skill Router (Task 13)

Run these in a REAL OpenCode session. Tasks 1–12 prove the logic offline;
only this run proves the actual hook contract (`event.system` shape, hook
timing, plugin load path). OpenCode loads plugins in the **background
service** — every code change needs `opencode service restart` first.

## Setup (once)

1. Ensure at least one skill exists in `<project>/.opencode/skills/<name>/SKILL.md`.
2. Register the plugin in the project's `opencode.json(c)`:

   ```jsonc
   {
     "plugins": [
       {
         "package": "<abs path>/jev-skill-router",
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

   - Gateway mode (payload/response capture): `baseUrl: http://127.0.0.1:9999`
     — the adapter POSTs `http://127.0.0.1:9999/v1/systemone` (TWO calls
     per routed request: rank+gates, then rerank); open
     `http://127.0.0.1:9999/monitor.html` **before** the first request or
     events will not be recorded (status must show connected).
   - Offline mode (upstream off): `node bench/mock-jev.mjs` and
     `baseUrl: http://127.0.0.1:8787`.
3. `opencode service restart`.

## Checklist

- [ ] **S1 Positive path + payload inspection.** Send a request that matches
      the installed skill. In `monitor.html`, verify TWO `/v1/systemone`
      events: call 1 has `which` (criteria = all skill ids) + `gate::`
      questions; call 2 has `which` (shortlist with body excerpts) +
      `fits::` questions. Then run tool `jev_router_last_injected`:
      `decision: "suggest"`, `gate` > 0.30, one `injectedIds` entry,
      `jevCalled: true`, and the reply visibly follows the skill. Record the
      gateway latency/bytes rows.
- [ ] **S2 Dedupe.** Resend the identical message / trigger a tool
      continuation: NO new `/v1/systemone` events for that message in the
      monitor; diagnostics show no second entry for the same hash.
- [ ] **S3 Pre-check.** Send `hi`: `jevCalled: false`, no injected
      IDs, normal reply, no gateway event.
- [ ] **S4 Failure safety.** Stop the mock / point `baseUrl` at a
      dead port, restart service, send a skill-worthy request: the task
      completes normally, diagnostics `error` recorded, `injectedIds` empty.
- [ ] **S5 Session isolation.** Two sessions with different requests:
      `jev_router_last_injected` in each shows only its own selection.
- [ ] **S6 Record results** in the table below.

## Results

| Step | Expected | Observed | Pass |
|---|---|---|---|
| S1 payload | 2 systemone events: rank+gates then rerank | | |
| S1 injection | decision=suggest, one injectedIds entry | | |
| S1 latency | _(record ms / bytes per call)_ | | |
| S2 dedupe | no new gateway events for repeat | | |
| S3 pre-check | no Jev call on `hi` | | |
| S4 fail-safe | error recorded, no injection, task continues | | |
| S5 isolation | per-session diagnostics independent | | |
