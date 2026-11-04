const http = require("http");
const fs = require("fs");
const path = require("path");

const ENV_FILE = path.join(__dirname, ".env");
let envCache = { mtime: -1, vars: {} };
function fileVars() {
  try {
    const st = fs.statSync(ENV_FILE);
    if (st.mtimeMs !== envCache.mtime) {
      const vars = {};
      fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/).forEach((line) => {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (!m || line.trim().startsWith("#")) return;
        vars[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
      });
      envCache = { mtime: st.mtimeMs, vars };
    }
  } catch (e) { envCache = { mtime: -1, vars: {} }; }
  return envCache.vars;
}

const ENV = new Proxy({}, {
  get: (_, k) => { const v = fileVars()[k]; return v !== undefined && v !== "" ? v : process.env[k]; },
});

const PORT = ENV.PORT || 3000;

const PROVIDERS = {

  get spark() { return {
    label: "Muse Spark",
    url: ENV.META_API_URL || "",
    key: ENV.META_API_KEY || "",
    model: ENV.META_MODEL || "",
  }; },

  get open() { return {
    label: ENV.OPEN_LABEL || "Meta Muse Glimmer 30B (open-weight)",
    url: ENV.OPEN_API_URL || "https://api.routeway.ai/v1/chat/completions",
    key: ENV.OPEN_API_KEY || "",
    model: ENV.OPEN_MODEL || "muse-glimmer-30b:free",
  }; },
};

const TASK_PROVIDER = { summary: "open", simplify: "open", complexity: "spark", chemistry: "spark" };

function configured(p) { return !!(p.key && p.url && p.model); }

async function callModel(prompt, task) {
  const first = TASK_PROVIDER[task] || "spark";
  const second = first === "spark" ? "open" : "spark";
  const name = configured(PROVIDERS[first]) ? first : configured(PROVIDERS[second]) ? second : null;
  if (!name) return { ok: false, error: "not_configured" };
  const p = PROVIDERS[name];
  console.log(`[${task}] using ${p.label}`);

  try {

    const body = {
      model: p.model,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    };

    if (name === "open" && ENV.OPEN_REASONING_EFFORT) body.reasoning_effort = ENV.OPEN_REASONING_EFFORT;
    if (name === "open") body.max_tokens = Number(ENV.OPEN_MAX_TOKENS) || 4000;
    const started = Date.now();
    const limit = (Number(ENV.OPEN_TIMEOUT_SECONDS) || 300) * 1000;
    const send = () => fetch(p.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(limit),
    });
    let res = await send();
    if (res.status === 400 && body.reasoning_effort) {
      delete body.reasoning_effort;
      res = await send();
    }
    for (let tries = 0; res.status === 429 && tries < 2; tries++) {
      await new Promise((r) => setTimeout(r, 3000 * (tries + 1)));
      res = await send();
    }
    if (res.status === 429) return { ok: false, error: "rate_limited" };
    if (!res.ok) {

      const detail = (await res.text()).slice(0, 400);
      console.error(`${p.label} error ${res.status}: ${detail}`);
      return { ok: false, error: "model_error" };
    }
    const json = await res.json();
    const msg = json && json.choices && json.choices[0] && json.choices[0].message;
    let text = msg ? msg.content : null;

    if ((typeof text !== "string" || !text.trim()) && msg) text = msg.reasoning_content || msg.reasoning || "";
    if (typeof text !== "string") return { ok: false, error: "model_error" };
    if (!text.trim()) console.error(`[${task}] the model sent back an empty answer (it may have run out of thinking room)`);
    console.log(`[${task}] answered in ${((Date.now() - started) / 1000).toFixed(1)}s`);

    return { ok: true, text: text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim(), via: p.label };
  } catch (err) {
    if (err && (err.name === "TimeoutError" || err.name === "AbortError")) {
      console.error(`[${task}] the model took too long, so it was skipped`);
      return { ok: false, error: "timeout" };
    }
    console.error(`Could not reach ${p.label}:`, err.message);
    return { ok: false, error: "model_error" };
  }
}

function parseJson(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(clean);
  } catch (err) {

    const a = clean.indexOf("{"), b = clean.lastIndexOf("}");
    if (a !== -1 && b > a) { try { return JSON.parse(clean.slice(a, b + 1)); } catch (e) {  } }
    return null;
  }
}

const crypto = require("crypto");
const { checkSummary, checkSimplified, wordCount } = require("./verify");

const CACHE_FILE = path.join(__dirname, "cache-v2.json");
let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); } catch (e) { cache = {}; }
function saveCache() {
  const keys = Object.keys(cache);
  if (keys.length > 400) keys.slice(0, keys.length - 400).forEach((k) => delete cache[k]);
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); } catch (e) {  }
}
const hash = (s) => crypto.createHash("sha1").update(s).digest("hex");



const COMMON_RULES =
  `- Use ONLY what the text says. Do not add facts, examples, numbers, names or explanations from your own knowledge.\n` +
  `- Keep every number exactly. Keep names and technical terms that have no everyday word.\n` +
  `- Do not change the meaning. Keep "not", "no", "never" wherever the text has them.\n`;

const TIER_RULES = {
  light:
    `LIGHT simplification. Keep the text almost exactly as it is: same sentences, same order, same length. ` +
    `ONLY replace big, rare, long or formal words with simple everyday words (for example "utilise" -> "use", "commence" -> "start"). ` +
    `Do not split, merge, shorten or restructure sentences. But you MUST swap the hard words; never give the text back unchanged.`,
  medium:
    `MEDIUM simplification. Replace hard words with easy ones AND reword some of the text: shorten long sentences, split very long ones, ` +
    `turn passive sentences into active ones, and swap hard phrases for plain ones. Keep the same information in the same order. ` +
    `Roughly the same length as the original.`,
  full:
    `FULL simplification. Rewrite the whole text completely in plain, normal everyday language, the way you would explain it to a friend. ` +
    `Short sentences, common words, no jargon, no long or formal phrasing. Keep all the information, in the same order.`,
};

function readList(text, key, splitter) {
  const j = parseJson(text);
  let arr = null;
  if (j && Array.isArray(j[key])) arr = j[key];
  else if (j && typeof j[key] === "string") arr = [j[key]];
  else if (!j && !/[{}]/.test(text)) arr = text.split(splitter);
  if (!arr) return null;
  return arr
    .map((x) => (typeof x === "string" ? x.replace(/^[-*\u2022]\s+/, "").trim() : ""))
    .filter((x) => x && !/^(here('s| is| are)|sure|okay|certainly)\b[^]*:$/i.test(x));
}

async function generate(task, buildPrompt, read, check) {
  let note = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await callModel(buildPrompt(note), task);
    if (!out.ok) {
      return { ok: false, error: out.error };
    }
    const items = read(out.text);
    if (!items || !items.length) {
      console.error(`[${task}] couldn't read the model's answer: ${String(out.text).slice(0, 160)}`);
      note = `\n\nYour last answer could not be read. Reply with ONLY the JSON, nothing else.`;
      continue;
    }
    const problem = check(items);
    if (!problem) return { ok: true, items, via: out.via };
    console.error(`[${task}] rejected: ${problem}`);
    note = `\n\nYour last answer was rejected because ${problem}. Write it again and fix that.`;
  }
  return { ok: false, error: "unverified" };
}

async function summary({ heading, text }) {
  if (typeof text !== "string" || !text.trim()) return { ok: false, error: "bad_request" };
  if (wordCount(text) < 25) return { ok: false, error: "too_short" };
  const head = typeof heading === "string" ? heading.trim() : "";
  const key = "summary|" + hash(head + "\n" + text);
  if (cache[key]) return { ok: true, data: { lines: cache[key].lines }, via: cache[key].via, cached: true };

  const prompt = (note) =>
    `Write a short summary of the text below in very easy language, for a reader who finds dense text tiring.\n` +
    `- 1 to 3 short sentences. It must be MUCH shorter than the text.\n` +
    `- Everyday words and short sentences. Explain the main point; do not list details.\n` +
    `- Write it in your OWN words. Do not copy sentences from the text.\n` +
    COMMON_RULES +
    `- Reply with ONLY JSON like {"summary": ["First sentence.", "Second sentence."]}\n\n` +
    (head ? `Heading: ${head}\n` : "") + `Text:\n${text}` + note;

  const res = await generate("summary", prompt, (t) => readList(t, "summary", /\n+/), (lines) => checkSummary(head + "\n" + text, lines));
  if (!res.ok) return res;
  cache[key] = { lines: res.items, via: res.via };
  saveCache();
  return { ok: true, data: { lines: res.items }, via: res.via };
}

async function simplify({ text, tier }) {
  if (typeof text !== "string" || !text.trim()) return { ok: false, error: "bad_request" };
  if (!TIER_RULES[tier]) tier = "medium";
  if (wordCount(text) < 4) return { ok: false, error: "too_short" };
  const key = `simplify|${tier}|` + hash(text);
  if (cache[key]) return { ok: true, data: { paragraphs: cache[key].paragraphs }, via: cache[key].via, cached: true };

  const count = text.split("\n").filter((x) => x.trim()).length;
  const prompt = (note) =>
    `Rewrite the text below so it is easier to read.\n${TIER_RULES[tier]}\n` +
    COMMON_RULES +
    `- The text has ${count} paragraph${count === 1 ? "" : "s"}. Give back ${count} paragraph${count === 1 ? "" : "s"}.\n` +
    `- Reply with ONLY JSON like {"paragraphs": ["First paragraph.", "Second paragraph."]}\n\n` +
    `Text:\n${text}` + note;

  const res = await generate("simplify", prompt, (t) => readList(t, "paragraphs", /\n\s*\n|\n/), (ps) => checkSimplified(text, ps, tier));
  if (!res.ok) return res;
  cache[key] = { paragraphs: res.items, via: res.via };
  saveCache();
  return { ok: true, data: { paragraphs: res.items }, via: res.via };
}

async function complexity() { return { ok: false, error: "not_implemented" }; }
async function chemistry() { return { ok: false, error: "not_implemented" }; }

const TTS = {
  get url() { return ENV.TTS_API_URL || ""; },
  get key() { return ENV.TTS_API_KEY || ""; },
  get model() { return ENV.TTS_MODEL || ""; },
  get voice() { return ENV.TTS_VOICE || ""; },
};

async function tts({ text }) {
  if (!TTS.url) return { ok: false, error: "not_configured" };
  if (typeof text !== "string" || !text.trim() || text.length > 1500) return { ok: false, error: "bad_request" };
  try {
    const headers = { "Content-Type": "application/json" };
    if (TTS.key) headers.Authorization = `Bearer ${TTS.key}`;
    const res = await fetch(TTS.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: TTS.model, input: text, voice: TTS.voice, response_format: "mp3" }),
    });
    if (!res.ok) {
      console.error(`Voice service error ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return { ok: false, error: "model_error" };
    }
    const audio = Buffer.from(await res.arrayBuffer()).toString("base64");
    return { ok: true, data: { audio, mime: "audio/mpeg" } };
  } catch (err) {
    console.error("Could not reach the voice service:", err.message);
    return { ok: false, error: "model_error" };
  }
}

const handlers = { summary, simplify, tts, complexity, chemistry };

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 500000) { reject(new Error("too large")); req.destroy(); }
    });
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function statusPage() {
  const o = PROVIDERS.open;
  const rows = [
    ["Backend", "running"],
    [".env file found", fs.existsSync(ENV_FILE) ? "yes" : "NO  (looked at: " + ENV_FILE + ")"],
    ["AI key found", o.key ? "yes (" + o.key.length + " characters, hidden)" : "NO  (OPEN_API_KEY is empty or missing)"],
    ["Model", o.model],
    ["Host", o.url],
    ["Shown in app as", o.label],
    ["Ready for Summary", configured(o) ? "YES" : "NO"],
  ];
  return "<!doctype html><meta charset=utf-8><title>Bandwidth backend</title><body style=\"font:18px system-ui;margin:40px\"><h2>Bandwidth backend</h2><table cellpadding=8>" +
    rows.map(([a, b]) => `<tr><td><b>${a}</b></td><td>${String(b).replace(/</g, "&lt;")}</td></tr>`).join("") + "</table>";
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/status" || req.url === "/")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(statusPage());
  }
  const task = req.url.startsWith("/api/") ? req.url.slice(5) : null;
  if (req.method !== "POST" || !handlers[task]) return send(res, 404, { ok: false, error: "not_found" });
  let body;
  try { body = await readJson(req); } catch (e) { return send(res, 400, { ok: false, error: "bad_request" }); }
  try { send(res, 200, await handlers[task](body)); }
  catch (e) { console.error(e); send(res, 500, { ok: false, error: "server_error" }); }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\nPort ${PORT} is busy: an older copy of the backend is still running.\nClose its window, or double-click start-backend.bat, which stops old copies first.`);
  } else console.error(err);
  process.exit(1);
});
server.listen(PORT, "127.0.0.1", () => {
  const o = PROVIDERS.open;
  console.log(`Backend on http://localhost:${PORT}`);
  console.log(`  .env found: ${fs.existsSync(ENV_FILE) ? "yes" : "NO"} | AI key: ${o.key ? "found" : "MISSING"} | model: ${o.model}`);
  console.log(`  Check it any time: http://localhost:${PORT}/status`);
});
