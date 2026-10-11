export interface FrontmatterResult {
  data: Record<string, string>
  body: string
}

const OPENING = /^---[ \t]*\r?\n/

export function parseFrontmatter(raw: string): FrontmatterResult {
  if (raw.length === 0) return { data: {}, body: "" }
  if (!OPENING.test(raw)) return { data: {}, body: raw }

  // Find the closing fence on its own line after the opening fence.
  const rest = raw.slice(OPENING.exec(raw)![0].length)
  const fenceMatch = /^---[ \t]*\r?$/m.exec(rest)
  if (!fenceMatch) return { data: {}, body: raw }

  const fmEnd = fenceMatch.index
  const afterFence = rest.slice(fmEnd + fenceMatch[0].length)
  // Drop the single newline right after the closing fence, then trim
  // leading blank lines; everything else stays verbatim.
  const body = afterFence.replace(/^\r?\n/, "").replace(/^\r?\n+/, "")

  const data: Record<string, string> = {}
  for (const line of rest.slice(0, fmEnd).split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line)
    if (!kv) continue
    let value = kv[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }
    data[kv[1]] = value
  }
  return { data, body }
}
