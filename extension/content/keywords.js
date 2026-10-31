// Finds the page's most repeated meaningful words, for the Highlights toggle.
// Plain counting, no AI. It only marks words; it never changes them.
(function () {
  const B = (window.Bandwidth = window.Bandwidth || {});

  const STOP = new Set((
    "about above after again against also although always among another because been before being below " +
    "between both cannot could does doing down during each either else even ever every from further have " +
    "having here however into itself just like made make many might more most much must never only other " +
    "ought over same shall should since some still such than that their them then there these they this " +
    "those through thus under until upon very were what when where whether which while whom whose will with " +
    "within without would your often well their which including include includes based using used use " +
    "found given first second third rather although whereas thereby therefore"
  ).split(/\s+/));

  B.findKeywords = function (blocks, limit = 20) {
    const counts = new Map();
    blocks.forEach((b) => {
      if (b.isHeading) return;
      (b.text.toLowerCase().match(/[\p{L}][\p{L}'’-]*/gu) || []).forEach((w) => {
        if (w.length < 5 || STOP.has(w)) return;
        counts.set(w, (counts.get(w) || 0) + 1);
      });
    });
    return new Set(
      [...counts.entries()]
        .filter(([, c]) => c >= 3)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([w]) => w)
    );
  };
})();
