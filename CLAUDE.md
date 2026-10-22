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

## Interface v2 (2026-10, default)
Four sections (Home, Projects, Library, Settings) instead of the old Create/Studio/Results/Settings + 10 Studio tabs. Files in `studio/`: `ds.css` (design system: dark charcoal + violet, `html[data-ui="v2"]`),
`app.js` (shared state `window.APP`: selection, cached data, GPU/credit classification running/idle/starting/asleep/unavailable, toasts/sheets, scene status rules `APP.sceneInfo`),
`shell.js` (nav + hash routes `#/home #/projects/<id>/<mode>/<sceneId>[/review] #/library/<filter> #/settings/<section> #/create`), `home.js`, `projects.js` (project list + workspace: scene rail / preview /
properties; modes Storyboard + Director native, Editor + Automation = the old `editor.js` / `flows.js` / queue screens mounted inside the workspace through `SP.use.editor/flows`), `review.js` (frame review: zoom, versions, compare,
automatic checks incl. a browser collage/split-screen detector `APP.collageScan`, approve/reject/regenerate; chat frames use `APP.chatAct` with the connector's action link), `library.js`, `settings2.js`.
The old screens and all data code are unchanged underneath. **Rollback:** `?ui=classic` (remembered) restores the old interface, `?ui=v2` returns. Nothing paid ever starts by itself: every GPU step has its own button + cost confirmation.
Start frames made in the app use separate reference pictures + the single-frame prompt (`storyboard.js makeKeyframe`, mirrors the connector's `framegen.py`), are checked for collage/wrong shape before they can be approved, and retried up to 3 times.
Testing the app without a RunPod key: `localStorage.apikey = JSON.stringify("x")`, `localStorage.dev_runpod_base = JSON.stringify("http://127.0.0.1:8099")` and run `connector/dev_fake_runpod.py` (fake GPU, CORS open; `FAKE_KEY_MODE=collage_then_ok` exercises the retry).

## AI Director (2026-10, inside every project: Projects -> project -> "AI Director" (default) / "Manual Editor")
Chat agent that runs a whole movie: story -> storyboard contact sheet -> characters -> first two start frames -> remaining frames -> video (after cost authorization) -> assembly -> final MP4. All in the browser, state per project in IndexedDB `kv` key `director:<project id>` (survives reload; a running paid job's id is saved BEFORE it is waited for, so reconnecting never submits it twice).
Files: `studio/dir_core.js` (state machine with the 18 states, persistence, budget gate + ledger of every job booked to a stage, resumable `jobAsset`, storyboard sheet = 16 small `qwen_image` panels composed on a canvas with numbers/titles, optional Anthropic LLM), `studio/dir_stages.js` (characters, frames via `SP.sb.frame` = the same separate-reference + collage-check pipeline, videos via `SP.sb.video` + browser clip checks, assembly = timeline + 0.5 s crossfades + optional music + export + size check, TOOL REGISTRY `DIR.tools` with permission classes read/write/paid/approval and input validation, chat agent), `studio/dir_ui.js` + `dir.css` (chat, real media with failure notice, buttons tied to versions, settings sheet). `projects.js` mounts one chat node per project (full size in AI mode, collapsible dock in Manual mode).
Rules: approval tools (`approve_*`, `authorize_videos`) can only run from a button or the user's own typed "approve"/"authorize" (never from the LLM); each approval records the exact version/asset and a regenerated asset needs a new one; paid stages are gated by budgets (project $8, storyboard $1.50, characters $1, frames $3 by default, videos = the amount authorized); one engine at a time (Web Lock across tabs); pause stops NEW work (running GPU jobs finish). Editing scene N after approvals only redoes that scene's panel/frame/clip (old versions kept).
Orchestration model: none required. Without an AI key a rule-based interpreter calls the same tools and the story is a template; with an Anthropic key (chat gear -> AI key, stored only in this browser as `dir_llm_key`, default model claude-haiku-5-5) the story is written by the model and chat is a real tool-calling loop (tested only with a stubbed API, not with a real key).
NOT built / limits: no face-similarity measurement in the browser (PC/connector only); clip checks = shape, length, sampled-frame cuts only; dialogue/sfx are not generated automatically (only music); model choice is fixed (qwen_image, qwen_edit, MiniMax-H3, Stable Audio); the chat agent is separate from the MCP connector (chat-made movies are still synced read-only by `connector.js`). Tested with the fake RunPod (`connector/dev_fake_runpod.py`), not with a paid 16-scene run.

## Mobile UI (2026-10)
Projects open in **Manual Editor** by default; AI Director is optional and the choice is remembered per project (`localStorage` `ws_mode:<id>` = manual|ai, `ws_sec:<id>` last section, `ws_sub:<id>:<section>`). `#/projects/<id>` with no section uses the remembered one; first time = Manual Editor / Storyboard. Sections: Storyboard (gallery), Scenes (the old scene editor), Characters, Videos (Clips | Editor), Settings (Look | Workflows | Queue); old links `director/editor/automation` map onto them. Files: `studio/mobile.css` (compact header, mode switch, scrollable tabs, progress strip, gallery grid 2/3/4 columns, viewer, fixed action bar above the bottom nav with safe-area padding, chat/keyboard rules, landscape), `studio/gallery.js` (`APP.lazyThumb`/`APP.thumbUrl`: small cached thumbnails in IndexedDB `kv` `thumb:<asset>:360`; `APP.viewer`: full-screen viewer with the ORIGINAL image, pinch, double-tap, pan, swipe, download/share, back-button closes it; `visualViewport` -> `--vvh` and `html.kbd` so the chat input stays above the keyboard), `projects.js` (workspace chrome, sections, redraw only when the visible data changed, polling 5 s while jobs run / 15 s otherwise, paused when the tab is hidden), `app.js` (failed scenes read "Needs fix"). Rules: every control >= 44x44 on phones, nothing wider than the screen, inputs 16px (no iOS zoom), bottom UI uses `--navfull`/safe-area, the page keeps bottom padding under the action bar.
**Regression test**: `tests/mobile_ui_check.js` (run in the page, instructions at its top; creates and removes a throw-away project, never generates anything). Run it at 320, 360, 390, 430, 768, 1024 and landscape 640x360; all passed at the last release. Pinch/swipe were tested with synthetic pointer events, not on a physical Android/iPhone.

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

## Approve All Frames + Cancel Everything (2026-10-22)
Both repos have both buttons (one file, `bulk.js`, shared). **`ai-studio-mobile/studio/bulk.js` is the source of truth; copy it to `ai-studio-web/bulk.js`** (the PC server must list it in its static whitelist: done).
- Phone app: the bar sits above the gallery in Projects -> Manual Editor -> Storyboard (`projects.js galleryMode` calls `BULK.bar`); Cancel everything is also in Settings -> GPU workers. PC app: same bar above the scene cards of the Storyboard screen (`storyboard.js draw`).
- Approve all frames: ready = frame exists, not approved/rejected, nothing running, no automatic flag, and for chat (connector) frames the identity check is `pass`. Failed/uncertain identity, rejected and flagged frames are only listed for a manual look. One confirmation with the cost estimate, then local scenes are approved (`review: approved`) and their videos started through the app's own queue (`SP.sb.video`); chat scenes go to the connector as ONE batch (`/act/<token>/approve_all`). Idempotent: key per confirmation, record stored in localStorage `bulk:<project>:<key>` BEFORE anything starts, same key = replay, already approved/running/with video = skipped, a replaced frame = skipped (`frame_changed`), Retry sends only the unsuccessful scenes under a new key.
- Cancel everything: phone app = pause AI Director, cancel every job `GET /requests` lists (this device, other apps, everything), `purge-queue`, and the connector's `cancel_all` when the actions link exists. PC app = server `GET/POST /api/cancel_all` (same, with the server's key; POST needs `{"confirm": true}`).
- **Delete projects** (`BULK.deleteProjects`, same `bulk.js`): "Delete projects…" in the phone app's Projects list header, "Delete several…" in the PC app's Projects screen (`studio.js`, shared). Multi-select with Select all / none, a second confirmation that names the count ("Delete ALL n projects?" when everything is picked), a warning when scenes are still running on the GPU (deleting a project does NOT stop the GPU: use Cancel everything), then the same RECOVERABLE soft delete as the single "Delete project" (`projects/<id>/delete`, restore from Recently deleted / Deleted). It never deletes pictures, videos, characters or the chat connector's movies. Covered by `tests/bulk_check.js` section 6 (only ever ticks its own throw-away projects).
- Tests (none can reach the GPU): `ai-studio-mobile/tests/bulk_check.js` (in-page, 53 checks, run at 320/390/1024; stubs SP.sb.video, runpod() and the connector fetch, see its header) next to `tests/mobile_ui_check.js`; `ai-studio-web/tests/test_cancel_all_pc.py` (real handler, fake runpod); connector: `connector/tests/test_approve_all.py`, `test_cancel_all.py` (+ `dev_server.py` local copy with a pretend RunPod).
- RunPod facts learned (important): `GET /v2/<endpoint>/requests` lists EVERY waiting/running/finished request with ids (so unknown jobs can be cancelled); cancelling a connector movie used to leave its RunPod jobs running and billing (fixed in `cancel_movie`); the connector's cost counters only count productive GPU seconds, RunPod bills worker time (cold start, idle tail, lost/hung jobs): ~$22/day was billed against ~$1-2 recorded. Endpoint settings changed on 2026-10-22: `idleTimeout` 600 -> 90 s, `executionTimeoutMs` 2 h -> 15 min, `workersMax` 3 -> 2 (a clip normally takes 5-8 min; a job over 15 min is killed and retried).
