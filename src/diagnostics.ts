import type { DiagnosticRecord } from "./types.js"

const MAX_RECORDS = 100
const EXCERPT_LIMIT = 120

export type { DiagnosticRecord }

export class Diagnostics {
  private records: DiagnosticRecord[] = []

  record(r: DiagnosticRecord): void {
    const safe: DiagnosticRecord = {
      ...r,
      requestExcerpt:
        r.requestExcerpt.length > EXCERPT_LIMIT
          ? r.requestExcerpt.slice(0, EXCERPT_LIMIT)
          : r.requestExcerpt,
    }
    this.records.push(safe)
    if (this.records.length > MAX_RECORDS) {
      this.records.splice(0, this.records.length - MAX_RECORDS)
    }
  }

  last(sessionID: string): DiagnosticRecord | undefined {
    for (let i = this.records.length - 1; i >= 0; i--) {
      if (this.records[i].sessionID === sessionID) return this.records[i]
    }
    return undefined
  }

  recent(limit: number): DiagnosticRecord[] {
    return this.records.slice(-limit).reverse()
  }

  recentForSession(sessionID: string, limit: number): DiagnosticRecord[] {
    const out: DiagnosticRecord[] = []
    for (let i = this.records.length - 1; i >= 0 && out.length < limit; i--) {
      if (this.records[i].sessionID === sessionID) out.push(this.records[i])
    }
    return out
  }
}
