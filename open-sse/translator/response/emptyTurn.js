/**
 * The notice a translator emits when an upstream answers with nothing at all.
 *
 * It is deliberately visible text rather than a log line — see `emitEmptyTurnNotice`
 * — which means the combo cascade cannot tell it apart from a real answer by status
 * code or by stream shape. It only ever appears at the very start of a turn, so the
 * cascade recognises it by its opening, and the phrase lives here so the two
 * translators that write it and the one place that reads it cannot drift apart.
 */

export const EMPTY_TURN_PREFIX = "[9router]";
export const EMPTY_TURN_PHRASE = "returned a response with no content";

/**
 * True when the opening of a turn is one of our own empty-turn notices.
 *
 * Anchored at the start: a model quoting the phrase mid-answer is discussing it,
 * not failing, and must not be thrown away.
 */
export function isEmptyTurnNotice(text) {
  const opening = String(text || "").trimStart();
  if (!opening.startsWith(EMPTY_TURN_PREFIX)) return false;
  return opening.slice(0, 400).includes(EMPTY_TURN_PHRASE);
}
