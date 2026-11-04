function normalize(s) {
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function appearsInSource(sentence, source) {
  const s = normalize(sentence);
  return s.length > 0 && normalize(source).includes(s);
}

function splitSentences(text) {
  return text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [text];
}

function wordCount(t) {
  return (t.match(/\S+/g) || []).length;
}

const NUMBER_WORDS = { zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12" };

function numbersOf(s) {
  return new Set((s.match(/\d[\d,]*(?:\.\d+)?/g) || []).map((n) => n.replace(/,/g, "")));
}

function hasNumber(text, digits) {
  if (numbersOf(text).has(digits)) return true;
  const word = Object.keys(NUMBER_WORDS).find((w) => NUMBER_WORDS[w] === digits);
  return !!word && new RegExp("\\b" + word + "\\b", "i").test(text);
}

function wordSet(s) {
  const set = new Set();
  (s.match(/[\p{L}][\p{L}'\u2019-]*/gu) || []).forEach((w) => set.add(w.toLowerCase().replace(/['\u2019]s$/, "")));
  return set;
}

function inventedNames(source, output) {
  const known = wordSet(source);
  const bad = [];
  splitSentences(output).forEach((sentence) => {
    const words = sentence.match(/[\p{L}][\p{L}'\u2019-]*/gu) || [];
    words.slice(1).forEach((w) => {
      if (w.length > 1 && /^\p{Lu}/u.test(w) && !known.has(w.toLowerCase().replace(/['\u2019]s$/, ""))) bad.push(w);
    });
  });
  return bad;
}

function negationCount(s) {
  return (s.match(/\b(?:not|no|never|none|nor|neither|nobody|nothing|cannot)\b|n['\u2019]t\b/gi) || []).length;
}

function copyRatio(source, output) {
  const toks = (t) => normalize(t).replace(/[^\p{L}\p{N}' ]/gu, " ").split(/\s+/).filter(Boolean);
  const grams = (w) => { const g = []; for (let i = 0; i + 2 < w.length; i++) g.push(w[i] + " " + w[i + 1] + " " + w[i + 2]); return g; };
  const src = new Set(grams(toks(source)));
  const out = grams(toks(output));
  return out.length ? out.filter((x) => src.has(x)).length / out.length : 0;
}

const MAX_COPY = { summary: 0.5, light: 0.93, medium: 0.7, full: 0.45 };

function checkSummary(source, lines) {
  if (!lines.length) return "the summary was empty";
  const out = lines.join(" ");
  const inWords = wordCount(source), outWords = wordCount(out);
  if (lines.length > 4) return "it had more than 4 sentences";
  if (outWords > Math.max(25, inWords * 0.6)) return "it was too long; a summary must be much shorter than the text";
  const copied = lines.filter((l) => appearsInSource(l, source)).length;
  if (copied / lines.length > 0.5 || copyRatio(source, out) > MAX_COPY.summary) return "it copied sentences from the text instead of writing them in new, simpler words";
  const srcNums = numbersOf(source);
  const badNum = [...numbersOf(out)].find((n) => !srcNums.has(n));
  if (badNum) return `it contained the number ${badNum}, which is not in the text`;
  const names = inventedNames(source, out);
  if (names.length) return `it contained ${names[0]}, which is not in the text`;
  if (negationCount(out) > 0 && negationCount(source) === 0) return "it added a negative (not/no/never) that the text does not have";
  return "";
}

const LENGTH_RANGE = { light: [0.7, 1.35], medium: [0.5, 1.5], full: [0.4, 1.6] };

function checkSimplified(source, paragraphs, tier) {
  if (!paragraphs.length) return "the answer was empty";
  const out = paragraphs.join("\n");
  const inWords = wordCount(source), outWords = wordCount(out);
  const [lo, hi] = LENGTH_RANGE[tier] || LENGTH_RANGE.medium;
  if (outWords < inWords * lo) return "it dropped too much of the text";
  if (outWords > inWords * hi) return "it added too much";
  if (inWords >= 8 && (normalize(out) === normalize(source) || copyRatio(source, out) > (MAX_COPY[tier] || MAX_COPY.medium))) {
    return "it is too close to the original text; it must use clearly different, easier words for this level";
  }
  const outNums = numbersOf(out);
  const lost = [...numbersOf(source)].find((n) => !outNums.has(n) && !hasNumber(out, n));
  if (lost) return `the number ${lost} from the text is missing`;
  const srcNums = numbersOf(source);
  const extra = [...outNums].find((n) => !srcNums.has(n));
  if (extra) return `it contained the number ${extra}, which is not in the text`;
  const names = inventedNames(source, out);
  if (names.length) return `it contained ${names[0]}, which is not in the text`;
  if ((negationCount(source) > 0) !== (negationCount(out) > 0)) return "it changed whether the text says not/no/never, which changes the meaning";
  return "";
}

module.exports = { appearsInSource, splitSentences, normalize, wordCount, checkSummary, checkSimplified };
