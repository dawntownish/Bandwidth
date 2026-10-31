// Read-aloud. Speaks one sentence at a time so the sentence being read can be highlighted.
//
// Two voice sources:
//   1) Your backend's /api/tts (a natural, neural voice). Only used if TTS_API_URL is set in backend/.env.
//   2) The browser's built-in voices. This is the fallback and needs no setup.
// If the backend voice isn't set up (or fails), it quietly uses the browser voice instead.
(function () {
  const B = (window.Bandwidth = window.Bandwidth || {});
  const synth = window.speechSynthesis;
  let run = 0;
  let audio = null;
  let cloud = "unknown"; // unknown | yes | no (reset every time you press Listen)

  // ===== CHANGE THE BROWSER VOICE HERE =====
  // Leave "" to let Bandwidth pick the most natural-sounding voice it can find.
  // Or type a voice name exactly, e.g. "Google UK English Female" or "Microsoft Neerja Online (Natural) - English (India)".
  // (To see the names your browser has, open the console on any page and run:
  //   speechSynthesis.getVoices().map(v => v.name)  )
  const PREFERRED_VOICE = "";

  // Higher score = sounds more natural. Chrome's "Google ..." voices and Edge's "(Natural)" voices are the best ones.
  function score(v) {
    let s = 0;
    if (/natural|neural/i.test(v.name)) s += 5;
    if (/online/i.test(v.name)) s += 3;
    if (/^google/i.test(v.name)) s += 3;
    if (/^en-(IN|GB|US)/i.test(v.lang)) s += 1;
    if (/^en-IN/i.test(v.lang)) s += 1;
    if (v.localService && !/natural|neural|google/i.test(v.name)) s -= 1; // old robotic offline voices
    return s;
  }

  function bestVoice() {
    if (!synth) return null;
    const all = synth.getVoices();
    if (PREFERRED_VOICE) {
      const named = all.find((v) => v.name === PREFERRED_VOICE);
      if (named) return named;
    }
    const english = all.filter((v) => /^en/i.test(v.lang));
    const pool = english.length ? english : all;
    let best = null, bestScore = -Infinity;
    pool.forEach((v) => { const sc = score(v); if (sc > bestScore) { best = v; bestScore = sc; } });
    return best;
  }

  function clipUrl(data) {
    try {
      const bin = atob(data.audio);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return URL.createObjectURL(new Blob([bytes], { type: data.mime || "audio/mpeg" }));
    } catch (e) { return null; }
  }

  B.speech = {
    supported: !!synth && typeof SpeechSynthesisUtterance !== "undefined",

    voices() {
      if (!synth) return [];
      const all = synth.getVoices();
      const english = all.filter((v) => /^en/i.test(v.lang));
      return english.length ? english : all;
    },

    // options: getRate(), getVoice(), onSentence(i), canContinue(i), onEnd()
    speak(sentences, o) {
      this.stop();
      const id = ++run;
      let i = 0;
      cloud = "unknown";
      const clips = {};

      // Ask the backend for the audio of sentence k (cached, so the next one can load while this one plays).
      const clip = (k) => {
        if (k >= sentences.length) return Promise.resolve(null);
        if (!clips[k]) {
          clips[k] = B.askAI("tts", { text: sentences[k] }).then((res) => {
            if (res && res.ok && res.data && res.data.audio) return clipUrl(res.data);
            if (k === i) cloud = "no"; // not set up / backend off: stop trying for this reading
            return null;
          });
        }
        return clips[k];
      };

      const browserSay = () => {
        if (!synth) { i++; next(); return; }
        const u = new SpeechSynthesisUtterance(sentences[i]);
        u.rate = o.getRate ? o.getRate() : 1;
        const name = o.getVoice ? o.getVoice() : "";
        const v = (name && synth.getVoices().find((x) => x.name === name)) || bestVoice();
        if (v) { u.voice = v; u.lang = v.lang; }
        u.onend = () => { if (id === run) { i++; next(); } };
        u.onerror = (e) => {
          if (id !== run) return;
          if (e.error === "canceled" || e.error === "interrupted") return;
          i++; next();
        };
        synth.speak(u);
      };

      const next = async () => {
        if (id !== run) return;
        if (i >= sentences.length) { if (o.onEnd) o.onEnd(); return; }
        if (i > 0 && o.canContinue && !o.canContinue(i)) { if (o.onEnd) o.onEnd(); return; } // Auto-play is off
        if (o.onSentence) o.onSentence(i);

        if (cloud !== "no") {
          const url = await clip(i);
          if (id !== run) { if (url) URL.revokeObjectURL(url); return; }
          if (url) {
            cloud = "yes";
            clip(i + 1); // load the next sentence while this one plays
            const a = new Audio(url);
            audio = a;
            a.playbackRate = o.getRate ? o.getRate() : 1;
            const done = (ok) => {
              URL.revokeObjectURL(url);
              if (id !== run) return;
              if (ok) { i++; next(); } else { cloud = "no"; browserSay(); } // blocked by the site? use the browser voice
            };
            a.onended = () => done(true);
            a.onerror = () => done(false);
            a.play().catch(() => done(false));
            return;
          }
        }
        browserSay();
      };
      next();
    },

    pause() { if (audio && !audio.paused) audio.pause(); else if (synth) synth.pause(); },
    resume() { if (audio && audio.paused && audio.currentTime > 0) audio.play(); else if (synth) synth.resume(); },
    stop() {
      run++;
      if (audio) { try { audio.pause(); } catch (e) { /* ignore */ } audio = null; }
      if (synth) synth.cancel();
    },
  };
})();
