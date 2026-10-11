import path from "node:path"
import os from "node:os"
import { createHash } from "node:crypto"
import { Plugin } from "@opencode/plugin"
import { resolveConfig } from "./config.js"
import { refreshIndex } from "./indexer.js"
import { Diagnostics } from "./diagnostics.js"
import { latestUserText, runRouter } from "./router.js"
import type { SessionState } from "./types.js"

interface SessionMessageLike {
  role: string
  content: unknown
}

export default Plugin.define({
  id: "jev-skill-router",
  async setup(ctx) {
    let config
    try {
      config = resolveConfig(ctx.options)
    } catch (err) {
      console.warn("jev-skill-router: disabled —", err)
      return
    }
    if (!config.enabled) return

    const projectDir = ctx.location.directory
    const skillDirs = [
      { dir: path.join(projectDir, ".opencode", "skills"), source: "project" as const },
      { dir: path.join(os.homedir(), ".config", "opencode", "skills"), source: "global" as const },
      { dir: path.join(os.homedir(), ".agents", "skills"), source: "global" as const },
    ]
    const allowedRoots = skillDirs.map((d) => d.dir)
    const indexFile = path.join(
      os.homedir(),
      ".jev-skill-router",
      `index-${createHash("sha256").update(ctx.location.project.id).digest("hex").slice(0, 16)}.json`,
    )

    // Index off the critical path; retrieval reuses whatever is ready.
    let skills: Awaited<ReturnType<typeof refreshIndex>>["skills"] = []
    void refreshIndex(indexFile, skillDirs, { refreshOnStart: config.refreshOnStart })
      .then((r) => {
        skills = r.skills
        console.warn(`jev-skill-router: index ready (${skills.length} skills)`)
      })
      .catch((err) => console.warn("jev-skill-router: index build failed:", err))

    const diagnostics = new Diagnostics()
    const sessions = new Map<string, SessionState>()

    await ctx.session.hook("context", async (event) => {
      // Fail-safe: nothing the hook does may break the main task.
      try {
        const request = latestUserText(
          event.messages as readonly SessionMessageLike[],
        )
        if (request === undefined) return
        const state = sessions.get(event.sessionID) ?? {}
        sessions.set(event.sessionID, state)
        const result = await runRouter({
          sessionID: event.sessionID,
          request,
          messageCount: event.messages.length,
          skills,
          config,
          state,
          diagnostics,
          allowedRoots,
        })
        if (result.systemText) {
          event.system.push({ type: "text", text: result.systemText })
        }
      } catch (err) {
        console.warn("jev-skill-router: hook error (continuing without injection):", err)
      }
    })

    if (config.diagnosticsEnabled) {
      await ctx.tool.transform((editor) => {
        editor.add({
          name: "jev_router_last_injected",
          description:
            "Show the last Jev Skill Router decisions for the current session: candidates, selection, injection, errors.",
          input: { type: "object", properties: {}, additionalProperties: false },
          execute: async (_input, context) => ({
            content: JSON.stringify(
              diagnostics.recentForSession(context?.sessionID ?? "", 5),
              null,
              2,
            ),
          }),
        })
      })
    }
  },
})
