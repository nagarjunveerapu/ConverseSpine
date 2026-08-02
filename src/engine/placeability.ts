/**
 * Placeability gate — slot validation, not intent classification.
 * Noise/filler must never become search locality or visit origin.
 */

const GIBBERISH_TOKEN =
  /^(?:asdf|qwer|zxcv|qaz|wsx|edc|rfv|tgb|yhn|ujm|foo|bar|baz|qux|xxx+|aaa+|bbb+|ccc+|test|testing|lorem|ipsum|hjkl|uiop|abcd|xyz+|qwerty|asdfghjkl|zxcvbnm)$/i;

const CHAT_FILLER =
  /^(?:lmao|lol|rofl|idk|omg|bro+|bruh|whatever|man|dude|haha+|hehe+|hmm+|hmmm+|ok(?:ay)?|fine|yeah|yep|nah|meh|smh|tbh|imo|imho|wtf|ffs|zzz+|bla+|blabla|asdfg?h?|qwerty|zxcvb)$/i;

const SMALLTALK_RE =
  /\b(?:how are you|what(?:'?s| is) up|why is \w+|cricket|football|weather|joke|funny|bored)\b/i;

/** Keyboard smash / filler token. */
export function isNoiseToken(w: string): boolean {
  const t = w.trim();
  if (!t) return true;
  if (GIBBERISH_TOKEN.test(t) || CHAT_FILLER.test(t)) return true;
  if (t.length >= 4 && !/[aeiouy]/i.test(t)) return true;
  if (/^(?:(.)\1{3,})$/i.test(t)) return true; // aaaa, zzzz
  return false;
}

/** Whole utterance is non-place dialogue noise. */
export function isNonPlaceUtterance(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (SMALLTALK_RE.test(t)) return true;
  if (/[?]/.test(t) && t.split(/\s+/).length > 4) return true;
  // Single smash token with digits ("3dsfoisuardo") — not a locality.
  if (/^[a-z0-9]{8,}$/i.test(t) && /\d/.test(t)) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const noisy = words.filter((w) => isNoiseToken(w.replace(/[^a-z0-9]/gi, '')));
  if (noisy.length === words.length) return true;
  if (words.length >= 2 && noisy.length >= Math.ceil(words.length * 0.6)) return true;
  return false;
}

/**
 * Label acceptable as a locality / visit origin.
 * Real places pass; smash, slang, and long questions fail.
 */
export function isPlausiblePlaceLabel(label: string): boolean {
  const l = label.trim();
  if (!l || l.length < 2 || l.length > 48) return false;
  const words = l.split(/\s+/).filter(Boolean);
  if (words.length > 6) return false;
  if (isNonPlaceUtterance(l)) return false;
  if (words.every((w) => isNoiseToken(w.replace(/[^a-z0-9]/gi, '')))) return false;
  if (SMALLTALK_RE.test(l)) return false;
  return true;
}
