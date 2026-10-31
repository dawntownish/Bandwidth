// Simple, local reading statistics (no AI involved).
(function () {
  const B = (window.Bandwidth = window.Bandwidth || {});

  function countSyllables(word) {
    word = word.toLowerCase().replace(/[^a-z]/g, "");
    if (!word) return 0;
    if (word.length <= 3) return 1;
    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
    const m = word.match(/[aeiouy]{1,2}/g);
    return m ? m.length : 1;
  }

  B.splitSentences = function (text) {
    return text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [text];
  };

  B.computeMetrics = function (text) {
    const words = text.split(/\s+/).filter(Boolean);
    const sentences = (text.match(/[^.!?]+[.!?]+/g) || [text]).length;
    const wordCount = words.length;
    if (!wordCount) {
      return { words: 0, sentences: 0, avgSentenceLength: 0, longWordShare: 0, readingEase: 0 };
    }
    const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
    const longWords = words.filter((w) => w.replace(/[^a-z]/gi, "").length >= 7).length;
    const readingEase =
      206.835 - 1.015 * (wordCount / sentences) - 84.6 * (syllables / wordCount);

    return {
      words: wordCount,
      sentences,
      avgSentenceLength: Math.round((wordCount / sentences) * 10) / 10,
      longWordShare: Math.round((longWords / wordCount) * 100),
      readingEase: Math.round(readingEase),
    };
  };
})();
