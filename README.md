# Bandwidth: setup

## Folders
- extension/  -> what Chrome loads
- backend/    -> the small local server that will talk to Meta's model

## Try the extension (no key needed)
1. Open chrome://extensions and turn on Developer mode.
2. Click "Load unpacked" and choose the `extension` folder (manifest.json must be directly inside).
3. Open any article and press F5. A small "Bandwidth" button appears at the bottom right.
4. Click it. Tabs: Clean (cleaned text, paragraph in the middle of the screen in focus), Cards (the same text in small cards),
   Listen (read aloud in either view) and Settings. Simplify sits on the same slim header, and Summary appears there only in Cards view.
   Prev / Next at the bottom move one paragraph (Clean) or one card (Cards).
   Flip the round switch (or press Esc) to go back to the original page.

## Pages on your own computer (file:// pages)
Chrome blocks extensions on local files until you allow it: chrome://extensions -> Bandwidth -> Details ->
turn on "Allow access to file URLs", then refresh the page.

## Where it can't run
chrome:// pages, the Chrome Web Store, and the built-in PDF viewer. That is a Chrome rule.
5. After editing code: press the reload icon on the extension's card, then refresh the page.

Colours and fonts live at the top of extension/panel.css.

## Run the backend (optional until you have the key)
1. Install Node (version 20.6 or newer). Check with: node -v
2. In the `backend` folder, copy `.env.example` to a new file named `.env`.
3. Run: npm start
Without a key, Summary and Simplify simply show "AI isn't set up yet."

## Settings, in plain words
- Auto-play: on = Listen keeps going paragraph to paragraph (or card to card). Off = it reads one paragraph or card, then stops. You can switch it while Listen is running and it takes effect at the end of the current paragraph or card.
- Animation follows your computer's own "reduce motion" setting. There is no separate switch.

## Voice (Listen)
- By default Bandwidth picks the most natural voice your browser has. Chrome's "Google ..." voices and Edge's "(Natural)" voices sound best; Edge usually has the best ones, and this extension loads in Edge the same way.
- To force a voice, type its name into PREFERRED_VOICE at the top of extension/content/speech.js.
- For an even more natural voice, fill in the TTS_ lines in backend/.env (any service with the "/v1/audio/speech" format). Leave them empty to skip it.

## Start at the article
Bandwidth skips page furniture (Wikipedia notices and "not to be confused with" lines, citation marks like [1], bylines, ads, cookie lines) and starts at the first real paragraph. This is done with plain rules, not AI, so it is instant and the text is never changed. Only Summary and Simplify use AI.

## Models
- AI: Meta Muse Glimmer 30B (open-weight, Apache 2.0), served through Routeway's free hosted API. Used for Summary and Simplify.
- The AI now WRITES new text for Summary and Simplify (your original text is never touched; it stays in Clean view). Plain code checks every answer before you see it: numbers must match, no invented names, "not/no/never" can't be added or dropped, the length must make sense, and a "summary" that just copies the card's sentences is rejected. The AI gets one retry; if it still fails, nothing invented is shown. These checks catch many mistakes but can't prove a rewrite means exactly the same, so it is always labelled "AI-generated".
- To use a different model or host, change the OPEN_ lines in `backend/.env` (Muse Spark Open, or any host with the "chat completions" format). Update OPEN_LABEL so the app names the model correctly.

## Set up the AI (free, no card)
1. Go to https://routeway.ai and sign in. Create an API key and copy it.
2. In the `backend` folder, copy `.env.example` to a new file named `.env`.
3. Paste the key after `OPEN_API_KEY=` (no quotes, no spaces). Save.
4. Double-click `backend/start-backend.bat` (or run `node server.js` in the backend folder). Keep that window open while you use the extension. Open http://localhost:3000/status in Chrome to check that the key is found.
5. Open an article, switch to Cards, press Summary. The terminal prints which model answered, or why it failed.
If you see: 401 = wrong key; model error = check OPEN_MODEL on the host's model page; rate limit = wait a minute.
Never put the key in the extension or on GitHub.

## How Summary and Simplify work
- Summary: a few short sentences, in easy words, about the card you are on (written in new words, not copied).
- Simplify: rewrites every card you have read so far. Light = only hard words swapped for easy ones. Medium = hard words swapped AND some sentences reworded. Full = rewritten completely in plain everyday language. Results are remembered (cache-v2.json).
- Everything shown in Summary and Simplify is AI-generated. A near-copy of the card is rejected and the AI is asked again; if the second try also fails, a note is shown instead of any text. Original card text is never used as a fallback.

## Optional reading aids (Settings)
All reading aids are off by default and are the reader's own choice.
- Bionic reading: bolds the first part of each word. Some readers like how it looks. The research on it is mixed, so it is offered as a preference, not a treatment.
- Pace 10s: when you arrive at a card going forward (Next, or opening Cards view), the Next button waits 10 seconds, with a visible countdown. Prev is never held and can be clicked any time; going back with Prev doesn't start a wait. Not applied while Listen is reading. Can be switched off at any time.
- Auto-play: Listen continues paragraph to paragraph, or stops after the current one.
