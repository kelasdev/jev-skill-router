export interface PrecheckResult {
  needed: boolean
  reason: string
}

// Whole-message patterns that clearly need no skill. Ambiguous text always
// passes through to retrieval — the pre-check is an optimization, not
// a source of truth.
const GREETINGS = new Set([
  "hi", "hello", "hey", "halo", "hai", "hoi", "yo", "ss", "ping",
  "selamat pagi", "selamat siang", "selamat sore", "selamat malam",
  "good morning", "good afternoon", "good evening", "good night",
  "morning", "assalamualaikum", "pagi", "siang", "malam",
])

const CLOSINGS = new Set([
  "thanks", "thank you", "thankyou", "thx", "ty",
  "terima kasih", "makasih", "mksh", "thanks banget",
  "bye", "dadah", "sampai jumpa", "see you", "see ya",
  "ok thanks", "oke thanks", "great thanks",
])

const ANSWERS = new Set([
  "yes", "no", "y", "n", "ok", "okay", "oke", "yo", "siap", "mantap",
  "ya", "tidak", "nggak", "ga", "gak", "bisa", "lanjut", "continue",
  "proceed", "go", "skip", "stop", "cancel", "batal",
])

export function needsSelection(text: string): PrecheckResult {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ")
  if (normalized.length === 0) {
    return { needed: false, reason: "empty-message" }
  }
  if (GREETINGS.has(normalized)) {
    return { needed: false, reason: "greeting" }
  }
  if (CLOSINGS.has(normalized)) {
    return { needed: false, reason: "closing" }
  }
  if (ANSWERS.has(normalized)) {
    return { needed: false, reason: "short-answer" }
  }
  return { needed: true, reason: "uncertain" }
}
