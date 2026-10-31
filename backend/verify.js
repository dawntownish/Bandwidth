// Checks that run in plain code (no AI), so wrong output gets caught.

function normalize(s) {
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// True only if the sentence appears word-for-word inside the source text.
function appearsInSource(sentence, source) {
  const s = normalize(sentence);
  return s.length > 0 && normalize(source).includes(s);
}

function splitSentences(text) {
  return text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [text];
}

module.exports = { appearsInSource, splitSentences, normalize };
