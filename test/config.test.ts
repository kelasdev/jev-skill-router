import { describe, expect, it } from "vitest"
import { resolveConfig } from "../src/config.js"

const minimal = { jev: { baseUrl: "http://127.0.0.1:9999" } }

describe("resolveConfig", () => {
  it("returns cookbook defaults for minimal options", () => {
    const cfg = resolveConfig(minimal)
    expect(cfg.enabled).toBe(true)
    expect(cfg.maxCandidates).toBe(200)
    expect(cfg.timeoutMs).toBe(5000)
    expect(cfg.maxTotalTokens).toBe(4000)
    expect(cfg.injectOnError).toBe(false)
    expect(cfg.refreshOnStart).toBe(true)
    expect(cfg.diagnosticsEnabled).toBe(true)
    expect(cfg.jev.baseUrl).toBe("http://127.0.0.1:9999")
    expect(cfg.jev.model).toBe("oc/jev-1.13-free")
    expect(cfg.jev.gateThreshold).toBe(0.3)
    expect(cfg.jev.fitsThreshold).toBe(0.3)
    expect(cfg.jev.shortlist).toBe(3)
    expect(cfg.jev.excerptChars).toBe(700)
  })

  it("applies partial overrides and keeps other defaults", () => {
    const cfg = resolveConfig({
      ...minimal,
      injectOnError: true,
      jev: { baseUrl: "http://127.0.0.1:9999", gateThreshold: 0.5 },
    })
    expect(cfg.injectOnError).toBe(true)
    expect(cfg.jev.gateThreshold).toBe(0.5)
    expect(cfg.jev.fitsThreshold).toBe(0.3)
    expect(cfg.maxCandidates).toBe(200)
  })

  it("reads nested jev overrides", () => {
    const cfg = resolveConfig({
      jev: {
        baseUrl: "http://x",
        apiKey: "k",
        model: "m",
        shortlist: 5,
        excerptChars: 300,
      },
    })
    expect(cfg.jev.apiKey).toBe("k")
    expect(cfg.jev.model).toBe("m")
    expect(cfg.jev.shortlist).toBe(5)
    expect(cfg.jev.excerptChars).toBe(300)
  })

  it("throws when jev.baseUrl is missing", () => {
    expect(() => resolveConfig({})).toThrow(/baseUrl/)
    expect(() => resolveConfig(undefined)).toThrow(/baseUrl/)
  })

  it("falls back to defaults on wrong-typed values", () => {
    const cfg = resolveConfig({
      ...minimal,
      enabled: "yes",
      jev: { baseUrl: "http://127.0.0.1:9999", shortlist: "three" },
    })
    expect(cfg.enabled).toBe(true)
    expect(cfg.jev.shortlist).toBe(3)
  })

  it("falls back to default on out-of-range ratios and non-positive ints", () => {
    const cfg = resolveConfig({
      ...minimal,
      timeoutMs: -1,
      maxTotalTokens: 0,
      jev: {
        baseUrl: "http://127.0.0.1:9999",
        gateThreshold: 1.5,
        fitsThreshold: -0.1,
      },
    })
    expect(cfg.timeoutMs).toBe(5000)
    expect(cfg.maxTotalTokens).toBe(4000)
    expect(cfg.jev.gateThreshold).toBe(0.3)
    expect(cfg.jev.fitsThreshold).toBe(0.3)
  })
})
