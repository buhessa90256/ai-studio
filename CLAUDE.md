# AI Studio (phone) — notes for Claude

The phone version of AI Studio, published by GitHub Pages at https://buhessa90256.github.io/ai-studio/ from `main`
(every push goes live in about a minute). The owner uses it on an iPhone and often asks for changes from the phone,
so keep explanations short and in plain language: what changed, how to see it, nothing about code internals.

## What it is
- A single page, no build step: `index.html` (UI, styles, logic) + `workflows.js` (ComfyUI workflows, one function per
  tool, collected in `TOOLS`). `hymotion/` is a mannequin viewer, `voices/` default voices, `prompts.json` prompt ideas.
- It talks straight to a private **RunPod Serverless** endpoint (`5mginm1hj3ns0n`, ComfyUI worker) from the phone:
  `POST /run`, `GET /status/<id>`, `POST /cancel/<id>`, `GET /requests`, `GET /health` on `https://api.runpod.ai/v2/<endpoint>/`.
- The user's RunPod API key is saved only in the phone's browser (`localStorage` "apikey"; an old PIN-locked "vault" is
  unlocked once and converted). There is **no key in this repository** — never add one, never ask for it, never log it.
- Results are kept on the phone in IndexedDB ("ai-studio" / "items").
- **Studio** (bottom-nav tab, `studio/`): projects, characters, assets, storyboard, director, editor, workflows, queue, models, dashboard.
  It is the PC app's "Studio Pro" running entirely in the page, with everything stored in IndexedDB "studio-pro" on THIS device (never in the repo,
  never on a server). The screens (`studio/studio.js`, `storyboard.js`, `director.js`, `editor.js`, `flows.js`, `ops.js`) were written for the PC app's
  server and call `/api/studio/*`, `/api/generate`, `/api/status/<id>` ...; `studio/shim.js` overrides `fetch` for `/api/...` and answers from
  `studio/backend.js` (port of the PC's Python modules: assets, characters, projects, scenes, prompts, workflows, models, timeline, character board,
  last frame) and `studio/jobs.js` (RunPod jobs with the app's own `runpod()`, `TOOLS`, `fetchBig`; job log; finished jobs are attached to their scenes
  even if the screen is closed). `studio/export.js` makes the final MP4 in the browser (canvas + WebCodecs + OfflineAudioContext + the vendored
  `studio/vendor/mp4-muxer.js`, MIT, unmodified). Speech-to-text subtitles work here too (`studio/subtitles.js`: Whisper via transformers.js 3.8.1 + onnxruntime-web, vendored unmodified in
  `studio/vendor/transformers/`, wasm single-thread because GitHub Pages can't send COOP/COEP; models `Xenova/whisper-base|small` are downloaded from
  huggingface.co on first use and cached by the browser; the audio never leaves the device; tested: a generated voice line was transcribed exactly).
  Whisper invents words over music/noise, so the UI tells the user to read the subtitles. Face-similarity checks are PC-only (insightface). Character picker:
  the Edit image and Video + sound forms have a "Characters" field (`fillCharacters`, `buildParams` in `index.html`; board + description like the PC app).
  The PC app (private repo `ai-studio-pc`, folder `ai-studio-web/`) has copies of the same screens: **change `studio/*.js` here first and copy them to the PC
  app** (the PC copies differ only by `document.getElementById("studio-main") || document.querySelector("main")`).

- **Chat connector sync** (`studio/connector.js`): a link from the chat (`?connector=<address>/ro/<read-only token>`) is kept in localStorage; it copies characters, movies (as projects), frames, clips and final movies from the owner's connector into this device. Read-only; never put the address or token in the repo.

## Rules that matter
- `workflows.js` mirrors `workflows.py` of the PC version (not in this repo). Keep node ids, inputs and model file names
  exactly as they are unless asked; a wrong model name fails on the GPU, not here.
- When `workflows.js` changes, bump the `?v=` on `<script src="workflows.js?v=…">` in `index.html` so phones don't keep
  a cached copy.
- RunPod limits the app is built around:
  - A request body must stay under ~10 MB (the app checks before sending).
  - A result over ~20 MB comes back empty, so the worker returns `{type: "ai_saved", filename, size, parts}` instead and
    the app downloads it in ~6 MB pieces with the `fetch_result` workflow (`AIStudioFetchResult` node,
    `{job_id, file, part}`); `job_id: "*"` lists every result saved in the last 3 days ("Find missing results").
  - RunPod forgets a result 30 min after it finishes; a 404 on `/status` means "fetch the saved copy".
  - While a job runs, `/status` has `output.ai_progress` (`elapsed`, `value`/`max` steps, `node_type`, `tool`) — that
    drives the progress bar and time left (`estimate()` in `index.html`).
  - Every job is sent with `ai_tool: <tool name>` in its input.
- The GPU wakes from sleep in about 5 minutes and costs money while awake: don't add anything that runs jobs or keeps
  the GPU awake without the user pressing something.
- The RunPod account balance is read from an unlisted gist the PC app updates (`BALANCE_URL`); RunPod's own API blocks
  web pages.

## Testing
- Real jobs without putting the RunPod key in a page: run the PC app (`ai-studio-pc`), serve this folder (`python -m http.server 8800 --bind 127.0.0.1`),
  open http://localhost:8800/index.html, and in the browser console set `localStorage.dev_runpod_base = JSON.stringify("http://127.0.0.1:8765/rp")` and a
  placeholder `apikey` (any text). The PC server's dev-only `/rp/*` route then forwards to RunPod with its own key and answers only the origin
  localhost:8800. A real keyframe, a real sound and a real browser export were tested this way. Put throwaway test files in `_dev/` (git-ignored).
- (Older note) There is no key here, so you can't run real jobs. Check that the page loads with no script errors
  (`python -m http.server` and open it, or a headless browser) and test pure functions (e.g. `estimate`, `fmtLeft`)
  with sample data. With no key the page shows the setup screen — that is expected.
- Keep it working on a small iPhone screen (375 px wide) and in dark mode.

## Owner's preferences
- Plain, friendly wording in the UI; no technical terms.
- Ask before removing a feature; small, safe changes are fine.
