import { describe, expect, it } from "vitest"
import { parseFrontmatter } from "../src/frontmatter.js"

describe("parseFrontmatter", () => {
  it("parses name and description from a frontmatter block", () => {
    const raw = `---\nname: XSS Hunter\ndescription: Hunts XSS bugs.\n---\n\nBody content here.`
    const { data, body } = parseFrontmatter(raw)
    expect(data.name).toBe("XSS Hunter")
    expect(data.description).toBe("Hunts XSS bugs.")
    expect(body).toBe("Body content here.")
  })

  it("strips surrounding quotes from values", () => {
    const raw = `---\nname: "Quoted Name"\n---\nbody`
    expect(parseFrontmatter(raw).data.name).toBe("Quoted Name")
  })

  it("treats input without a closing fence as pure body", () => {
    const raw = `---\nname: broken\nno closing fence`
    const { data, body } = parseFrontmatter(raw)
    expect(data).toEqual({})
    expect(body).toBe(raw)
  })

  it("treats input without an opening fence as pure body", () => {
    const raw = `Just text\nwith lines`
    const { data, body } = parseFrontmatter(raw)
    expect(data).toEqual({})
    expect(body).toBe(raw)
  })

  it("handles empty input", () => {
    expect(parseFrontmatter("")).toEqual({ data: {}, body: "" })
  })

  it("preserves body verbatim including markdown", () => {
    const raw = `---\nname: x\n---\n# Title\n\n- item 1\n- item 2\n`
    expect(parseFrontmatter(raw).body).toBe("# Title\n\n- item 1\n- item 2\n")
  })

  it("ignores lines that are not top-level key: value", () => {
    const raw = `---\nname: x\n  nested: ignored\n- list item\n---\nbody`
    const { data } = parseFrontmatter(raw)
    expect(data.name).toBe("x")
    expect(data.nested).toBeUndefined()
  })
})
