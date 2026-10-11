import { describe, expect, it } from "vitest"
import { needsSelection } from "../src/precheck.js"

describe("needsSelection", () => {
  it("flags skill-worthy requests as needed", () => {
    expect(needsSelection("Analisis keamanan kode ini").needed).toBe(true)
    expect(needsSelection("review my python script for bugs").needed).toBe(true)
    expect(needsSelection("fix the failing tests in src/api").needed).toBe(true)
  })

  it("skips greetings", () => {
    for (const t of ["hi", "hello", "hey", "halo", "hai", "selamat pagi"]) {
      expect(needsSelection(t).needed).toBe(false)
    }
  })

  it("skips thanks and closings", () => {
    for (const t of ["thanks", "thank you", "terima kasih", "ok thanks", "bye", "dadah"]) {
      expect(needsSelection(t).needed).toBe(false)
    }
  })

  it("skips pure affirmative/negative answers", () => {
    for (const t of ["yes", "no", "ya", "tidak", "y", "n", "ok", "oke", "lanjut", "continue"]) {
      expect(needsSelection(t).needed).toBe(false)
    }
  })

  it("skips empty and whitespace-only", () => {
    expect(needsSelection("").needed).toBe(false)
    expect(needsSelection("   \n\t ").needed).toBe(false)
  })

  it("passes ambiguous mid-length text through to retrieval", () => {
    expect(needsSelection("yang tadi itu loh").needed).toBe(true)
  })

  it("returns a human-readable reason", () => {
    expect(needsSelection("hi").reason.length).toBeGreaterThan(0)
  })
})
