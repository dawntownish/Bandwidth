// The reading panel. Two views of the same text:
//   Clean = your article's text, cleaned, with the paragraph in the middle of the screen in focus.
//   Cards = the same text in small cards, one at a time.
// Summary (Cards view only) gives a short summary of the card you are on.
// Listen reads aloud in either view. To get back to the original page, flip the switch (or press Esc).
// Page text is always inserted as text nodes (never as HTML).
// The look lives in panel.css, so edit colours and shapes there.
(function () {
  const B = (window.Bandwidth = window.Bandwidth || {});
  const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
  const TIERS = [["light", "Light"], ["medium", "Medium"], ["full", "Full"]];
  const NS = "http://www.w3.org/2000/svg";

  let host = null, root = null;
  const els = {};
  const btns = {};
  let blockEls = [];
  let observer = null;
  const inBand = new Set();
  let buildToken = 0;
  let aiToken = 0;
  let speakItems = [];
  let speakingUnit = -1;
  let sentenceEls = [];
  let raf = 0;
  let lastScroll = 0;

  const state = {
    open: false,
    mode: "clean", // clean | cards
    blocks: [],
    cards: [],
    cardIndex: 0,
    keywords: new Set(),
    page: null,
    settings: B.defaultSettings(),
    settingsOpen: false,
    simplifyOpen: false,
    focusIndex: 0,
    listening: false,
    paused: false,
    tier: "medium",
    resultKind: "", // "summary" | "simplify"
  };

  // ---------- helpers ----------
  function h(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function button(label, onClick, cls) {
    const b = h("button", cls || "bw-btn", label);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  function setOn(btn, on) {
    if (!btn) return;
    btn.classList.toggle("bw-on", !!on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function svg(paths, size) {
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("width", size || 18);
    s.setAttribute("height", size || 18);
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", 2);
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    paths.forEach((d) => {
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", d);
      s.appendChild(p);
    });
    return s;
  }

  // Little four-petal flower for the logo.
  function logo() {
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 40 40");
    s.setAttribute("width", 28);
    s.setAttribute("height", 28);
    [0, 90, 180, 270].forEach((deg, i) => {
      const e = document.createElementNS(NS, "ellipse");
      e.setAttribute("cx", 20); e.setAttribute("cy", 10);
      e.setAttribute("rx", 5); e.setAttribute("ry", 9);
      e.setAttribute("transform", `rotate(${deg} 20 20)`);
      e.style.fill = i % 2 === 0 ? "var(--bw-ink)" : "var(--bw-sage)";
      s.appendChild(e);
    });
    return s;
  }

  // The round switch: knob slides, and shows an eye (focus) on one side, page lines on the other.
  function makeSwitch(onClick, cls) {
    const b = h("button", "bw-switch" + (cls ? " " + cls : ""));
    b.type = "button";
    b.setAttribute("role", "switch");
    b.setAttribute("aria-label", "Bandwidth reading view");
    b.setAttribute("aria-checked", "false");
    const eye = h("span", "bw-ico bw-ico-eye");
    eye.appendChild(svg(["M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"]));
    const page = h("span", "bw-ico bw-ico-page");
    page.appendChild(svg(["M5 7h14", "M5 12h14", "M5 17h9"]));
    b.append(h("span", "bw-knob"), eye, page);
    b.addEventListener("click", onClick);
    return b;
  }

  function setSwitch(b, on) {
    if (b) b.setAttribute("aria-checked", on ? "true" : "false");
  }

  // Adds text, wrapping keywords in <mark>. Plain stretches stay ONE text node (fast).
  function appendText(parent, text) {
    if (!state.keywords.size) { parent.appendChild(document.createTextNode(text)); return; }
    const pieces = text.split(/([\p{L}][\p{L}'’-]*)/u);
    let buffer = "";
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      if (i % 2 === 1 && state.keywords.has(piece.toLowerCase())) {
        if (buffer) { parent.appendChild(document.createTextNode(buffer)); buffer = ""; }
        parent.appendChild(h("mark", "bw-mark", piece));
      } else {
        buffer += piece;
      }
    }
    if (buffer) parent.appendChild(document.createTextNode(buffer));
  }

  function aiLabel(res, text) {
    return h("span", "bw-ai-label", `AI-generated${res && res.via ? " by " + res.via : ""}. ${text}`);
  }

  function messageFor(error) {
    const messages = {
      not_configured: "AI isn't set up yet.",
      not_implemented: "This feature isn't built yet.",
      backend_unreachable: "The backend isn't running.",
      too_short: "This part is short enough to read as it is.",
      rate_limited: "The free AI limit was reached for now. Wait a minute and try again.",
      unverified: "No summary shown: it couldn't be checked against the original text.",
    };
    return messages[error] || "Something went wrong, so nothing is shown.";
  }

  // ---------- settings (applied with CSS only, so nothing is rebuilt) ----------
  function change(key, value) {
    state.settings[key] = value;
    B.saveSettings(state.settings);
    applySettings();
  }

  function applySettings() {
    if (!els.app) return;
    const s = state.settings;
    els.app.classList.toggle("bw-night", !!s.night);
    els.app.classList.toggle("bw-roomy", !!s.roomy);
    els.app.classList.toggle("bw-nohl", !s.highlights);
    els.app.classList.toggle("bw-focus-on", !!s.focus && state.mode === "clean");
    els.app.style.setProperty("--bw-fs", 18 + s.fontStep * 2 + "px");
    ["focus", "highlights", "roomy", "night", "autoplay"].forEach((k) => setOn(btns[k], s[k]));
    setOn(btns.clean, state.mode === "clean");
    setOn(btns.cards, state.mode === "cards");
    setOn(btns.settings, state.settingsOpen);
    setOn(btns.listen, state.listening);
    setOn(btns.simplify, state.simplifyOpen);
    if (btns.speed) btns.speed.textContent = `Speed ${s.speed}x`;
    els.settingsCard.hidden = !state.settingsOpen;
    els.chips.hidden = !state.simplifyOpen;
    btns.pause.hidden = !state.listening;
    btns.summary.hidden = state.mode !== "cards"; // Summary only exists in Cards view
    btns.focus.hidden = state.mode === "cards"; // Focus only matters in Clean view
    btns.pause.textContent = state.paused ? "Resume" : "Pause";
    TIERS.forEach(([t]) => setOn(btns["tier_" + t], state.tier === t));
    if (state.settingsOpen || state.simplifyOpen) els.top.classList.remove("bw-top-hidden");
    updateProgress();
  }

  // ---------- build the panel once ----------
  function loadStyles() {
    const fallback = () => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = chrome.runtime.getURL("panel.css");
      root.appendChild(link);
      els.app.style.visibility = "visible";
    };
    try {
      chrome.runtime.sendMessage({ type: "BANDWIDTH_CSS" }, (res) => {
        void chrome.runtime.lastError;
        if (res && res.css && "adoptedStyleSheets" in root) {
          try {
            const sheet = new CSSStyleSheet(); // constructed sheets ignore the page's security rules
            sheet.replaceSync(res.css);
            root.adoptedStyleSheets = [sheet];
            els.app.style.visibility = "visible";
            return;
          } catch (e) { /* fall through */ }
        }
        fallback();
      });
    } catch (e) { fallback(); }
  }

  function mount() {
    if (host) return;
    host = document.createElement("div");
    host.id = "bandwidth-host";
    host.style.setProperty("all", "initial", "important"); // the page's CSS can't restyle our host
    root = host.attachShadow({ mode: "open" }); // keeps the page's CSS out of ours

    els.app = h("div", "bw-app");
    els.app.style.visibility = "hidden"; // shown once the stylesheet is in
    root.appendChild(els.app);
    document.documentElement.appendChild(host);
    loadStyles();

    els.launcher = makeSwitch(() => B.ui.toggle(), "bw-launcher");
    els.app.appendChild(els.launcher);

    els.wrap = h("div", "bw-wrap");
    els.wrap.hidden = true;
    els.app.appendChild(els.wrap);

    // thin reading-progress line
    const prog = h("div", "bw-progress");
    els.progressFill = h("div", "bw-progress-fill");
    prog.appendChild(els.progressFill);
    els.wrap.appendChild(prog);

    // reading area (full height; the header floats over it)
    els.content = h("div", "bw-content");
    els.col = h("div", "bw-column");
    els.content.appendChild(els.col);
    els.content.addEventListener("scroll", onScroll);
    els.col.addEventListener("click", (e) => {
      if (state.mode !== "clean") return;
      const block = e.target.closest && e.target.closest(".bw-block");
      if (!block) return;
      const i = Number(block.dataset.i);
      if (state.listening) listen(i); else setFocus(i);
    });
    els.wrap.appendChild(els.content);

    // --- slim header ---
    els.top = h("div", "bw-top");
    const nav = h("div", "bw-nav");
    const brand = h("div", "bw-brand");
    brand.append(logo(), h("span", null, "Bandwidth"));
    const tabs = h("div", "bw-tabs");
    btns.clean = button("Clean", () => setMode("clean"), "bw-tab");
    btns.cards = button("Cards", () => setMode("cards"), "bw-tab");
    btns.listen = button("Listen", () => (state.listening ? stopListening() : listenFromHere()), "bw-tab");
    btns.settings = button("Settings", () => { state.settingsOpen = !state.settingsOpen; applySettings(); }, "bw-tab");
    tabs.append(btns.clean, btns.cards, btns.listen, btns.settings);

    const tools = h("div", "bw-tools");
    btns.simplify = button("Simplify", () => { state.simplifyOpen = !state.simplifyOpen; applySettings(); }, "bw-btn bw-small bw-sage");
    btns.pause = button("Pause", togglePause, "bw-btn bw-small");
    btns.pause.hidden = true;
    btns.summary = button("Summary", runSummary, "bw-btn bw-small bw-primary");
    btns.summary.hidden = true;
    tools.append(btns.summary, btns.simplify, btns.pause);
    btns.navSwitch = makeSwitch(() => B.ui.toggle());
    nav.append(brand, tabs, h("span", "bw-spacer"), tools, btns.navSwitch);
    els.top.appendChild(nav);

    // pop-overs (float over the text, so the header stays slim)
    els.settingsCard = h("div", "bw-settings-card");
    els.settingsCard.hidden = true;
    els.settingsCard.append(
      button("A−", () => change("fontStep", Math.max(-2, state.settings.fontStep - 1)), "bw-btn bw-small"),
      button("A+", () => change("fontStep", Math.min(8, state.settings.fontStep + 1)), "bw-btn bw-small")
    );
    [["focus", "Focus"], ["highlights", "Highlights"], ["roomy", "Roomy spacing"], ["night", "Night"], ["autoplay", "Auto-play"]].forEach(
      ([key, label]) => {
        btns[key] = button(label, () => change(key, !state.settings[key]), "bw-btn bw-small");
        els.settingsCard.appendChild(btns[key]);
      }
    );
    btns.speed = button("Speed 1x", () => {
      const i = SPEEDS.indexOf(state.settings.speed);
      change("speed", SPEEDS[(i + 1) % SPEEDS.length]);
    }, "bw-btn bw-small");
    els.settingsCard.appendChild(btns.speed);
    els.top.appendChild(els.settingsCard);

    els.chips = h("div", "bw-chips");
    els.chips.hidden = true;
    TIERS.forEach(([t, label]) => {
      btns["tier_" + t] = button(label, () => { state.tier = t; applySettings(); runSimplify(); }, "bw-chip");
      els.chips.appendChild(btns["tier_" + t]);
    });
    els.top.appendChild(els.chips);
    els.wrap.appendChild(els.top);

    // AI result card + dock (Prev / Next only), floating
    els.resultPanel = h("div", "bw-result");
    els.resultPanel.hidden = true;
    els.wrap.appendChild(els.resultPanel);

    const dock = h("div", "bw-dock");
    dock.append(
      button("Prev", () => step(-1), "bw-btn bw-small bw-wide"),
      button("Next", () => step(1), "bw-btn bw-small bw-primary bw-wide")
    );
    els.wrap.appendChild(dock);

    els.wrap.addEventListener("mousemove", (e) => { if (e.clientY < 40) els.top.classList.remove("bw-top-hidden"); });
    window.addEventListener("keydown", (e) => {
      if (!state.open) return;
      if (e.key === "Escape") B.ui.toggle();
      else if (state.mode === "cards" && e.key === "ArrowRight") step(1);
      else if (state.mode === "cards" && e.key === "ArrowLeft") step(-1);
    });
    applySettings();
  }

  // header hides while you read down, and comes back when you scroll up
  function onScroll() {
    if (!raf) {
      raf = requestAnimationFrame(() => {
        raf = 0;
        updateProgress();
        const y = els.content.scrollTop;
        if (state.settingsOpen || state.simplifyOpen) { els.top.classList.remove("bw-top-hidden"); }
        else if (y > lastScroll + 8 && y > 120) els.top.classList.add("bw-top-hidden");
        else if (y < lastScroll - 8) els.top.classList.remove("bw-top-hidden");
        lastScroll = y;
      });
    }
  }

  function updateProgress() {
    if (!els.progressFill || !els.content) return;
    let pct = 0;
    if (state.mode === "cards" && state.cards.length) {
      pct = ((state.cardIndex + 1) / state.cards.length) * 100;
    } else {
      const max = els.content.scrollHeight - els.content.clientHeight;
      pct = max > 0 ? (els.content.scrollTop / max) * 100 : 0;
    }
    els.progressFill.style.width = Math.max(0, Math.min(100, pct)) + "%";
  }

  // ---------- modes ----------
  function setMode(mode) {
    if (mode === state.mode && state.open) return;
    stopListening();
    let target = 0;
    if (mode === "cards") {
      state.cardIndex = B.cardIndexForBlock(state.cards, state.focusIndex);
    } else if (state.cards[state.cardIndex]) {
      target = B.cardFirstBlock(state.cards[state.cardIndex]);
    }
    state.mode = mode;
    renderMode(target);
    applySettings();
  }

  function renderMode(startBlock) {
    if (observer) observer.disconnect();
    buildToken++;
    els.col.classList.toggle("bw-cards-mode", state.mode === "cards");
    els.content.scrollTop = 0;
    els.top.classList.remove("bw-top-hidden");
    lastScroll = 0;
    if (state.mode === "cards") showCard(state.cardIndex);
    else buildContent(startBlock || 0);
  }

  // ---------- Clean view ----------
  function makeBlockEl(b, i) {
    let el;
    if (b.isHeading) {
      el = h("h" + b.level, "bw-h bw-h" + Math.min(b.level, 4));
      el.appendChild(document.createTextNode(b.text));
    } else if (b.tag === "pre") {
      el = h("pre", "bw-pre");
      el.appendChild(document.createTextNode(b.text));
    } else {
      el = h(b.tag === "blockquote" ? "blockquote" : "div", b.tag === "li" ? "bw-li" : b.tag === "blockquote" ? "bw-quote" : "bw-p");
      appendText(el, b.text);
    }
    el.classList.add("bw-block");
    el.dataset.i = String(i);
    return el;
  }

  function emptyMessage() {
    return h("p", "bw-empty", "No readable text found here. Try scrolling the page once, then flip the switch again.");
  }

  function buildContent(startAt) {
    const token = buildToken;
    inBand.clear();
    els.col.textContent = "";
    blockEls = [];
    sentenceEls = [];

    if (state.page && state.page.words) {
      els.col.appendChild(h("div", "bw-pagestats",
        `${state.page.words} words · avg sentence ${state.page.avgSentenceLength} words · reading ease ${state.page.readingEase}`));
    }
    if (!state.blocks.length) { els.col.appendChild(emptyMessage()); return; }

    observer = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) inBand.add(e.target); else inBand.delete(e.target); });
      if (!state.listening) pickFocus();
    }, { root: els.content, rootMargin: "-40% 0px -40% 0px", threshold: 0 });

    let i = 0;
    const addUpTo = (limit) => {
      const frag = document.createDocumentFragment();
      const end = Math.min(limit, state.blocks.length);
      for (; i < end; i++) {
        const el = makeBlockEl(state.blocks[i], i);
        blockEls.push(el);
        frag.appendChild(el);
        observer.observe(el);
      }
      els.col.appendChild(frag);
    };

    // Build up to the starting point right away, then the rest in small batches (never freezes).
    addUpTo(Math.max(40, startAt + 20));
    const first = Math.min(startAt, blockEls.length - 1);
    setFocus(first);
    if (startAt > 0) scrollToBlock(first, true);
    (function batch() {
      if (token !== buildToken) return;
      if (i >= state.blocks.length) { updateProgress(); return; }
      addUpTo(i + 40);
      setTimeout(batch, 0);
    })();
  }

  function setFocus(i) {
    if (!blockEls[i]) return;
    const old = blockEls[state.focusIndex];
    if (old) old.classList.remove("bw-focused");
    state.focusIndex = i;
    blockEls[i].classList.add("bw-focused");
  }

  // Of the paragraphs crossing the middle band of the screen, focus the one nearest the centre.
  function pickFocus() {
    if (!inBand.size) return;
    const cr = els.content.getBoundingClientRect();
    const cy = cr.top + cr.height / 2;
    let best = -1, bestDist = Infinity;
    inBand.forEach((el) => {
      const r = el.getBoundingClientRect();
      const d = r.top > cy ? r.top - cy : r.bottom < cy ? cy - r.bottom : 0;
      const idx = Number(el.dataset.i);
      if (d < bestDist || (d === bestDist && idx < best)) { best = idx; bestDist = d; }
    });
    if (best >= 0 && best !== state.focusIndex) setFocus(best);
  }

  function scrollToBlock(i, instant) {
    const el = blockEls[i];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "center", behavior: instant || reduceMotion() ? "auto" : "smooth" });
  }

  // ---------- Cards view ----------
  function cardSentences(card) {
    const out = [];
    card.parts.forEach((p) => B.splitSentences(p).forEach((s) => { if (s.trim()) out.push(s.trim()); }));
    return out;
  }

  function showCard(i) {
    const card = state.cards[i];
    els.col.textContent = "";
    sentenceEls = [];
    if (!card) { els.col.appendChild(emptyMessage()); updateProgress(); return; }
    state.cardIndex = i;
    if (state.resultKind === "summary" && !els.resultPanel.hidden) { els.resultPanel.hidden = true; aiToken++; }

    const box = h("div", "bw-cardbox");
    box.appendChild(h("div", "bw-card-meta", `Card ${i + 1} of ${state.cards.length}`));
    if (card.heading) box.appendChild(h("h2", "bw-h bw-h2", card.heading));
    card.parts.forEach((p) => {
      const para = h("p", "bw-p");
      B.splitSentences(p).forEach((s) => {
        if (!s.trim()) return;
        const span = h("span", "bw-sent");
        appendText(span, s.trim());
        para.appendChild(span);
        para.appendChild(document.createTextNode(" "));
        sentenceEls.push(span);
      });
      box.appendChild(para);
    });
    els.col.appendChild(box);
    els.content.scrollTop = 0;
    updateProgress();
  }

  // Smooth scrolling unless the person's system asks for reduced motion.
  function reduceMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  // Prev / Next: one paragraph in Clean, one card in Cards (or jump the reading, if Listen is on).
  function step(delta) {
    if (state.mode === "cards") {
      const to = Math.max(0, Math.min(state.cards.length - 1, state.cardIndex + delta));
      if (state.listening) { listen(to); return; }
      showCard(to);
      return;
    }
    const from = state.listening && speakingUnit >= 0 ? speakingUnit : state.focusIndex;
    const to = Math.max(0, Math.min(blockEls.length - 1, from + delta));
    if (state.listening) { listen(to); return; }
    setFocus(to);
    scrollToBlock(to);
  }

  // ---------- listen (works in both views) ----------
  function sentencesOfBlock(b) {
    return b.isHeading ? [b.text] : B.splitSentences(b.text).map((s) => s.trim()).filter(Boolean);
  }

  // Clean view: wrap each sentence of a paragraph in a span (done only when reading reaches it).
  function ensureSentenceSpans(i) {
    const el = blockEls[i];
    if (!el || el.dataset.sents) return;
    const b = state.blocks[i];
    el.textContent = "";
    sentencesOfBlock(b).forEach((s, k, all) => {
      const span = h("span", "bw-sent");
      if (b.isHeading) span.appendChild(document.createTextNode(s)); else appendText(span, s);
      el.appendChild(span);
      if (k < all.length - 1) el.appendChild(document.createTextNode(" "));
    });
    el.dataset.sents = "1";
  }

  function clearSpeaking() {
    const scope = state.mode === "cards" ? els.col : blockEls[speakingUnit];
    if (scope) scope.querySelectorAll(".bw-speaking").forEach((s) => s.classList.remove("bw-speaking"));
  }

  function onSpeak(k) {
    const it = speakItems[k];
    if (!it) return;
    if (state.mode === "cards") {
      if (it.unit !== state.cardIndex) showCard(it.unit);
      speakingUnit = it.unit;
      sentenceEls.forEach((s, n) => s.classList.toggle("bw-speaking", n === it.sent));
      return;
    }
    if (it.unit !== speakingUnit) {
      clearSpeaking();
      speakingUnit = it.unit;
      ensureSentenceSpans(it.unit);
      setFocus(it.unit);
      scrollToBlock(it.unit);
    }
    blockEls[speakingUnit].querySelectorAll(".bw-sent").forEach((s, n) => s.classList.toggle("bw-speaking", n === it.sent));
  }

  function listenFromHere() {
    listen(state.mode === "cards" ? state.cardIndex : state.focusIndex);
  }

  function listen(startUnit) {
    if (!B.speech.supported) return;
    const cards = state.mode === "cards";
    const units = cards ? state.cards.length : state.blocks.length;
    if (!units) return;
    const last = units - 1; // queue to the end; Auto-play decides below whether to keep going
    const items = [];
    for (let u = startUnit; u <= last; u++) {
      if (cards) {
        cardSentences(state.cards[u]).forEach((text, sent) => items.push({ unit: u, sent, text }));
      } else {
        const b = state.blocks[u];
        if (!b || b.tag === "pre") continue;
        sentencesOfBlock(b).forEach((text, sent) => items.push({ unit: u, sent, text }));
      }
    }
    if (!items.length) return;
    speakItems = items;
    state.listening = true;
    state.paused = false;
    B.speech.speak(items.map((x) => x.text), {
      getRate: () => state.settings.speed,
      getVoice: () => state.settings.voice,
      onSentence: onSpeak,
      // Auto-play: moving on to the next paragraph/card is allowed only while it is switched on.
      // This is checked live, so toggling it mid-reading takes effect at the end of the current paragraph/card.
      canContinue: (idx) => state.settings.autoplay || items[idx].unit === startUnit,
      onEnd: stopListening,
    });
    applySettings();
  }

  function stopListening() {
    B.speech.stop();
    clearSpeaking();
    speakingUnit = -1;
    state.listening = false;
    state.paused = false;
    applySettings();
  }

  function togglePause() {
    if (!state.listening) return;
    if (state.paused) B.speech.resume(); else B.speech.pause();
    state.paused = !state.paused;
    applySettings();
  }

  // ---------- AI ----------
  // The part of the page the AI buttons work on: the card in Cards, the section you're in in Clean.
  function currentSection() {
    if (state.mode === "cards") {
      const c = state.cards[state.cardIndex];
      return { heading: c && c.heading ? c.heading : "", text: c ? c.text : "" };
    }
    const i = state.focusIndex;
    let start = i;
    while (start > 0 && !state.blocks[start].isHeading) start--;
    let end = start + 1;
    while (end < state.blocks.length && !state.blocks[end].isHeading) end++;
    const idx = [];
    for (let k = start; k < end; k++) {
      const b = state.blocks[k];
      if (!b.isHeading && b.tag !== "pre") idx.push(k);
    }
    const take = (from) => {
      const out = [];
      let words = 0;
      for (const k of idx) {
        if (k < from) continue;
        const w = state.blocks[k].text.split(/\s+/).length;
        if (words + w > 600 && out.length) break;
        out.push(state.blocks[k].text);
        words += w;
      }
      return out.join("\n");
    };
    const heading = state.blocks[start] && state.blocks[start].isHeading ? state.blocks[start].text : "";
    return { heading, text: take(idx.length ? idx[0] : 0) || take(i) };
  }

  // The whole page, cut into pieces of at most ~600 words, split at headings.
  function pageChunks() {
    const chunks = [];
    let heading = "";
    let part = [];
    let words = 0;
    const flush = () => { if (part.length) chunks.push({ heading, lines: part }); part = []; words = 0; };
    state.blocks.forEach((b) => {
      if (b.isHeading) { flush(); heading = b.text; return; }
      if (b.tag === "pre") return;
      const w = b.text.split(/\s+/).length;
      if (words + w > 600 && part.length) flush();
      part.push(b.text);
      words += w;
    });
    flush();
    return chunks;
  }

  function openResult(title, kind) {
    state.resultKind = kind || "";
    const panel = els.resultPanel;
    panel.hidden = false;
    panel.textContent = "";
    const head = h("div", "bw-result-head");
    head.appendChild(h("span", "bw-result-title", title));
    head.appendChild(button("Hide", () => { panel.hidden = true; aiToken++; }, "bw-btn bw-small"));
    panel.appendChild(head);
    const body = h("div", "bw-result-body");
    panel.appendChild(body);
    return body;
  }

  async function runSummary() {
    const token = ++aiToken;
    const { heading, text } = currentSection();
    const body = openResult(heading ? `Summary · ${heading}` : "Summary of this card", "summary");
    body.appendChild(h("p", "bw-note", "Working…"));
    const res = await B.askAI("summary", { text, tier: state.tier });
    if (token !== aiToken) return;
    body.textContent = "";
    if (!res.ok) { body.appendChild(h("p", "bw-note", messageFor(res.error))); return; }
    body.appendChild(aiLabel(res, "Every line is a sentence from the original."));
    res.data.lines.forEach((line) => body.appendChild(h("p", "bw-summary-line", line)));
  }

  // Simplify: summarise the whole page, section by section, at the chosen level.
  async function runSimplify() {
    const token = ++aiToken;
    const chunks = pageChunks();
    const label = TIERS.find(([t]) => t === state.tier)[1];
    const body = openResult(`Simplified page · ${label}`, "simplify");
    if (!chunks.length) { body.appendChild(h("p", "bw-note", "No readable text found on this page.")); return; }
    const status = h("p", "bw-note", "Working…");
    body.appendChild(status);
    let labelled = false;

    for (let n = 0; n < chunks.length; n++) {
      if (token !== aiToken) return;
      status.textContent = `Simplifying part ${n + 1} of ${chunks.length}…`;
      const c = chunks[n];
      const res = await B.askAI("summary", { text: c.lines.join("\n"), tier: state.tier });
      if (token !== aiToken) return;

      if (!res.ok && res.error !== "too_short" && res.error !== "unverified") {
        status.textContent = messageFor(res.error);
        return;
      }
      if (!labelled) {
        body.insertBefore(aiLabel(res, "Every line is a sentence from the original."), status);
        labelled = true;
      }
      if (c.heading) body.insertBefore(h("h3", "bw-result-h", c.heading), status);
      if (res.ok) {
        res.data.lines.forEach((line) => body.insertBefore(h("p", "bw-summary-line", line), status));
      } else if (res.error === "too_short") {
        c.lines.forEach((line) => body.insertBefore(h("p", "bw-summary-line", line), status)); // already short: shown as is
      } else {
        body.insertBefore(h("p", "bw-note", messageFor("unverified")), status);
      }
    }
    status.textContent = "Done.";
  }

  // ---------- public ----------
  B.ui = {
    init() {
      mount();
      B.loadSettings().then((saved) => {
        state.settings = saved;
        applySettings();
      });
    },
    toggle() {
      mount();
      state.open = !state.open;
      if (state.open) {
        state.blocks = B.getBlocks();
        state.cards = B.makeCards(state.blocks);
        state.keywords = B.findKeywords(state.blocks, 20);
        state.page = B.computeMetrics(state.blocks.map((b) => b.text).join(" "));
        state.focusIndex = 0;
        state.cardIndex = 0;
        state.mode = "clean";
        state.settingsOpen = false;
        state.simplifyOpen = false;
        els.resultPanel.hidden = true;
        els.wrap.hidden = false;
        els.launcher.hidden = true;
        setSwitch(btns.navSwitch, false); // then slide it on
        requestAnimationFrame(() => requestAnimationFrame(() => setSwitch(btns.navSwitch, true)));
        renderMode(0);
      } else {
        stopListening();
        buildToken++;
        aiToken++;
        if (observer) observer.disconnect();
        els.wrap.hidden = true;
        els.launcher.hidden = false;
      }
      applySettings();
    },
  };
})();
