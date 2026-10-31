// Turns the page's blocks into small cards.
// Words are only regrouped, never reworded. Each card remembers which blocks it came from,
// so Clean and Cards can jump to the same place.
(function () {
  const B = (window.Bandwidth = window.Bandwidth || {});

  function wordCount(text) {
    return text.split(/\s+/).filter(Boolean).length;
  }

  B.makeCards = function (blocks, maxWords = 90) {
    const cards = [];
    let cur = null;

    function flush() {
      if (cur && cur.parts.length) {
        cur.text = cur.parts.join("\n");
        cards.push(cur);
      }
      cur = null;
    }

    function start(heading, headingBlock) {
      cur = { id: cards.length, heading, headingBlock, parts: [], blocks: [], words: 0 };
    }

    blocks.forEach((block, bi) => {
      if (block.isHeading) {
        if (cur && !cur.parts.length) {
          // two headings in a row: keep both on one card
          cur.heading = cur.heading ? cur.heading + " — " + block.text : block.text;
          return;
        }
        flush();
        start(block.text, bi);
        return;
      }

      let pieces = [block.text];
      if (wordCount(block.text) > maxWords) {
        pieces = [];
        let group = "";
        B.splitSentences(block.text).forEach((s) => {
          if (group && wordCount(group + s) > maxWords) { pieces.push(group.trim()); group = ""; }
          group += s;
        });
        if (group.trim()) pieces.push(group.trim());
      }

      pieces.forEach((piece) => {
        const w = wordCount(piece);
        if (!cur) start(null, -1);
        if (cur.words + w > maxWords && cur.parts.length) {
          const heading = cur.heading;
          flush();
          start(heading, -1); // same heading, no "(continued)" label
        }
        cur.parts.push(piece);
        cur.blocks.push(bi);
        cur.words += w;
      });
    });

    flush();
    return cards;
  };

  B.cardFirstBlock = function (card) {
    return card.headingBlock >= 0 ? card.headingBlock : card.blocks[0] || 0;
  };

  B.cardIndexForBlock = function (cards, blockIndex) {
    let found = 0;
    cards.forEach((c, k) => { if (B.cardFirstBlock(c) <= blockIndex) found = k; });
    return found;
  };
})();
