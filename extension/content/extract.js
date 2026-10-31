// Reads the page's article text. It only READS: the page itself is never changed.
// Works on ordinary articles AND on custom sites (divs, spans, <br>, layout tables, web components).
// Kept: headings, paragraphs, list items, quotes, code (text exactly as written).
// Dropped: navigation, ads, banners, cookie notices, sidebars, footers, data tables, figures,
//          buttons, forms' controls, link-only lists.
(function () {
  const B = (window.Bandwidth = window.Bandwidth || {});

  const SKIP_TAGS = new Set([
    "NAV", "FOOTER", "ASIDE", "FIGURE", "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IFRAME",
    "BUTTON", "SELECT", "TEXTAREA", "INPUT", "SVG", "DIALOG", "CANVAS", "VIDEO", "AUDIO", "OBJECT", "EMBED",
  ]);
  const SKIP_ROLES = new Set([
    "navigation", "contentinfo", "complementary", "search", "dialog", "alertdialog", "menu", "menubar", "toolbar",
  ]);
  // Class or id names that usually mean "not the article".
  const JUNK = /(^|[\s_-])(ads?|advert|advertisement|sponsor|sponsored|promo|banner|cookies?|popup|modal|newsletter|subscribe|share|sharing|related|sidebar|breadcrumbs?|menu|toolbar|pagination|feedback|skip)($|[\s_-])/i;
  // Known "not the article" boxes: Wikipedia maintenance banners, "not to be confused with" lines, tables of
  // contents, reference lists, [1]-style citation marks, [edit] links, picture captions, navboxes.
  const BOILERPLATE_CLASS = /(^|\s)(ambox|hatnote|dablink|rellink|navbox|vertical-navbox|metadata|mbox-small|sistersitebox|shortdescription|mw-editsection|noprint|toc|mw-toc|reflist|references|mw-references-wrap|refbegin|catlinks|printfooter|authority-control|thumb|thumbcaption|gallery|reference|mw-ref|mw-jump-link)(\s|$)/i;
  const HEADING = /^H[1-6]$/;
  const KEEP_SHORT = new Set(["P", "LI", "BLOCKQUOTE", "DD", "DT", "PRE", "H1", "H2", "H3", "H4", "H5", "H6"]);
  const ROOT_HINTS =
    'article,main,[role="main"],#content,#main,.post,.entry-content,.article-body,.post-content,[itemprop="articleBody"]';

  const textLen = (el) => (el.textContent || "").length;

  function linkDensity(el) {
    let links = 0;
    el.querySelectorAll("a").forEach((a) => { links += (a.textContent || "").length; });
    return links / (textLen(el) || 1);
  }

  // Layout tables (old/custom sites) hold the page; data tables hold numbers.
  function isDataTable(t) {
    const role = (t.getAttribute("role") || "").toLowerCase();
    if (role === "presentation" || role === "none") return false;
    const cells = t.querySelectorAll("td,th");
    if (!cells.length) return true;
    let total = 0;
    cells.forEach((c) => { total += textLen(c); });
    if (total / cells.length > 150) return false;
    const paras = t.querySelectorAll("p");
    for (let i = 0; i < paras.length; i++) if (textLen(paras[i]) >= 120) return false;
    return true;
  }

  // True if this whole subtree should be skipped.
  function prune(el) {
    const tag = el.tagName.toUpperCase();
    if (SKIP_TAGS.has(tag)) return true;
    if (tag === "HEADER" && !el.closest("article,main")) return true;
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (SKIP_ROLES.has(role)) return true;
    if (el.getAttribute("aria-hidden") === "true" || el.hasAttribute("hidden")) return true;
    if (tag === "TABLE") return isDataTable(el);
    const cls = typeof el.className === "string" ? el.className : "";
    const id = el.id || "";
    if (cls && BOILERPLATE_CLASS.test(cls)) return true;
    if (id && /^(toc|siteSub|contentSub|catlinks|mw-navigation|footer|jump-to-nav)$/i.test(id)) return true;
    if ((cls && JUNK.test(cls)) || (id && JUNK.test(id))) {
      // A big wrapper with lots of real text and few links is content, not clutter.
      if (textLen(el) > 1500 && linkDensity(el) < 0.3) return false;
      return true;
    }
    return false;
  }

  function pickRoot() {
    const bodyLen = textLen(document.body) || 1;
    let best = null;
    let bestLen = 0;
    document.querySelectorAll(ROOT_HINTS).forEach((e) => {
      const len = textLen(e);
      if (len > bestLen) { best = e; bestLen = len; }
    });
    if (best && bestLen >= 500 && bestLen >= bodyLen * 0.25) return best;
    return document.body;
  }

  const displayCache = new WeakMap();
  function isInline(el) {
    let v = displayCache.get(el);
    if (v === undefined) {
      const d = getComputedStyle(el).display;
      v = /^inline/.test(d) || d === "contents";
      displayCache.set(el, v);
    }
    return v;
  }

  // The nearest enclosing "paragraph-like" element (skips inline elements such as <a>, <span>, <b>).
  function blockOf(el, root) {
    let cur = el;
    while (cur.parentElement && cur !== root && isInline(cur)) cur = cur.parentElement;
    return cur;
  }

  function collect(root) {
    const groups = [];
    let cur = null;

    function walk(node) {
      for (let n = node.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) {
          const t = n.nodeValue;
          if (!t) continue;
          if (!t.trim()) { if (cur) cur.parts.push(" "); continue; }
          const p = n.parentElement;
          const block = blockOf(p || root, root);
          if (!cur || cur.el !== block) {
            cur = { el: block, parts: [], link: 0 };
            groups.push(cur);
          }
          cur.parts.push(t);
          if (p && p.closest("a")) cur.link += t.trim().length;
        } else if (n.nodeType === 1) {
          if (n !== root && prune(n)) continue;
          if (n.tagName === "BR" && cur) cur.parts.push(" ");
          if (n.shadowRoot) walk(n.shadowRoot); // open web components
          walk(n);
        }
      }
    }
    walk(root);
    return groups;
  }

  // Lines that are page furniture on any site, wherever they appear.
  const FURNITURE = /^(from wikipedia, the free encyclopedia|jump to (navigation|search)|skip to (main )?content|advertisement|sponsored( content)?|cookie|we use cookies|accept (all )?cookies|subscribe( to)?|sign up for|share this|follow us|click here|all rights reserved|©|this article (may need to be rewritten|needs (more|additional) (citations|references)|has multiple issues|does not cite|may be too long|is an orphan)|not to be confused with|for other uses, see|redirects here)/i;

  function words(t) { return t.split(/\s+/).length; }

  // A "real paragraph": ordinary prose, a few sentences long, not mostly links, not furniture.
  function isRealParagraph(b) {
    if (b.isHeading || b.tag === "li" || b.tag === "pre") return false;
    if (FURNITURE.test(b.text)) return false;
    if (words(b.text) < 18) return false;
    if (!/[.!?]["'”’)\]]?(\s|$)/.test(b.text)) return false;
    return true;
  }

  // Start the reader at the article itself: drop bylines, banners, notices and other lead-in lines
  // that come before the first real paragraph. Text is never changed, only skipped.
  function trimLeadIn(blocks) {
    const first = blocks.findIndex(isRealParagraph);
    if (first <= 0 || first > Math.max(12, blocks.length * 0.5)) return blocks;
    const kept = [];
    let title = false;
    for (let i = 0; i < first; i++) {
      const b = blocks[i];
      if (b.isHeading && b.level === 1 && !title) { kept.push(b); title = true; }
    }
    const before = blocks[first - 1];
    if (before.isHeading && !kept.includes(before)) kept.push(before); // e.g. "Abstract" right above the paragraph
    return kept.concat(blocks.slice(first));
  }

  B.getBlocks = function () {
    const root = pickRoot();
    const blocks = [];

    collect(root).forEach((g) => {
      const el = g.el;
      const tag = el.tagName.toUpperCase();
      const isPre = tag === "PRE";
      const text = isPre ? g.parts.join("").replace(/\s+$/, "") : g.parts.join("").replace(/\s+/g, " ").trim();
      if (!text) return;
      if (FURNITURE.test(text) && text.length < 400) return;
      if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true })) return;

      let level = 0;
      if (HEADING.test(tag)) level = Number(tag[1]);
      else if ((el.getAttribute("role") || "").toLowerCase() === "heading") {
        level = Math.min(6, Math.max(1, Number(el.getAttribute("aria-level")) || 2));
      }
      if (level && text.length > 240) level = 0; // too long to be a real heading
      const heading = level > 0;

      if (!heading && !KEEP_SHORT.has(tag) && text.length < 25) return; // tiny fragments
      if (!heading && text.length < 160 && g.link / text.length > 0.8) return; // link-only lists

      const last = blocks[blocks.length - 1];
      if (last && last.text === text && last.isHeading === heading) return; // exact duplicate

      blocks.push({
        tag: heading ? "h" + level : isPre ? "pre" : tag === "LI" ? "li" : tag === "BLOCKQUOTE" ? "blockquote" : "p",
        isHeading: heading,
        level,
        text,
      });
    });

    const trimmed = trimLeadIn(blocks);
    if (trimmed.length && !trimmed.some((b) => b.level === 1)) {
      trimmed.unshift({ tag: "h1", isHeading: true, level: 1, text: document.title });
    }
    return trimmed;
  };
})();
