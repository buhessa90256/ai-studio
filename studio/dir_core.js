// AI Director, engine: a durable production state machine + a tool registry + (optional) language-model orchestration, all in the browser.
// State of every project lives in IndexedDB ("kv", key director:<project id>) so a reload / closed tab / lost connection resumes exactly where it stopped.
// Paid GPU jobs are recorded in that state BEFORE they are waited for, so reconnecting re-attaches to the running job and never submits it twice.
// Nothing here talks to RunPod by itself except through the same /api/generate the manual screens use.
"use strict";
(() => {
  if (!window.AppShell || !window.AppShell.v2) return;
  const wait = setInterval(() => { if (window.APP && APP.go && window.SP && SP.sb && window.StudioBackend && window.SDB) { clearInterval(wait); init(); } }, 80);
  function init() {
    const B = StudioBackend, D = SDB, api = APP.api, sleep = ms => new Promise(r => setTimeout(r, ms));
    const DIR = window.DIR = { tools: {}, ui: new Set(), ctx: null, running: new Map() };

    // ------------------------------------------------------------------ states
    const WAITING = new Set(["STORYBOARD_AWAITING_APPROVAL", "CHARACTERS_AWAITING_APPROVAL", "FIRST_TWO_FRAMES_AWAITING_APPROVAL", "FRAMES_AWAITING_APPROVAL", "VIDEO_AWAITING_AUTHORIZATION", "VIDEO_REVIEW", "FINAL_REVIEW"]);
    const IDLE = new Set(["DRAFT", "FAILED", "CANCELLED", "COMPLETED"]);
    DIR.STATES = ["DRAFT", "STORYBOARD_GENERATING", "STORYBOARD_AWAITING_APPROVAL", "CHARACTERS_CHECKING", "CHARACTERS_GENERATING", "CHARACTERS_AWAITING_APPROVAL", "FIRST_TWO_FRAMES_GENERATING", "FIRST_TWO_FRAMES_AWAITING_APPROVAL", "REMAINING_FRAMES_GENERATING", "FRAMES_AWAITING_APPROVAL", "VIDEO_AWAITING_AUTHORIZATION", "VIDEO_GENERATING", "VIDEO_REVIEW", "ASSEMBLING", "FINAL_REVIEW", "COMPLETED", "FAILED", "CANCELLED"];
    DIR.WAITING = WAITING; DIR.IDLE = IDLE;
    const COST = { qwen_image: 0.05, qwen_edit: 0.07, minimax_h3: 0.20, stable_audio: 0.04 };   // conservative per-job estimates (the real cost replaces them once the job is billed)
    const clipEst = sc => APP.estimate(sc, "clip");
    const fresh = () => ({ v: 1, state: "DRAFT", paused: false, halted: null, msgs: [], brief: null, story: null, sb: { versions: [], cur: 0 }, newChars: {}, approvals: [], pending: {}, auth: null, errors: [], clipChecks: {}, finalAsset: "", spend: { total: 0, stage: {}, jobs: [] },
      cfg: { maxConcurrent: 2, maxRetries: 2, budget: { project: 8, storyboard: 1.5, characters: 1, frames: 3, videos: 0, audio: 0.5 } } });

    // ------------------------------------------------------------------ persistent store (serialised writes, cross-tab refresh)
    const mem = new Map(), queues = new Map(), KEY = pid => "director:" + pid;
    const bc = (() => { try { return new BroadcastChannel("ai-studio-director"); } catch { return null; } })();
    const emit = (pid, kind = "state") => { for (const f of DIR.ui) try { f(pid, kind); } catch {} };
    if (bc) bc.onmessage = e => { if (e.data && e.data.pid) { mem.delete(e.data.pid); emit(e.data.pid); } };
    async function load(pid) {
      if (mem.has(pid)) return mem.get(pid);
      const r = await D.get("kv", KEY(pid)), s = r ? r.value : fresh(), f = fresh();
      for (const k of Object.keys(f)) if (!(k in s)) s[k] = f[k];
      s.cfg = { ...f.cfg, ...s.cfg, budget: { ...f.cfg.budget, ...(s.cfg.budget || {}) } };
      mem.set(pid, s); return s;
    }
    function mutate(pid, fn) {
      const next = (queues.get(pid) || Promise.resolve()).then(async () => { const s = await load(pid); const r = await fn(s); recompute(s); await D.put("kv", { key: KEY(pid), value: s }); if (bc) bc.postMessage({ pid }); emit(pid); return r; });
      queues.set(pid, next.catch(() => {})); return next;
    }
    const get = pid => load(pid);
    const say = (pid, m) => { const id = D.uid(); return mutate(pid, s => { s.msgs.push({ id, ts: Date.now(), role: "agent", ...m }); if (s.msgs.length > 400) s.msgs.splice(0, s.msgs.length - 400); return id; }); };
    const userSay = (pid, text, media) => mutate(pid, s => { s.msgs.push({ id: D.uid(), ts: Date.now(), role: "user", type: "text", text, media: media || [] }); });
    const patchMsg = (pid, id, p) => mutate(pid, s => { const m = s.msgs.find(x => x.id === id); if (m) Object.assign(m, p); });
    const setState = (pid, st) => mutate(pid, s => { s.state = st; s.halted = null; });
    const logErr = (pid, e, where) => mutate(pid, s => { s.errors.push({ at: Date.now(), where, error: String((e && e.message) || e).slice(0, 300) }); s.errors = s.errors.slice(-40); });
    Object.assign(DIR, { get, mutate, say, userSay, patchMsg, load });

    // ------------------------------------------------------------------ money
    function recompute(s) {
      const st = {}; let tot = 0;
      for (const j of s.spend.jobs) { const c = j.cost != null ? j.cost : (j.est || 0); st[j.stage] = (st[j.stage] || 0) + c; tot += c; }
      s.spend.stage = st; s.spend.total = tot;
    }
    async function settle(pid) {
      const s = await load(pid), open = s.spend.jobs.filter(j => j.cost == null); if (!open.length) return;
      const got = {}; for (const j of open) { const r = await D.get("joblog", j.id); if (r && r.finished) got[j.id] = r.cost || 0; }
      if (Object.keys(got).length) await mutate(pid, s2 => { for (const j of s2.spend.jobs) if (j.id in got) j.cost = got[j.id]; });
    }
    const stageCap = (s, stage) => stage === "videos" ? (s.auth ? s.auth.max : 0) : (s.cfg.budget[stage] ?? s.cfg.budget.project);
    function gate(s, stage, est) {
      const left = s.cfg.budget.project - s.spend.total, sl = stageCap(s, stage) - (s.spend.stage[stage] || 0);
      if (est > left + 1e-9) return `the project budget (${APP.money(s.cfg.budget.project)}) would be exceeded: ${APP.money(s.spend.total)} used, ~${APP.money(est)} needed`;
      if (est > sl + 1e-9) return `the ${stage} limit (${APP.money(stageCap(s, stage))}) would be exceeded: ${APP.money(s.spend.stage[stage] || 0)} used, ~${APP.money(est)} needed`;
      return "";
    }
    Object.assign(DIR, { settle, gate });
    // every job the manual helpers (SP.sb.frame / video) submit while a stage runs is booked to that stage
    const realFetch = window.fetch;
    window.fetch = async function (input, init) {
      const r = await realFetch.apply(this, arguments);
      try {
        const url = typeof input === "string" ? input : input.url;
        if (DIR.ctx && init && init.method === "POST" && /\/api\/generate$/.test(String(url).split("?")[0]) && !(init.headers && init.headers["X-Dir-Own"])) {
          const body = JSON.parse(init.body), j = await r.clone().json(), c = DIR.ctx;
          if (j.id) mutate(c.pid, s => { s.spend.jobs.push({ id: j.id, stage: c.stage, tool: body.tool, est: COST[body.tool] || 0.1, cost: null }); });
        }
      } catch {}
      return r;
    };
    const withStage = async (pid, stage, fn) => { DIR.ctx = { pid, stage }; try { return await fn(); } finally { DIR.ctx = null; await settle(pid).catch(() => {}); } };

    // ------------------------------------------------------------------ jobs that survive a reload: the job id is saved before it is waited for
    class Stop extends Error { constructor(why) { super(why); this.stop = true; } }
    async function jobAsset(pid, key, tool, params, stage) {
      let s = await load(pid), pend = s.pending[key];
      if (!pend) {
        if (s.paused || s.state === "CANCELLED") throw new Stop("paused");
        const r = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json", "X-Dir-Own": "1" }, body: JSON.stringify({ tool, params }) }), j = await r.json();
        if (!r.ok) throw new Error(j.error || "Error " + r.status);
        pend = { id: j.id, tool, at: Date.now() };
        await mutate(pid, s2 => { s2.pending[key] = pend; s2.spend.jobs.push({ id: j.id, stage, tool, est: COST[tool] || 0.1, cost: null }); });
      }
      for (;;) {
        s = await load(pid); if (s.paused || s.state === "CANCELLED") throw new Stop("paused");
        let st; try { st = await api("../status/" + pend.id); } catch (e) { if (/404/.test(String(e.message))) { await mutate(pid, s2 => { delete s2.pending[key]; }); throw new Error("The GPU job was lost. It will be submitted again."); } await sleep(4000); continue; }
        if (st.error) { await mutate(pid, s2 => { delete s2.pending[key]; }); throw new Error(String(st.error).slice(0, 300)); }
        if (st.files && st.files.length) {
          const f = st.files.find(x => /\.(png|jpe?g|webp|mp3|wav|flac)$/i.test(x)) || st.files[0], asset = await api("register", { file: f });
          await mutate(pid, s2 => { delete s2.pending[key]; }); return asset;
        }
        await sleep(DIR.poll || 4000);
      }
    }
    async function pool(items, n, fn) {
      const q = items.slice(), out = [], err = [];
      await Promise.all(Array.from({ length: Math.max(1, Math.min(n, q.length)) }, async () => { while (q.length) { const it = q.shift(); try { out.push(await fn(it)); } catch (e) { if (e && e.stop) throw e; err.push({ it, e }); } } }));
      return { out, err };
    }
    const projectOf = async pid => (await api("projects")).items.find(p => p.id === pid) || null;
    const scenesOf = pid => api("scenes?project=" + pid).then(r => r.items);
    const SIZE = { "9:16": [768, 1344], "16:9": [1344, 768], "1:1": [1024, 1024] };
    const panelSize = a => a === "9:16" ? [512, 896] : a === "1:1" ? [640, 640] : [896, 512];

    // ------------------------------------------------------------------ approvals (always tied to a specific version / asset)
    const approved = (s, kind, ref) => s.approvals.some(a => a.kind === kind && a.ref === ref && !a.revoked);
    const grant = (pid, kind, ref, extra) => mutate(pid, s => { s.approvals.push({ kind, ref, at: Date.now(), ...extra }); });
    const revoke = (pid, pred) => mutate(pid, s => { for (const a of s.approvals) if (pred(a)) a.revoked = true; });
    Object.assign(DIR, { approved, grant, revoke });

    // ------------------------------------------------------------------ language model (optional, economical) + local fallback
    const LS = APP.LS;
    const llm = DIR.llm = {
      key: () => { try { return LS.get("dir_llm_key", "") || ""; } catch { return ""; } },
      model: () => { try { return LS.get("dir_llm_model", "") || "claude-haiku-5-5"; } catch { return "claude-haiku-5-5"; } },
      on: () => !!llm.key(),
      async call({ system, messages, tools, max = 3000 }) {
        const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": llm.key(), "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
          body: JSON.stringify({ model: llm.model(), max_tokens: max, system, messages, ...(tools ? { tools } : {}) }) });
        const j = await r.json(); if (!r.ok) throw new Error((j.error && j.error.message) || "Language model error " + r.status); return j;
      },
    };
    const textOf = j => (j.content || []).filter(c => c.type === "text").map(c => c.text).join("\n");
    const jsonOf = t => { const a = t.indexOf("{"), b = t.lastIndexOf("}"); if (a < 0 || b < a) throw new Error("no JSON"); return JSON.parse(t.slice(a, b + 1)); };

    const BEATS = [["Opening", "establishing the world and mood", "stand", "still on the edge of a rooftop as neon light washes over them"], ["Introduction", "meeting the hero in everyday life", "walk", "through a busy street, glancing at glowing signs"], ["Call", "something unusual disturbs the ordinary", "stop", "suddenly as a strange glowing light flickers ahead"], ["Decision", "the hero chooses to step into the unknown", "take", "a deep breath and step toward a glowing doorway"], ["Crossing", "entering the new world", "walk", "into a shimmering hall, looking around in wonder"], ["Allies", "meeting the team", "greet", "each other with bright smiles as the team gathers"], ["Training", "learning the rules and growing stronger", "practice", "synchronised moves in a mirror-lined studio"], ["Rising danger", "the threat becomes real", "freeze", "as dark shapes gather in the shadows around them"], ["Setback", "a plan fails and doubt appears", "lower", "their heads as the light around them fades"], ["Resolve", "the team regroups with a new idea", "raise", "their heads and nod with determination"], ["Confrontation", "facing the main threat", "step", "forward to face the glowing shadow"], ["Climax", "the decisive moment", "leap", "forward as a wave of light surges around them"], ["Victory", "the threat is beaten", "watch", "the darkness dissolve into drifting sparks"], ["Aftermath", "calm after the storm", "walk", "slowly through a quiet, moonlit street"], ["Bond", "the team celebrates together", "laugh", "together with joined hands on a stage"], ["Ending", "a final image of the changed hero", "stand", "tall facing the camera as the skyline glows behind them"]];
    const CAMS = ["slow push-in", "wide establishing shot", "handheld tracking shot", "low-angle hero shot", "over-the-shoulder shot", "orbiting medium shot", "slow pull-back", "close-up with shallow depth of field"];
    const LIGHTS = ["neon glow, magenta and cyan rim light", "warm golden-hour light", "moonlit blue night with soft haze", "dramatic high-contrast backlight", "soft diffused daylight", "glowing lantern light"];
    const PLACES = ["neon-lit city rooftop at night", "a quiet bedroom at dawn", "a glowing concert stage", "a rain-soaked alley with lantern signs", "a mirror-lined rehearsal studio", "an ancient temple courtyard", "a moonlit bridge over the river", "a vast neon skyline"];
    function parseBrief(text, chars, curAspect) {
      const t = String(text || ""), nm = t.match(/(\d{1,2})\s*[- ]?\s*(?:scene|shot|panel)/i), am = t.match(/\b(9\s*:\s*16|16\s*:\s*9|1\s*:\s*1)\b/);
      const n = Math.max(2, Math.min(nm ? +nm[1] : 8, 24)), aspect = am ? am[1].replace(/\s/g, "") : curAspect || "9:16";
      const names = []; for (const c of chars) { const first = c.name.split(/\s+/)[0]; if (new RegExp("\\b" + first.replace(/[^\w]/g, "") + "\\b", "i").test(t)) names.push(c.name); }
      const sent = t.match(/(?:existing|using|use|with|featuring|starring|characters?|about)[^.\n]*?([A-Z][\w'’-]+(?:\s*(?:,|and|&)\s*(?:and\s+)?[A-Z][\w'’-]+)*)/g) || [], skip = /^(Create|Use|Make|Generate|The|A|An|K-Pop|Demon|Hunters|Character|Characters|Existing|Reference|References|Movie|Film|Scene|Scenes|Cinematic|Everything|Hessa's)$/i;
      for (const sTxt of sent) for (const w of sTxt.split(/,|\band\b|&/).map(x => x.trim().replace(/^(?:existing|using|use|with|featuring|starring|characters?|about)\s+/i, "")).map(x => x.split(/\s+/).filter(y => /^[A-Z][\w'’-]+$/.test(y) && !skip.test(y)).slice(0, 2).join(" ")).filter(Boolean)) if (w.length > 2 && !names.some(x => x.toLowerCase().startsWith(w.toLowerCase().split(" ")[0]))) names.push(w);
      return { n, aspect, names: [...new Set(names)].slice(0, 6), music: /music|sound ?track|score|song|k-?pop/i.test(t), request: t };
    }
    function localStory(brief) {
      const { n, names, request } = brief, hero = names[0] || "The hero", about = request.match(/\babout\s+(.+?)(?:[.!?](?:\s|$)|$)/i);
      const topic = (about ? about[1] : request.replace(/^(please\s+)?(create|make|generate|write)\s+(me\s+)?(a|an|the)?\s*/i, "").replace(/\b(\d+[- ]scene|9:16|16:9|1:1|cinematic|movie|film)\b/gi, "").split(/[.!?]/)[0]).replace(/\s+/g, " ").trim();
      const title = topic.replace(/^[a-z]/, c => c.toUpperCase()).slice(0, 80) || "Untitled movie", scenes = [];
      for (let i = 0; i < n; i++) {
        const [beat, desc, verb, rest] = BEATS[Math.round(i * (BEATS.length - 1) / Math.max(1, n - 1))], k = i % Math.max(1, names.length - 1);
        const who = i === 0 || i === n - 1 ? names.slice(0, 1) : names.slice(0, 1).concat(names.slice(1 + k, 2 + k)), group = (who.length ? who : names.slice(0, 1)).filter(Boolean);
        const nameTxt = group.length ? group.join(" and ") : hero, vb = group.length > 1 ? verb : verb + (/(s|sh|ch|x)$/.test(verb) ? "es" : "s"), place = PLACES[i % PLACES.length];
        scenes.push({ title: beat, purpose: desc, location: place, time_of_day: /night|neon|moon/.test(place) ? "night" : "day", lighting: LIGHTS[i % LIGHTS.length], camera: CAMS[i % CAMS.length],
          action: `${nameTxt} ${vb} ${rest}.`, characters: group, duration: 6, dialogue: "", sfx: "", music: "", mood: desc });
      }
      return { title, logline: `A ${n}-scene cinematic short: ${topic || "an original story"}.`, style: "cinematic, rich colour, consistent character design", characters: names.map(x => ({ name: x, look: "", role: x === hero ? "hero" : "ally" })), scenes, music: { want: brief.music, prompt: "energetic cinematic pop orchestral music with a heroic, magical mood" }, by: "template" };
    }
    async function planStory(pid, brief, chars) {
      if (llm.on()) {
        try {
          const sys = "You are the story writer of an AI movie studio. Reply with ONE JSON object only, no prose. Shape: {title, logline, style, characters:[{name, look, role}], scenes:[{title, purpose, action, location, time_of_day, lighting, camera, mood, characters:[names], duration, dialogue, sfx, music}], music:{want:boolean, prompt}}. " +
            "Exactly N scenes. Each scene 'action' must describe only VISIBLE movement of the named characters, one moment, one place. Use only the given character names for existing characters. Scene duration 6 seconds. Keep it filmable as one single shot each.";
          const j = await llm.call({ system: sys, messages: [{ role: "user", content: `N=${brief.n}. Aspect ${brief.aspect}. Existing library characters: ${chars.map(c => c.name + (c.description ? " (" + c.description + ")" : "")).join("; ") || "none"}. Request: ${brief.request}` }], max: 6000 });
          const st = jsonOf(textOf(j)); if (!Array.isArray(st.scenes) || st.scenes.length < 2) throw new Error("the model returned no scenes");
          st.scenes = st.scenes.slice(0, brief.n); st.by = "llm"; return st;
        } catch (e) { await logErr(pid, e, "llm story"); await say(pid, { type: "text", text: "The language model could not write the story (" + String(e.message).slice(0, 140) + "). I used the built-in template instead." }); }
      }
      return localStory(brief);
    }
    Object.assign(DIR, { parseBrief, planStory, localStory });

    // ------------------------------------------------------------------ stage: storyboard (one numbered contact sheet)
    const panelPrompt = (s, sc, i) => `Cinematic storyboard frame ${i + 1}. ${sc.location ? sc.location + ". " : ""}${sc.action} Lighting: ${sc.lighting || "cinematic"}. Camera: ${sc.camera || "medium shot"}. Style: ${s.story.style || "cinematic"}. One single continuous image of one moment, no text, no borders, no panels, no collage.`;
    const loadImg = url => new Promise(res => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
    async function composeSheet(pid, panels, titles, aspect, name) {
      const n = panels.length, [cw, ch] = aspect === "9:16" ? [288, 512] : aspect === "1:1" ? [340, 340] : [448, 252], cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols), gap = 12, strip = 38, head = 64;
      const cv = document.createElement("canvas"); cv.width = gap + cols * (cw + gap); cv.height = head + rows * (ch + strip + gap) + gap; const g = cv.getContext("2d");
      g.fillStyle = "#0e0e12"; g.fillRect(0, 0, cv.width, cv.height); g.fillStyle = "#eceaf3"; g.font = "600 30px system-ui,sans-serif"; g.textBaseline = "middle"; g.fillText(String(name || "Storyboard").slice(0, 60), gap + 4, head / 2);
      for (let i = 0; i < n; i++) {
        const x = gap + (i % cols) * (cw + gap), y = head + Math.floor(i / cols) * (ch + strip + gap);
        g.fillStyle = "#1d1d25"; g.fillRect(x, y, cw, ch + strip);
        const img = panels[i] ? await loadImg(await B.blobUrl(panels[i])) : null;
        if (img) { const k = Math.max(cw / img.naturalWidth, ch / img.naturalHeight), sw = cw / k, sh = ch / k; g.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, cw, ch); }
        else { g.fillStyle = "#33333f"; g.fillRect(x, y, cw, ch); g.fillStyle = "#9b99aa"; g.font = "20px system-ui"; g.fillText("no image", x + 14, y + ch / 2); }
        g.fillStyle = "rgba(14,14,18,.82)"; g.beginPath(); g.arc(x + 24, y + 24, 18, 0, 7); g.fill(); g.fillStyle = "#fff"; g.font = "700 18px system-ui"; g.textAlign = "center"; g.fillText(String(i + 1), x + 24, y + 25); g.textAlign = "left";
        g.fillStyle = "#eceaf3"; g.font = "600 17px system-ui"; let t = String(titles[i] || ""); while (t.length > 3 && g.measureText(t).width > cw - 14) t = t.slice(0, -2); g.fillText(t === String(titles[i] || "") ? t : t + "…", x + 8, y + ch + strip / 2);
      }
      const blob = await new Promise(r => cv.toBlob(r, "image/png")), data = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
      return api("assets", { filename: `storyboard_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}.png`, data, type: "image", tags: ["storyboard", "contact-sheet"] });
    }
    async function stageStoryboard(pid) {
      let s = await load(pid), p = await projectOf(pid), v = s.sb.versions[s.sb.cur - 1];
      const scenes = await scenesOf(pid), todo = []; for (let i = 0; i < scenes.length; i++) if (!v.panels[i]) todo.push(i);
      if (todo.length) {
        const why = gate(s, "storyboard", todo.length * COST.qwen_image); if (why) return halt(pid, "budget", "storyboard", why);
        const [w, hh] = panelSize(p.aspect), mid = await say(pid, { type: "progress", key: "sb" + v.v, title: `Drawing storyboard panels (${scenes.length - todo.length}/${scenes.length})`, items: scenes.map((sc, i) => ({ n: i + 1, asset: v.panels[i] || "", state: v.panels[i] ? "done" : "wait" })) });
        await withStage(pid, "storyboard", async () => {
          const r = await pool(todo, s.cfg.maxConcurrent, async i => {
            const a = await jobAsset(pid, `sb:${v.v}:${i}`, "qwen_image", { prompt: panelPrompt(s, scenes[i], i), negative: "text, labels, collage, split screen, panels, borders, multiple images", width: w, height: hh, turbo: true }, "storyboard");
            await mutate(pid, s2 => { s2.sb.versions[s2.sb.cur - 1].panels[i] = a.id; });
            const cur = await load(pid), pv = cur.sb.versions[cur.sb.cur - 1];
            await patchMsg(pid, mid, { title: `Drawing storyboard panels (${pv.panels.filter(Boolean).length}/${scenes.length})`, items: scenes.map((sc, k) => ({ n: k + 1, asset: pv.panels[k] || "", state: pv.panels[k] ? "done" : "wait" })) });
          });
          if (r.err.length) throw new Error(`${r.err.length} storyboard panel(s) failed: ${r.err[0].e.message}`);
        });
        await patchMsg(pid, mid, { done: true });
      }
      s = await load(pid); v = s.sb.versions[s.sb.cur - 1];
      const sheet = await composeSheet(pid, v.panels, scenes.map(x => x.title), p.aspect, s.story.title);
      await mutate(pid, s2 => { s2.sb.versions[s2.sb.cur - 1].sheet = sheet.id; });
      await say(pid, { type: "storyboard", text: `Storyboard v${v.v} is ready: ${scenes.length} scenes in one contact sheet. Please review it. Nothing else happens until you approve it.`, media: [{ asset: sheet.id, kind: "image", caption: `Storyboard v${v.v} · ${scenes.length} scenes · ${p.aspect}`, full: true }],
        buttons: [{ label: "Approve storyboard", act: "approve_storyboard", ref: { v: v.v, sheet: sheet.id }, style: "ok" }, { label: "Regenerate", act: "regen_storyboard", ref: { v: v.v } }, { label: "Edit scene…", act: "prefill", ref: { text: "Change scene 1 to " } }, { label: "Change style…", act: "prefill", ref: { text: "Change the style to " } }] });
      return setState(pid, "STORYBOARD_AWAITING_APPROVAL");
    }
    async function halt(pid, kind, stage, why) {
      await mutate(pid, s => { s.halted = { kind, stage, why }; });
      await say(pid, { type: "text", text: kind === "budget" ? `I stopped before spending more: ${why}.` : `I stopped: ${why}`, buttons: kind === "budget" ? [{ label: "Raise limits and continue", act: "raise_budget", ref: { stage } }, { label: "Keep stopped", act: "dismiss", ref: {} }] : [{ label: "Try again", act: "retry", ref: {} }] });
      return false;
    }
    Object.assign(DIR, { composeSheet, halt, jobAsset, pool, withStage, panelSize, SIZE, projectOf, scenesOf, COST, clipEst, Stop });
    DIR.stages = {};
    DIR.stages.STORYBOARD_GENERATING = stageStoryboard;

    // ------------------------------------------------------------------ the engine
    let engineChain = Promise.resolve();
    function advance(pid) {   // one engine at a time (one project's paid stage never overlaps another's); across tabs a Web Lock keeps a second window from duplicating jobs
      const run = engineChain.then(() => lockRun(pid)).catch(e => console.warn("director", e));
      engineChain = run.catch(() => {}); return run;
    }
    async function lockRun(pid) {
      const body = async () => {
        DIR.running.set(pid, true); emit(pid, "run");
        try {
          for (let guard = 0; guard < 60; guard++) {
            const s = await load(pid); if (s.paused || s.halted || IDLE.has(s.state) || WAITING.has(s.state)) break;
            const fn = DIR.stages[s.state]; if (!fn) break;
            const before = s.state; let r;
            try { r = await fn(pid); } catch (e) { if (e && e.stop) break; await logErr(pid, e, s.state); await halt(pid, "error", s.state, String((e && e.message) || e).slice(0, 240)); break; }
            const after = await load(pid); if (r === false || (after.state === before && !after.halted)) break;
          }
        } finally { DIR.running.delete(pid); emit(pid, "run"); }
      };
      if (navigator.locks) { const got = await navigator.locks.request("ai-studio-director-engine", { ifAvailable: true }, async lock => { if (!lock) return false; await body(); return true; }); if (!got) await say(pid, { type: "text", text: "Another window is already running production. I will keep this one read-only." }).catch(() => {}); }
      else await body();
    }
    DIR.advance = advance;
    DIR.setState = setState;
    DIR.init2 = true;
    document.dispatchEvent(new Event("dir-core-ready"));
  }
})();
