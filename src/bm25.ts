const STOPWORDS = new Set([
  // English
  "the", "a", "an", "and", "or", "of", "to", "in", "for", "on", "with", "is",
  "are", "was", "were", "be", "been", "this", "that", "it", "as", "at", "by",
  "from", "you", "your", "our", "we",
  // Indonesian
  "yang", "untuk", "dan", "di", "ke", "dari", "ini", "itu", "atau", "dengan",
  "pada", "adalah", "akan", "bisa", "dapat", "saya", "kami", "kita", "mereka",
])

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
}

export function scoreBM25(
  queryTokens: string[],
  docs: string[][],
  k1 = 1.2,
  b = 0.75,
): number[] {
  if (docs.length === 0) return []
  if (queryTokens.length === 0) return docs.map(() => 0)

  const n = docs.length
  const docLen = docs.map((d) => d.length)
  const avgLen = docLen.reduce((a, l) => a + l, 0) / n || 1

  // Term frequencies per doc.
  const tfs: Map<string, number>[] = docs.map((d) => {
    const tf = new Map<string, number>()
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1)
    return tf
  })

  // Document frequency per query term.
  const df = new Map<string, number>()
  for (const term of new Set(queryTokens)) {
    let count = 0
    for (const tf of tfs) if (tf.has(term)) count++
    df.set(term, count)
  }

  return docs.map((_, i) => {
    let score = 0
    for (const term of new Set(queryTokens)) {
      const f = tfs[i].get(term)
      if (!f) continue
      const idf = Math.log(1 + (n - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5))
      const norm = f * (k1 + 1) / (f + k1 * (1 - b + (b * docLen[i]) / avgLen))
      score += idf * norm
    }
    return score
  })
}
