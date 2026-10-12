export interface CaptionCue {
  text: string;
  start: number;
  end: number;
}

/** Splits a script into short caption chunks, preferring to break at punctuation. */
export function chunkText(text: string, maxWords = 4): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const chunks: string[] = [];
  let current: string[] = [];
  for (const word of words) {
    current.push(word);
    const endsSentence = /[.!?,;:]$/.test(word);
    if (current.length >= maxWords || (endsSentence && current.length >= 2)) {
      chunks.push(current.join(" "));
      current = [];
    }
  }
  if (current.length) chunks.push(current.join(" "));
  return chunks;
}

/**
 * Spreads chunks over a time window in proportion to their word count. TTS and
 * Veo don't return word timestamps, and speech rate is steady enough that this
 * stays in sync for short ads.
 */
export function timeCaptions(
  chunks: string[],
  start: number,
  duration: number,
): CaptionCue[] {
  const weights = chunks.map((c) => c.split(" ").length + 0.5);
  const total = weights.reduce((a, b) => a + b, 0);
  let t = start;
  return chunks.map((text, i) => {
    const length = (weights[i] / total) * duration;
    const cue = { text, start: t, end: t + length };
    t += length;
    return cue;
  });
}
