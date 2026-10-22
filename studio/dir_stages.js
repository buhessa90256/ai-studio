// AI Director, production stages (characters -> start frames -> videos -> assembly), the tool registry and the chat agent.
// Rules kept here: every approval is tied to a specific version/asset; nothing paid starts without the stage's budget; approval tools are never callable by the language model.
"use strict";
(() => {
  const go = () => {
    const DIR = window.DIR, B = StudioBackend, D = SDB, api = APP.api, sleep = ms => new Promise(r => setTimeout(r, ms));
    const { get, mutate, say, patchMsg, setState, gate, grant, revoke, approved, jobAsset, pool, withStage, projectOf, scenesOf, COST, clipEst, halt, advance, Stop } = DIR;
    const BUSY = ["keyframe_generating", "generating", "queued"];
    const names = (s, sc, i) => (s.story && s.story.scenes[i] && s.story.scenes[i].characters) || [];
    const dataUrl = async id => new Promise(async r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(await B.getBlob(id)); });
    const saveScene = (sc, patch) => api("scenes", { ...sc, ...patch });
    const setSettings = (sc, patch) => saveScene(sc, { settings: { ...(sc.settings || {}), ...patch } });
    async function waitScene(id) { for (;;) { const sc = await api("scenes/" + id); if (!BUSY.includes(sc.status)) return sc; const s = DIR.cur && (await get(DIR.cur)); if (s && (s.paused || s.state === "CANCELLED")) throw new Stop("paused"); await sleep(DIR.poll || 4000); } }
    const frameOk = sc => !!sc.start_asset && sc.status !== "failed" && !BUSY.includes(sc.status) && !(sc.settings || {}).dir_redo;
    const clipOk = sc => !!sc.video_asset && sc.status === "done" && !(sc.settings || {}).dir_redo_clip;

    // ------------------------------------------------------------------ characters
    const findChar = (chars, name) => chars.find(c => c.name.toLowerCase() === name.toLowerCase()) || chars.find(c => c.name.toLowerCase().split(/\s+/)[0] === name.toLowerCase().split(/\s+/)[0]);
    async function attachCharacters(pid) {   // scene.characters / project.characters from the story, by name, using what exists in the library now
      const s = await get(pid), chars = (await api("characters")).items, scenes = await scenesOf(pid), p = await projectOf(pid), ids = new Set(p.characters || []);
      for (let i = 0; i < scenes.length; i++) {
        const want = names(s, scenes[i], i).map(n => findChar(chars, n)).filter(Boolean).map(c => c.id); want.forEach(x => ids.add(x));
        if (JSON.stringify(want) !== JSON.stringify(scenes[i].characters || [])) await saveScene(scenes[i], { characters: want });
      }
      if ([...ids].join() !== (p.characters || []).join()) await api("projects", { ...p, characters: [...ids] });
      APP.changed("all");
    }
    DIR.stages.CHARACTERS_CHECKING = async pid => {
      const s = await get(pid), chars = (await api("characters", undefined)).items, need = [...new Set((s.story.characters || []).map(c => c.name).concat((s.story.scenes || []).flatMap(x => x.characters || [])))].filter(Boolean);
      const found = [], missing = [];
      for (const n of need) { const c = findChar(chars, n); (c && (c.refs || []).length ? found : missing).push(c ? { n, c } : { n }); }
      if (found.length) {
        const media = found.map(f => { const r = (f.c.refs.find(x => x.role === "primary") || f.c.refs.find(x => x.role === "face") || f.c.refs[0]); return { asset: r.asset.id, kind: "image", caption: f.c.name }; });
        await say(pid, { type: "text", text: `Found ${found.length} existing character${found.length > 1 ? "s" : ""} in your library: ${found.map(f => f.c.name).join(", ")}. I will use their saved reference photos (primary face first) and I will not change them.`, media });
      }
      await attachCharacters(pid);
      if (missing.length) {
        await mutate(pid, s2 => { for (const m of missing) if (!s2.newChars[m.n] || s2.newChars[m.n].status === "saved") s2.newChars[m.n] = { status: "pending", face: "", body: "", look: ((s2.story.characters || []).find(c => c.name === m.n) || {}).look || "" }; });
        await say(pid, { type: "text", text: `Not in the library yet: ${missing.map(m => m.n).join(", ")}. I will draw reference pictures (a face and a full-body) for you to approve before anything is saved.` });
        return setState(pid, "CHARACTERS_GENERATING");
      }
      return setState(pid, "FIRST_TWO_FRAMES_GENERATING");
    };
    DIR.stages.CHARACTERS_GENERATING = async pid => {
      let s = await get(pid); const todo = Object.entries(s.newChars).filter(([, c]) => c.status === "pending");
      const why = gate(s, "characters", todo.length * 2 * COST.qwen_image); if (why) return halt(pid, "budget", "characters", why);
      await withStage(pid, "characters", async () => {
        const r = await pool(todo, s.cfg.maxConcurrent, async ([name, c]) => {
          const look = c.look || "natural, friendly, distinctive hairstyle and outfit fitting the story";
          const face = await jobAsset(pid, `char:${name}:face:${c.n || 0}`, "qwen_image", { prompt: `Photorealistic studio portrait of ${name}, ${look}. Front view, face clearly visible, neutral light grey background, sharp focus, one person only, no text.`, negative: "collage, multiple people, text, watermark", width: 768, height: 1024, turbo: true }, "characters");
          const body = await jobAsset(pid, `char:${name}:body:${c.n || 0}`, "qwen_edit", { images: [await dataUrl(face.id)], prompt: `The same person as in the reference picture, identical face and hairstyle, shown full body standing, ${look}. Plain light background, one person only, no text.`, negative: "collage, multiple people, text", turbo: true }, "characters");
          await mutate(pid, s2 => { Object.assign(s2.newChars[name], { face: face.id, body: body.id, status: "awaiting" }); });
          await say(pid, { type: "character", text: `${name}: face and full-body reference. Approve to save ${name} to your library, or regenerate. (I cannot measure face similarity in the browser; the body picture was made from the face picture.)`, media: [{ asset: face.id, kind: "image", caption: name + " · face", full: true }, { asset: body.id, kind: "image", caption: name + " · full body", full: true }],
            buttons: [{ label: `Approve & save ${name}`, act: "approve_character", ref: { name, face: face.id, body: body.id }, style: "ok" }, { label: "Regenerate", act: "regen_character", ref: { name } }] });
        });
        if (r.err.length) throw new Error(`Could not draw ${r.err[0].it[0]}: ${r.err[0].e.message}`);
      });
      return setState(pid, "CHARACTERS_AWAITING_APPROVAL");
    };

    // ------------------------------------------------------------------ start frames
    async function genFrames(pid, ids, stage, label) {
      const s = await get(pid), n = ids.length; if (!n) return { failed: [] };
      const why = gate(s, "frames", n * COST.qwen_edit * 1.5); if (why) { await halt(pid, "budget", "frames", why); throw new Stop("budget"); }
      DIR.cur = pid; await SP.sb.use(pid);
      const state = {}, scenes = await scenesOf(pid), idx = id => scenes.findIndex(x => x.id === id);
      const draw = async () => patchMsg(pid, mid, { title: `${label} (${Object.values(state).filter(v => v.state === "done").length}/${n})`, items: ids.map(id => ({ n: idx(id) + 1, asset: (state[id] || {}).asset || "", state: (state[id] || {}).state || "wait" })) });
      const mid = await say(pid, { type: "progress", key: "fr" + Date.now(), title: `${label} (0/${n})`, items: ids.map(id => ({ n: idx(id) + 1, asset: "", state: "wait" })) });
      const failed = [];
      await withStage(pid, stage, async () => {
        for (let pass = 0; pass <= s.cfg.maxRetries && ids.some(id => !(state[id] && state[id].state === "done")); pass++) {
          const left = ids.filter(id => !(state[id] && state[id].state === "done")), s2 = await get(pid), g2 = pass ? gate(s2, "frames", left.length * COST.qwen_edit * 1.5) : ""; if (g2) { await halt(pid, "budget", "frames", g2); throw new Stop("budget"); }
          await pool(left, s2.cfg.maxConcurrent, async id => {
            if ((await get(pid)).paused) throw new Stop("paused");
            state[id] = { state: "run" }; await draw();
            let sc = await api("scenes/" + id); if (BUSY.includes(sc.status)) sc = await waitScene(id);   // a job from before a reload is still running: wait for it instead of submitting again
            if (!frameOk(sc) || (sc.settings || {}).dir_redo) { if (!(sc.status === "keyframe_ready" && sc.start_asset && !(sc.settings || {}).dir_redo)) await SP.sb.frame(id); }
            sc = await api("scenes/" + id);
            if (sc.status === "keyframe_ready" && sc.start_asset) { if ((sc.settings || {}).dir_redo) await setSettings(sc, { dir_redo: false }); state[id] = { state: "done", asset: sc.start_asset }; } else state[id] = { state: "fail", error: sc.error };
            await draw();
          });
        }
      });
      for (const id of ids) if (!(state[id] && state[id].state === "done")) failed.push({ id, n: idx(id) + 1, error: (state[id] || {}).error || "no valid frame" });
      await patchMsg(pid, mid, { done: true }); APP.changed("scenes"); return { failed };
    }
    async function framesMsg(pid, ids, first) {
      const scenes = await scenesOf(pid), list = ids.map(id => scenes.find(x => x.id === id)), bad = list.filter(sc => !frameOk(sc));
      const media = list.filter(sc => sc.start_asset).map(sc => ({ asset: sc.start_asset, kind: "image", caption: `Scene ${scenes.indexOf(sc) + 1} · ${sc.title}`, full: true, scene: sc.id }));
      const btn = [];
      if (!bad.length) btn.push({ label: first ? "Approve both" : "Approve all frames", act: first ? "approve_first" : "approve_frames", ref: { map: Object.fromEntries(list.map(sc => [sc.id, sc.start_asset])) }, style: "ok" });
      if (list.length <= 4) for (const sc of list) btn.push({ label: `Regenerate scene ${scenes.indexOf(sc) + 1}`, act: "regen_frame", ref: { n: scenes.indexOf(sc) + 1 } }); else { for (const sc of bad) btn.push({ label: `Regenerate scene ${scenes.indexOf(sc) + 1}`, act: "regen_frame", ref: { n: scenes.indexOf(sc) + 1 } }); btn.push({ label: "Regenerate a scene…", act: "prefill", ref: { text: "Regenerate scene " } }); }
      if (first) btn.push({ label: "Edit prompt…", act: "prefill", ref: { text: "Change scene 1 to " } }, { label: "Change reference", act: "change_ref", ref: {} });
      await say(pid, { type: "frames", text: bad.length ? `${bad.length} frame(s) did not pass the checks (${bad.map(sc => "scene " + (scenes.indexOf(sc) + 1) + ": " + (sc.error || "no valid frame")).join("; ").slice(0, 300)}). The pictures that passed are shown. Regenerate the others.` : first ? "Here are the first two start frames (original pictures, checked: single image, exact shape). Approve both before I make the rest." : "All start frames are ready. Check them, then approve.", media, buttons: btn });
    }
    DIR.stages.FIRST_TWO_FRAMES_GENERATING = async pid => {
      const scenes = await scenesOf(pid), ids = scenes.slice(0, 2).filter(sc => !frameOk(sc)).map(sc => sc.id);
      await genFrames(pid, ids, "frames", "Making the first start frames");
      await framesMsg(pid, scenes.slice(0, 2).map(x => x.id), true); return setState(pid, "FIRST_TWO_FRAMES_AWAITING_APPROVAL");
    };
    DIR.stages.REMAINING_FRAMES_GENERATING = async pid => {
      const scenes = await scenesOf(pid), ids = scenes.filter(sc => !frameOk(sc)).map(sc => sc.id);
      const r = await genFrames(pid, ids, "frames", `Making ${ids.length} start frame${ids.length > 1 ? "s" : ""}`);
      await framesMsg(pid, scenes.map(x => x.id), false); return setState(pid, "FRAMES_AWAITING_APPROVAL");
    };
    async function approveFrames(pid, map) {   // only for the exact assets that were shown
      const scenes = await scenesOf(pid);
      for (const [id, asset] of Object.entries(map)) { const sc = scenes.find(x => x.id === id); if (!sc || sc.start_asset !== asset || !frameOk(sc)) throw new Error("A frame changed since you saw it. Please look at the new one first."); }
      for (const [id, asset] of Object.entries(map)) { const sc = scenes.find(x => x.id === id); await grant(pid, "frame", asset, { scene: id }); await setSettings(sc, { review: "approved", approved_asset: asset, approved_at: Date.now() / 1000 }); }
      APP.changed("scenes");
    }

    // ------------------------------------------------------------------ video
    async function authCard(pid) {
      const s = await get(pid), scenes = await scenesOf(pid), todo = scenes.filter(sc => !clipOk(sc)), est = todo.reduce((a, sc) => a + clipEst(sc), 0), mc = s.cfg.maxConcurrent, mins = Math.ceil(todo.length / mc) * 7 + 5, sug = Math.max(0.5, Math.ceil(est * 1.25 * 2) / 2);
      const q = ((scenes[0] || {}).settings || {}).quality === "fast" ? "fast" : "high";
      await say(pid, { type: "auth", text: "Ready for video. This is the first step that spends real GPU money on videos. Please check and authorize.", facts: [["Scenes", todo.length + " of " + scenes.length], ["Model", "MiniMax-H3 image → video with sound · " + q + " quality"], ["Estimated cost", "~" + APP.money(est)], ["Expected time", `about ${mins} min (${mc} at a time; +5 min if the GPU is asleep)`], ["Spent so far", APP.money(s.spend.total) + " of " + APP.money(s.cfg.budget.project) + " project budget"], ["Maximum I may spend on videos", APP.money(sug)]],
        buttons: [{ label: `Authorize up to ${APP.money(sug)}`, act: "authorize_videos", ref: { max: sug, est }, style: "ok" }, { label: q === "fast" ? "Use high quality" : "Use fast quality (cheaper)", act: "set_quality", ref: { q: q === "fast" ? "high" : "fast" } }, { label: "Change budget…", act: "prefill", ref: { text: "Set the video budget to $" } }] });
      return setState(pid, "VIDEO_AWAITING_AUTHORIZATION");
    }
    async function checkClip(sc, project) {   // browser-side checks only: shape, length, sampled frames (cuts / panels). Face deformation cannot be measured here.
      const flags = [], a = await B.getAsset(sc.video_asset); if (!a || !a.size) return { ok: false, severe: true, flags: ["clip file is empty or missing"] };
      const url = await B.blobUrl(a.id), v = document.createElement("video"); v.muted = true; v.preload = "auto"; v.src = url;
      const meta = await new Promise(res => { v.onloadeddata = () => res(true); v.onerror = () => res(false); setTimeout(() => res(false), 15000); });
      if (!meta) return { ok: false, severe: true, flags: ["clip cannot be played"] };
      const [pw, ph] = DIR.SIZE[project.aspect] || DIR.SIZE["16:9"], ar = v.videoWidth / v.videoHeight, want = pw / ph;
      if (Math.abs(ar - want) / want > 0.04) flags.push(`wrong shape ${v.videoWidth}x${v.videoHeight} (project is ${project.aspect})`);
      const dur = v.duration || 0; if (!dur || dur < (sc.duration || 6) * 0.5) flags.push(`clip is only ${dur.toFixed(1)}s (asked for ${sc.duration || 6}s)`);
      const cv = document.createElement("canvas"); cv.width = 48; cv.height = Math.max(8, Math.round(48 / ar)); const g = cv.getContext("2d", { willReadFrequently: true }), prev = [], diffs = [];
      for (let k = 0; k < 8 && dur; k++) {
        v.currentTime = Math.min(dur - 0.05, dur * (k + 0.5) / 8); await new Promise(r => { v.onseeked = r; setTimeout(r, 1500); });
        try { g.drawImage(v, 0, 0, cv.width, cv.height); const px = g.getImageData(0, 0, cv.width, cv.height).data; if (prev.length) { let d = 0; for (let i = 0; i < px.length; i += 4) d += Math.abs(px[i] - prev[i]) + Math.abs(px[i + 1] - prev[i + 1]) + Math.abs(px[i + 2] - prev[i + 2]); diffs.push(d / (px.length / 4) / 3); } prev.length = 0; prev.push(...px); } catch {}
      }
      if (diffs.length > 2) { const med = diffs.slice().sort((x, y) => x - y)[diffs.length >> 1]; if (Math.max(...diffs) > 55 && Math.max(...diffs) > med * 4) flags.push("possible scene cut inside the clip"); }
      v.removeAttribute("src"); v.load();
      return { ok: !flags.length, severe: flags.some(f => /wrong shape|empty|cannot|only/.test(f)), flags };
    }
    async function runClips(pid, ids) {
      const s0 = await get(pid), project = await projectOf(pid); DIR.cur = pid; await SP.sb.use(pid);
      const scenes = await scenesOf(pid), idx = id => scenes.findIndex(x => x.id === id), state = {};
      const draw = async () => patchMsg(pid, mid, { title: `Making videos (${Object.values(state).filter(v => v.state === "done").length}/${ids.length})`, items: ids.map(id => ({ n: idx(id) + 1, asset: (state[id] || {}).thumb || "", state: (state[id] || {}).state || "wait", video: (state[id] || {}).video || "" })) });
      const mid = await say(pid, { type: "progress", key: "vid" + Date.now(), title: `Making videos (0/${ids.length})`, items: ids.map(id => ({ n: idx(id) + 1, asset: "", state: "wait" })) });
      await withStage(pid, "videos", async () => {
        await pool(ids, s0.cfg.maxConcurrent, async id => {
          if ((await get(pid)).paused) throw new Stop("paused");
          for (let tries = 0; tries <= s0.cfg.maxRetries; tries++) {
            let sc = await api("scenes/" + id); const s = await get(pid), why = gate(s, "videos", clipEst(sc)); if (BUSY.includes(sc.status)) sc = await waitScene(id);
            else if (!clipOk(sc)) { if (why) { await halt(pid, "budget", "videos", why); throw new Stop("budget"); } state[id] = { state: "run", thumb: sc.start_asset }; await draw(); await SP.sb.video(id); sc = await api("scenes/" + id); }
            if (!(sc.status === "done" && sc.video_asset)) { state[id] = { state: "fail", error: sc.error }; await draw(); continue; }
            const chk = await checkClip(sc, project); await mutate(pid, s2 => { s2.clipChecks[id] = { asset: sc.video_asset, ok: chk.ok, flags: chk.flags, at: Date.now() }; });
            if (sc.settings && sc.settings.dir_redo_clip) await setSettings(sc, { dir_redo_clip: false });
            if (chk.ok || !chk.severe || tries >= s0.cfg.maxRetries) { state[id] = { state: chk.ok ? "done" : "flag", thumb: sc.start_asset, video: sc.video_asset }; await draw(); return; }
            await saveScene(sc, { video_asset: "", status: "keyframe_ready", settings: { ...(sc.settings || {}), clip_history: [...((sc.settings || {}).clip_history || []), sc.video_asset] } });   // rejected clip stays in the library; try again
          }
          state[id] = { state: "fail" }; await draw();
        });
      });
      await patchMsg(pid, mid, { done: true }); APP.changed("scenes");
    }
    DIR.stages.VIDEO_GENERATING = async pid => {
      const scenes = await scenesOf(pid), ids = scenes.filter(sc => !clipOk(sc) || BUSY.includes(sc.status)).map(sc => sc.id);
      if (ids.length) await runClips(pid, ids);
      const s = await get(pid), sc2 = await scenesOf(pid), project = await projectOf(pid);
      const media = sc2.filter(sc => sc.video_asset).map((sc, i) => ({ asset: sc.video_asset, kind: "video", caption: `Scene ${sc2.indexOf(sc) + 1} · ${sc.title}`, scene: sc.id, flags: (s.clipChecks[sc.id] || {}).flags || [] }));
      const missing = sc2.filter(sc => !sc.video_asset), flagged = sc2.filter(sc => ((s.clipChecks[sc.id] || {}).flags || []).length && s.clipChecks[sc.id].asset === sc.video_asset);
      const btn = []; if (!missing.length) btn.push({ label: "Approve clips & assemble movie", act: "approve_clips", ref: { map: Object.fromEntries(sc2.map(sc => [sc.id, sc.video_asset])) }, style: "ok" });
      for (const sc of [...missing, ...flagged]) btn.push({ label: `Regenerate scene ${sc2.indexOf(sc) + 1}`, act: "regen_clip", ref: { n: sc2.indexOf(sc) + 1 } });
      await say(pid, { type: "clips", text: `${media.length} of ${sc2.length} videos are ready. Spent on videos so far: ${APP.money((await get(pid)).spend.stage.videos || 0)}.${flagged.length ? " " + flagged.length + " clip(s) are flagged for your review (automatic checks: shape, length, sudden cuts; I cannot detect face deformation here, so please watch them)." : ""}${missing.length ? " Missing: scene " + missing.map(sc => sc2.indexOf(sc) + 1).join(", ") + "." : ""}`, media, buttons: btn });
      return setState(pid, "VIDEO_REVIEW");
    };

    // ------------------------------------------------------------------ assembly
    DIR.stages.ASSEMBLING = async pid => {
      let s = await get(pid), scenes = await scenesOf(pid); const project = await projectOf(pid);
      const mid = await say(pid, { type: "text", text: "Assembling the movie: ordering clips, crossfades, music, export…" });
      let tl = await api("timeline/from_scenes", { project: pid, replace: true }); tl.clips.forEach((c, i) => { if (i) c.transition = 0.5; });
      await api("timeline", { project: pid, timeline: tl });
      if (s.story.music && s.story.music.want && !tl.audio.length) {
        const why = gate(s, "audio", COST.stable_audio); if (why) await say(pid, { type: "text", text: "I skipped the background music: " + why + "." });
        else await withStage(pid, "audio", async () => {
          const total = tl.clips.reduce((a, c) => a + (c.out - c.in), 0), a = await jobAsset(pid, "music", "stable_audio", { prompt: s.story.music.prompt || "cinematic background music", seconds: Math.min(47, Math.max(10, Math.round(total))) }, "audio");
          const t2 = await api("timeline?project=" + pid); t2.audio.push({ asset_id: a.id, start: 0, in: 0, out: 9999, volume: 0.22, fade_in: 1, fade_out: 2, kind: "music" }); await api("timeline", { project: pid, timeline: t2 });
        });
      }
      let j = await api("export", { project: pid, resolution: "source" });
      while (j.status === "queued" || j.status === "rendering") { await sleep(2000); j = await api("export/" + j.id); const cur = await get(pid); if (cur.paused) throw new Stop("paused"); }
      if (j.status !== "done") throw new Error(j.error || "export failed");
      const final = j.asset, [pw, ph] = DIR.SIZE[project.aspect] || DIR.SIZE["16:9"], v = document.createElement("video"); v.muted = true; v.src = await B.blobUrl(final.id);
      const ok = await new Promise(r => { v.onloadedmetadata = () => r(true); v.onerror = () => r(false); setTimeout(() => r(false), 15000); });
      const flags = []; if (!ok) flags.push("the exported file could not be opened"); else { if (Math.abs(v.videoWidth / v.videoHeight - pw / ph) / (pw / ph) > 0.04) flags.push(`exported size ${v.videoWidth}x${v.videoHeight} does not match ${project.aspect}`); const want = tl.clips.reduce((a, c) => a + (c.out - c.in), 0); if (v.duration < want * 0.8) flags.push(`movie is ${v.duration.toFixed(1)}s, expected about ${want.toFixed(1)}s`); }
      await mutate(pid, s2 => { s2.finalAsset = final.id; });
      await say(pid, { type: "final", text: flags.length ? "The movie was exported but failed my check: " + flags.join("; ") + "." : `The movie is ready: ${(v.duration || 0).toFixed(1)} s, ${v.videoWidth}x${v.videoHeight}. It is also in Library → Videos and in the project's Editor.`, media: [{ asset: final.id, kind: "video", caption: "Final movie", full: true, download: true }], scenes: scenes.map((sc, i) => ({ n: i + 1, asset: sc.video_asset, title: sc.title })), sheet: (s.sb.versions[s.sb.cur - 1] || {}).sheet || "",
        buttons: [{ label: "Looks good — finish", act: "approve_final", ref: { asset: final.id }, style: "ok" }, { label: "Export again", act: "export_again", ref: {} }] });
      return setState(pid, "FINAL_REVIEW");
    };

    // ------------------------------------------------------------------ the tool registry (name, permission class, schema, handler)
    const T = DIR.tools, reg = (name, perm, desc, props, req, fn) => { T[name] = { name, perm, desc, schema: { type: "object", properties: props, required: req || [] }, fn }; };
    const sceneN = async (pid, n) => { const sc = (await scenesOf(pid))[n - 1]; if (!sc) throw new Error(`There is no scene ${n}.`); return sc; };
    function validate(schema, a) {
      const o = {}; a = a || {};
      for (const [k, d] of Object.entries(schema.properties)) { let v = a[k]; if (v == null) { if (schema.required.includes(k)) throw new Error(`Missing "${k}".`); continue; }
        if (d.type === "integer" || d.type === "number") { v = Number(v); if (!Number.isFinite(v)) throw new Error(`"${k}" must be a number.`); if (d.type === "integer") v = Math.round(v); if (d.min != null && v < d.min) throw new Error(`"${k}" must be at least ${d.min}.`); if (d.max != null && v > d.max) throw new Error(`"${k}" must be at most ${d.max}.`); }
        else if (d.type === "string") { v = String(v).slice(0, d.max || 4000); } else if (d.type === "boolean") v = !!v; o[k] = v; }
      return o;
    }
    DIR.runTool = async (pid, name, args, origin = "ui") => {
      const t = T[name]; if (!t) return { error: "Unknown tool " + name };
      if (t.perm === "approval" && origin !== "ui" && origin !== "user_text") return { error: "This needs the user's own approval. Ask them to press the button." };
      try { return (await t.fn(pid, validate(t.schema, args), origin)) || { ok: true }; } catch (e) { return { error: String((e && e.message) || e) }; }
    };
    const stateIs = async (pid, ...st) => { const s = await get(pid); if (!st.includes(s.state)) throw new Error(`That is not possible right now (production is in ${s.state.toLowerCase().replace(/_/g, " ")}).`); return s; };
    const frameStages = ["FIRST_TWO_FRAMES_AWAITING_APPROVAL", "FIRST_TWO_FRAMES_GENERATING"];
    const afterBoard = s => s.sb.versions.length && approved(s, "storyboard", String(s.sb.cur));

    // read-only
    reg("get_project_status", "read", "Current production state, scene count, approvals and spending.", {}, [], async pid => { await DIR.settle(pid); const s = await get(pid), sc = await scenesOf(pid); return { state: s.state, paused: s.paused, halted: s.halted, scenes: sc.length, frames: sc.filter(frameOk).length, clips: sc.filter(clipOk).length, spent: +s.spend.total.toFixed(2), budget: s.cfg.budget.project, stage_spend: s.spend.stage }; });
    reg("list_scenes", "read", "List the scenes with title, action, status.", {}, [], async pid => (await scenesOf(pid)).map((sc, i) => ({ n: i + 1, title: sc.title, action: sc.action, status: sc.status, frame: frameOk(sc), video: clipOk(sc) })));
    reg("search_characters", "read", "Search saved library characters by name.", { query: { type: "string" } }, [], async (pid, a) => (await api("characters")).items.filter(c => !a.query || c.name.toLowerCase().includes(a.query.toLowerCase())).map(c => ({ name: c.name, references: (c.refs || []).length })));
    reg("gpu_status", "read", "State of the RunPod GPU workers.", {}, [], async () => { const g = await APP.refreshGpu(true); return { state: g.state, label: g.label, detail: g.detail, credit: g.balance, per_hour: g.perHour }; });
    reg("get_spend", "read", "What has been spent on this project, per stage, and the limits.", {}, [], async pid => { await DIR.settle(pid); const s = await get(pid); return { total: +s.spend.total.toFixed(2), per_stage: s.spend.stage, limits: s.cfg.budget, video_authorization: s.auth }; });
    reg("estimate_video_cost", "read", "Estimated cost of the videos still to make.", {}, [], async pid => { const todo = (await scenesOf(pid)).filter(sc => !clipOk(sc)); return { scenes: todo.length, estimate: +todo.reduce((a, sc) => a + clipEst(sc), 0).toFixed(2) }; });
    reg("show_media", "read", "Show frames, the storyboard, clips or the final movie in the chat.", { what: { type: "string" } }, ["what"], async (pid, a) => {
      const s = await get(pid), sc = await scenesOf(pid), w = a.what.toLowerCase(), media = [];
      if (/story/.test(w)) { const v = s.sb.versions[s.sb.cur - 1]; if (v && v.sheet) media.push({ asset: v.sheet, kind: "image", caption: "Storyboard v" + v.v, full: true }); }
      else if (/final|movie|export/.test(w)) { if (s.finalAsset) media.push({ asset: s.finalAsset, kind: "video", caption: "Final movie", full: true, download: true }); }
      else if (/video|clip/.test(w)) { const c = sc.filter(x => x.video_asset); if (/latest|last/.test(w)) c.splice(0, c.length - 1); c.forEach(x => media.push({ asset: x.video_asset, kind: "video", caption: `Scene ${sc.indexOf(x) + 1} · ${x.title}`, scene: x.id })); }
      else sc.filter(x => x.start_asset).forEach(x => media.push({ asset: x.start_asset, kind: "image", caption: `Scene ${sc.indexOf(x) + 1} · ${x.title}`, full: true, scene: x.id }));
      if (!media.length) return { error: "Nothing to show yet for that." };
      await say(pid, { type: "gallery", text: media.length + " item(s) from this project:", media }); return { shown: media.length };
    });
    // free writes
    reg("set_settings", "write", "Change production limits: max_concurrent_jobs, max_retries, project_budget, stage budgets.", { max_concurrent_jobs: { type: "integer", min: 1, max: 6 }, max_retries: { type: "integer", min: 0, max: 5 }, project_budget: { type: "number", min: 0.5, max: 200 }, storyboard_budget: { type: "number", min: 0, max: 50 }, frames_budget: { type: "number", min: 0, max: 100 }, characters_budget: { type: "number", min: 0, max: 50 } }, [], async (pid, a) => {
      await mutate(pid, s => { const c = s.cfg; if (a.max_concurrent_jobs) c.maxConcurrent = a.max_concurrent_jobs; if (a.max_retries != null) c.maxRetries = a.max_retries; if (a.project_budget) c.budget.project = a.project_budget; if (a.storyboard_budget != null) c.budget.storyboard = a.storyboard_budget; if (a.frames_budget != null) c.budget.frames = a.frames_budget; if (a.characters_budget != null) c.budget.characters = a.characters_budget; });
      return { ok: true, settings: (await get(pid)).cfg };
    });
    reg("pause_production", "write", "Stop starting new work. Jobs already running on the GPU finish on their own.", {}, [], async pid => { await mutate(pid, s => { s.paused = true; }); await say(pid, { type: "text", text: "Paused. Jobs that already run on the GPU keep running until they finish (they are not cancelled). Say “resume” to continue.", buttons: [{ label: "Resume", act: "resume", ref: {} }] }); });
    reg("resume_production", "write", "Continue after a pause or a stop.", {}, [], async pid => { await mutate(pid, s => { s.paused = false; s.halted = null; }); await say(pid, { type: "text", text: "Resuming." }); advance(pid); });
    reg("cancel_production", "write", "Cancel the production and stop its GPU jobs. Everything already made is kept.", {}, [], async pid => {
      const s = await get(pid); for (const [k, p] of Object.entries(s.pending)) { try { await runpod("POST", "cancel/" + p.id); } catch {} }
      for (const sc of await scenesOf(pid)) if (BUSY.includes(sc.status) && sc.job_id) { try { await runpod("POST", "cancel/" + sc.job_id); } catch {} }
      await mutate(pid, s2 => { s2.state = "CANCELLED"; s2.pending = {}; s2.halted = null; }); await say(pid, { type: "text", text: "Production cancelled. Everything already made is kept in the project and Library. Say “create a movie…” to start again." });
    });
    // storyboard
    async function newVersion(pid, keepPanels) {
      await mutate(pid, s => { const prev = s.sb.versions[s.sb.cur - 1]; const n = s.sb.versions.length + 1; s.sb.versions.push({ v: n, panels: keepPanels && prev ? prev.panels.slice() : [], sheet: "", at: Date.now(), scenes: [] }); s.sb.cur = n; s.state = "STORYBOARD_GENERATING"; s.halted = null; });
      await revoke(pid, a => a.kind === "storyboard");
    }
    reg("edit_scene", "paid", "Change what happens in a scene (e.g. 'make it a nighttime battle'). Only that scene and its own pictures are redone.", { n: { type: "integer", min: 1, max: 40 }, change: { type: "string" } }, ["n", "change"], async (pid, a) => {
      const sc = await sceneN(pid, a.n), s = await get(pid); let action = /^\s*to\s+/i.test(a.change) ? a.change.replace(/^\s*to\s+/i, "") : `${sc.action.replace(/\s*Change:.*$/, "")} Change: ${a.change}`, extra = {};
      if (DIR.llm.on()) { try { const j = await DIR.llm.call({ system: "Rewrite the scene action for an AI video model. Reply with the new action text only: one moment, visible movement only, max 60 words.", messages: [{ role: "user", content: `Current action: ${sc.action}\nRequested change: ${a.change}` }], max: 300 }); const t = (j.content || []).filter(c => c.type === "text").map(c => c.text).join("").trim(); if (t) action = t; } catch {} }
      if (/night/i.test(a.change)) { extra.time_of_day = "night"; extra.lighting = "moonlit night, dramatic rim light"; } if (/day(time)?\b/i.test(a.change) && !/night/i.test(a.change)) extra.time_of_day = "day";
      await saveScene(sc, { action, ...extra }); APP.changed("scenes");
      if (!afterBoard(s)) { await newVersion(pid, true); await mutate(pid, s2 => { s2.sb.versions[s2.sb.cur - 1].panels[a.n - 1] = ""; }); await say(pid, { type: "text", text: `Scene ${a.n} changed. I redraw only its panel and make storyboard v${s.sb.versions.length + 1}; the other panels stay.` }); advance(pid); return { ok: true }; }
      await revoke(pid, x => x.scene === sc.id); await setSettings({ ...sc, action, ...extra }, { dir_redo: true, dir_redo_clip: !!sc.video_asset });
      if (sc.video_asset) await saveScene(await api("scenes/" + sc.id), { video_asset: "", status: "keyframe_ready", settings: { ...(await api("scenes/" + sc.id)).settings, dir_redo: true, clip_history: [...((sc.settings || {}).clip_history || []), sc.video_asset] } });
      await say(pid, { type: "text", text: `Scene ${a.n} changed. Only its start frame${sc.video_asset ? " and video are" : " is"} redone (the old versions stay in the library); the other scenes are untouched. You will be asked to approve the new frame again.` });
      await setState(pid, a.n <= 2 && !afterFrames(s) ? "FIRST_TWO_FRAMES_GENERATING" : "REMAINING_FRAMES_GENERATING"); advance(pid); return { ok: true };
    });
    const afterFrames = s => ["REMAINING_FRAMES_GENERATING", "FRAMES_AWAITING_APPROVAL", "VIDEO_AWAITING_AUTHORIZATION", "VIDEO_GENERATING", "VIDEO_REVIEW", "ASSEMBLING", "FINAL_REVIEW", "COMPLETED"].includes(s.state);
    reg("regenerate_storyboard", "paid", "Draw all storyboard panels again (new version).", { style: { type: "string" } }, [], async (pid, a) => {
      const s = await stateIs(pid, "STORYBOARD_AWAITING_APPROVAL", "FAILED"), est = s.story.scenes.length * COST.qwen_image, why = gate(s, "storyboard", est); if (why) return halt(pid, "budget", "storyboard", why);
      if (a.style) await mutate(pid, s2 => { s2.story.style = a.style; }); await newVersion(pid, false); await say(pid, { type: "text", text: `Drawing a new storyboard (~${APP.money(est)})${a.style ? " in the style: " + a.style : ""}. The previous version is kept.` }); advance(pid);
    });
    reg("regenerate_scene_frame", "paid", "Make a new start frame for one scene (old versions are kept).", { n: { type: "integer", min: 1, max: 40 } }, ["n"], async (pid, a) => {
      const s = await get(pid); if (!afterBoard(s) || !["FIRST_TWO_FRAMES_AWAITING_APPROVAL", "FRAMES_AWAITING_APPROVAL", "VIDEO_AWAITING_AUTHORIZATION", "VIDEO_REVIEW", "FINAL_REVIEW", "REMAINING_FRAMES_GENERATING", "FIRST_TWO_FRAMES_GENERATING"].includes(s.state)) throw new Error("Start frames come after the storyboard and characters are approved.");
      const sc = await sceneN(pid, a.n); await revoke(pid, x => x.scene === sc.id);
      await saveScene(sc, { settings: { ...(sc.settings || {}), dir_redo: true, review: "" }, ...(sc.video_asset ? { video_asset: "", status: "keyframe_ready" } : {}) });
      await say(pid, { type: "text", text: `Making a new start frame for scene ${a.n}. The previous one is kept in its version history.` });
      await setState(pid, a.n <= 2 && s.state.startsWith("FIRST_TWO") ? "FIRST_TWO_FRAMES_GENERATING" : "REMAINING_FRAMES_GENERATING"); advance(pid);
    });
    reg("regenerate_scene_clip", "paid", "Make a new video for one scene (the old clip is kept).", { n: { type: "integer", min: 1, max: 40 } }, ["n"], async (pid, a) => {
      const s = await stateIs(pid, "VIDEO_REVIEW", "FINAL_REVIEW"), sc = await sceneN(pid, a.n); if (!s.auth) throw new Error("Videos are not authorized yet.");
      await saveScene(sc, { video_asset: "", status: "keyframe_ready", settings: { ...(sc.settings || {}), dir_redo_clip: true, clip_history: [...((sc.settings || {}).clip_history || []), ...(sc.video_asset ? [sc.video_asset] : [])] } });
      await say(pid, { type: "text", text: `Making a new video for scene ${a.n} (~${APP.money(clipEst(sc))}, within your authorized video budget).` }); await setState(pid, "VIDEO_GENERATING"); advance(pid);
    });
    // approvals (user only)
    reg("approve_storyboard", "approval", "Approve the current storyboard version.", { v: { type: "integer" }, sheet: { type: "string" } }, ["v"], async (pid, a) => {
      const s = await stateIs(pid, "STORYBOARD_AWAITING_APPROVAL"), cur = s.sb.versions[s.sb.cur - 1]; if (a.v !== cur.v || (a.sheet && a.sheet !== cur.sheet)) throw new Error("That approval was for an older storyboard version. Please look at the latest one.");
      await grant(pid, "storyboard", String(cur.v), { sheet: cur.sheet }); await say(pid, { type: "text", text: `Storyboard v${cur.v} approved. Next I check your character library.` }); await setState(pid, "CHARACTERS_CHECKING"); advance(pid);
    });
    reg("approve_character", "approval", "Save a newly drawn character to the library.", { name: { type: "string" }, face: { type: "string" }, body: { type: "string" } }, ["name"], async (pid, a) => {
      const s = await stateIs(pid, "CHARACTERS_AWAITING_APPROVAL"), c = s.newChars[a.name]; if (!c || c.status !== "awaiting" || (a.face && c.face !== a.face)) throw new Error("That picture was replaced. Please look at the latest one.");
      if (findChar((await api("characters")).items, a.name)) throw new Error(`${a.name} already exists in the library; I never overwrite an existing character.`);
      await api("characters", { name: a.name, kind: "human", description: c.look, refs: [{ asset_id: c.face, role: "primary", label: "Approved face" }, { asset_id: c.body, role: "body", label: "Approved full body" }] });
      await mutate(pid, s2 => { s2.newChars[a.name].status = "saved"; }); await grant(pid, "character", a.name, { face: c.face }); APP.changed("chars");
      await say(pid, { type: "text", text: `${a.name} saved to your library.` });
      const left = Object.values((await get(pid)).newChars).filter(x => x.status !== "saved").length; if (!left) { await attachCharacters(pid); await setState(pid, "FIRST_TWO_FRAMES_GENERATING"); advance(pid); }
    });
    reg("regenerate_character", "paid", "Draw a new reference for a character that is not saved yet.", { name: { type: "string" } }, ["name"], async (pid, a) => {
      const s = await stateIs(pid, "CHARACTERS_AWAITING_APPROVAL"), c = s.newChars[a.name]; if (!c || c.status === "saved") throw new Error("Only characters that are not saved yet can be redrawn.");
      await mutate(pid, s2 => { Object.assign(s2.newChars[a.name], { status: "pending", n: (c.n || 0) + 1 }); }); await setState(pid, "CHARACTERS_GENERATING"); advance(pid);
    });
    reg("approve_first_frames", "approval", "Approve the first two start frames exactly as shown.", { map: { type: "string" } }, ["map"], async (pid, a, origin) => {
      await stateIs(pid, "FIRST_TWO_FRAMES_AWAITING_APPROVAL"); await approveFrames(pid, JSON.parse(a.map)); await say(pid, { type: "text", text: "First two frames approved. Making the rest now." }); await setState(pid, "REMAINING_FRAMES_GENERATING"); advance(pid);
    });
    reg("approve_frames", "approval", "Approve all start frames exactly as shown.", { map: { type: "string" } }, ["map"], async (pid, a) => {
      const s = await stateIs(pid, "FRAMES_AWAITING_APPROVAL"); await approveFrames(pid, JSON.parse(a.map));
      if (s.auth) { const todo = (await scenesOf(pid)).filter(sc => !clipOk(sc)), est = todo.reduce((x, sc) => x + clipEst(sc), 0), why = gate(s, "videos", est); if (!why) { await say(pid, { type: "text", text: "Frames approved. Your earlier video authorization still covers this; making the missing videos." }); await setState(pid, "VIDEO_GENERATING"); return advance(pid); } }
      await say(pid, { type: "text", text: "All frames approved. Nothing has been spent on videos yet." }); await authCard(pid);
    });
    reg("authorize_videos", "approval", "Authorize paid video generation up to a maximum amount.", { max: { type: "number", min: 0.5, max: 200 }, est: { type: "number" } }, ["max"], async (pid, a) => {
      const s = await stateIs(pid, "VIDEO_AWAITING_AUTHORIZATION"); if (a.max > s.cfg.budget.project - s.spend.total + 1e-9) throw new Error(`That is more than the project budget has left (${APP.money(s.cfg.budget.project - s.spend.total)}). Raise the project budget first.`);
      await mutate(pid, s2 => { s2.auth = { max: a.max, at: Date.now() }; }); await grant(pid, "video-spend", String(a.max)); const p = await projectOf(pid); await api("projects", { ...p, data: { ...p.data, approved: true } });
      await say(pid, { type: "text", text: `Authorized: up to ${APP.money(a.max)} for videos. I stop and ask again before going over it.` }); await setState(pid, "VIDEO_GENERATING"); advance(pid);
    });
    reg("set_video_budget", "write", "Change the video budget shown in the authorization card (does not authorize anything).", { max: { type: "number", min: 0.5, max: 200 } }, ["max"], async (pid, a) => { const s = await stateIs(pid, "VIDEO_AWAITING_AUTHORIZATION"); await mutate(pid, s2 => { s2.cfg.budget.project = Math.max(s2.cfg.budget.project, s2.spend.total + a.max); }); await authCard(pid); await say(pid, { type: "text", text: "Press the new Authorize button to confirm; I have not spent anything." }); });
    reg("approve_clips", "approval", "Accept the videos and build the final movie.", { map: { type: "string" } }, ["map"], async (pid, a) => {
      await stateIs(pid, "VIDEO_REVIEW"); const sc = await scenesOf(pid), m = JSON.parse(a.map); for (const [id, asset] of Object.entries(m)) if ((sc.find(x => x.id === id) || {}).video_asset !== asset) throw new Error("A clip changed since you saw it.");
      for (const [id, asset] of Object.entries(m)) await grant(pid, "clip", asset, { scene: id }); await setState(pid, "ASSEMBLING"); advance(pid);
    });
    reg("approve_final", "approval", "Mark the movie as finished.", { asset: { type: "string" } }, [], async (pid, a) => { const s = await stateIs(pid, "FINAL_REVIEW"); if (a.asset && a.asset !== s.finalAsset) throw new Error("That is not the latest export."); await grant(pid, "final", s.finalAsset); await setState(pid, "COMPLETED"); await say(pid, { type: "text", text: "Done. The movie, clips, storyboard and frames are in this project and your Library." }); });
    reg("export_movie", "write", "Build the final movie again from the approved clips.", {}, [], async pid => { await stateIs(pid, "FINAL_REVIEW", "COMPLETED", "VIDEO_REVIEW"); await setState(pid, "ASSEMBLING"); advance(pid); });
    reg("use_available_gpu_workers", "write", "Raise parallel jobs to the number of GPU workers RunPod reports (max 4).", {}, [], async pid => { const g = await APP.refreshGpu(true), w = Object.values(g.workers || {}).reduce((a, b) => a + (+b || 0), 0), n = Math.max(1, Math.min(4, w || 2)); await mutate(pid, s => { s.cfg.maxConcurrent = n; }); await say(pid, { type: "text", text: `I will run up to ${n} jobs at the same time (${g.label || "GPU"}).` }); });

    // ------------------------------------------------------------------ starting a movie
    async function startBrief(pid, text) {
      const chars = (await api("characters")).items, p = await projectOf(pid), brief = DIR.parseBrief(text, chars, p.aspect);
      await mutate(pid, s => { s.brief = brief; s.newChars = {}; s.approvals = s.approvals.filter(a => a.kind === "character"); s.auth = null; s.clipChecks = {}; s.finalAsset = ""; s.halted = null; s.paused = false; });
      const existing = await scenesOf(pid);
      if (existing.some(sc => sc.start_asset || sc.video_asset)) { await say(pid, { type: "text", text: `This project already has ${existing.length} scenes with pictures or videos. A new movie replaces those scenes (their pictures and videos stay in the Library).`, buttons: [{ label: "Replace scenes and start", act: "confirm_replace", ref: { text }, style: "bad" }, { label: "Keep them", act: "dismiss", ref: {} }] }); return; }
      return plan(pid, brief, chars, p);
    }
    async function plan(pid, brief, chars, p) {
      if (brief.aspect !== p.aspect) { await api("projects", { ...p, aspect: brief.aspect, resolution: brief.aspect === "9:16" ? "768x1344" : brief.aspect === "1:1" ? "1024x1024" : "1344x768" }); APP.changed("projects"); }
      await say(pid, { type: "text", text: `Writing the story: ${brief.n} scenes, ${brief.aspect}${brief.names.length ? ", characters " + brief.names.join(", ") : ""}…` });
      const story = await DIR.planStory(pid, brief, chars);
      await mutate(pid, s => { s.story = story; s.sb = { versions: [{ v: 1, panels: [], sheet: "", at: Date.now() }], cur: 1 }; });
      const cur = await scenesOf(pid), lib = chars;
      await api("scenes/import", { project: pid, replace: true, scenes: story.scenes.map(sc => ({ ...sc, characters: (sc.characters || []).map(n => (findChar(lib, n) || {}).id).filter(Boolean) })) });
      APP.changed("all"); const s = await get(pid), est = story.scenes.length * COST.qwen_image;
      await say(pid, { type: "story", text: `“${story.title}” — ${story.scenes.length} scenes${story.by === "llm" ? "" : " (written from a built-in template; add an AI key in Settings → AI Director for fully written stories)"}. Drawing the storyboard now (~${APP.money(est)}, ${est <= s.cfg.budget.storyboard ? "within" : "ABOVE"} the ${APP.money(s.cfg.budget.storyboard)} storyboard limit).`, scenes: story.scenes.map((sc, i) => ({ n: i + 1, title: sc.title, text: sc.action })) });
      await setState(pid, "STORYBOARD_GENERATING"); advance(pid);
    }
    DIR.startBrief = startBrief;

    // ------------------------------------------------------------------ chat agent: with an AI key a real tool-calling loop; without, a rule-based interpreter over the SAME tools
    const approvalFor = async pid => {   // what a plain "approve" means right now (never video spending)
      const s = await get(pid), sc = await scenesOf(pid);
      switch (s.state) {
        case "STORYBOARD_AWAITING_APPROVAL": { const v = s.sb.versions[s.sb.cur - 1]; return ["approve_storyboard", { v: v.v, sheet: v.sheet }]; }
        case "CHARACTERS_AWAITING_APPROVAL": { const c = Object.entries(s.newChars).find(([, x]) => x.status === "awaiting"); return c ? ["approve_character", { name: c[0], face: c[1].face, body: c[1].body }] : null; }
        case "FIRST_TWO_FRAMES_AWAITING_APPROVAL": return ["approve_first_frames", { map: JSON.stringify(Object.fromEntries(sc.slice(0, 2).map(x => [x.id, x.start_asset]))) }];
        case "FRAMES_AWAITING_APPROVAL": return ["approve_frames", { map: JSON.stringify(Object.fromEntries(sc.map(x => [x.id, x.start_asset]))) }];
        case "VIDEO_REVIEW": return ["approve_clips", { map: JSON.stringify(Object.fromEntries(sc.map(x => [x.id, x.video_asset]))) }];
        case "FINAL_REVIEW": return ["approve_final", {}];
      } return null;
    };
    const reply = (pid, text) => say(pid, { type: "text", text });
    async function ruleAgent(pid, text) {
      const t = text.trim(), l = t.toLowerCase(), run = (n, a) => DIR.runTool(pid, n, a, "user_text"), s = await get(pid), er = r => r && r.error ? reply(pid, r.error) : null;
      let m;
      if (/^(yes|y|ok|okay|approve|approved|looks good|go ahead|proceed|continue)\b[.!]*$/.test(l) && !(s.paused && /continue/.test(l))) { const a = await approvalFor(pid); if (a) return er(await run(a[0], a[1])); if (s.state === "VIDEO_AWAITING_AUTHORIZATION") return reply(pid, "Spending on videos needs an explicit authorization: press the Authorize button on the cost card, or type “authorize”."); return reply(pid, "There is nothing waiting for your approval right now."); }
      if (/^authorize\b/.test(l)) { if (s.state !== "VIDEO_AWAITING_AUTHORIZATION") return reply(pid, "Nothing is waiting for video authorization right now."); const mm = l.match(/\$?\s*(\d+(?:\.\d+)?)/), scs = await scenesOf(pid), est = scs.filter(x => !clipOk(x)).reduce((a, x) => a + clipEst(x), 0), max = mm ? +mm[1] : Math.max(0.5, Math.ceil(est * 1.25 * 2) / 2); return er(await run("authorize_videos", { max, est })); }
      if (/^(pause)\b/.test(l)) return run("pause_production"); if (/^(resume|continue)\b/.test(l)) return run("resume_production"); if (/^(cancel|stop)( production)?\b/.test(l)) return run("cancel_production");
      if ((m = l.match(/(?:regenerate|redo|remake|retry)\s+(?:the\s+)?(?:start\s+)?(?:frame\s+(?:of\s+)?)?scene\s+(\d+)/) || l.match(/(?:regenerate|redo|remake)\s+(?:frame|video|clip)\s+(\d+)/))) { const n = +m[1]; if (/video|clip/.test(l)) return er(await run("regenerate_scene_clip", { n })); if (s.state === "STORYBOARD_AWAITING_APPROVAL") return er(await run("edit_scene", { n, change: "to a fresh take on the same moment" })); return er(await run("regenerate_scene_frame", { n })); }
      if (/(regenerate|redo|remake).*storyboard/.test(l)) return er(await run("regenerate_storyboard", {}));
      if ((m = t.match(/change (?:the )?style (?:to|into)\s+(.+)/i))) return er(await run("regenerate_storyboard", { style: m[1] }));
      if ((m = t.match(/^(?:please\s+)?(?:change|edit|make|update|replace|set)\s+scene\s+(\d+)\s*(?:to|so that|so|:|-)?\s*(.+)/i))) return er(await run("edit_scene", { n: +m[1], change: m[2] }));
      if ((m = t.match(/^(.+?)\s+in\s+scene\s+(\d+)\.?$/i))) return er(await run("edit_scene", { n: +m[2], change: m[1].replace(/^(please\s+)?(change|make|update)\s+/i, "") }));
      if (/gpu/.test(l) && /(status|state|worker)/.test(l) && !/use /.test(l)) { const r = await run("gpu_status"); return reply(pid, r.error || `${r.label}. ${r.detail}${r.credit != null ? " Credit: " + APP.money(r.credit) + "." : ""}`); }
      if (/(use|add).*(gpu|worker)/.test(l)) return run("use_available_gpu_workers");
      if (/(how much|spent|spend|cost|budget)/.test(l) && !/set|raise|change/.test(l)) { const r = await run("get_spend"); return reply(pid, r.error || `Spent ${APP.money(r.total)} on this project so far (${Object.entries(r.per_stage).map(([k, v]) => k + " " + APP.money(v)).join(", ") || "nothing yet"}). Limits: project ${APP.money(r.limits.project)}, storyboard ${APP.money(r.limits.storyboard)}, frames ${APP.money(r.limits.frames)}${r.video_authorization ? ", videos " + APP.money(r.video_authorization.max) : ", videos not authorized yet"}.`); }
      if ((m = l.match(/(?:set|raise|change)\s+(?:the\s+)?(video|project|frames?|storyboard)\s+budget\s+(?:to\s+)?\$?(\d+(?:\.\d+)?)/))) { const v = +m[2]; if (m[1] === "video") return er(await run("set_video_budget", { max: v })); return er(await run("set_settings", m[1] === "project" ? { project_budget: v } : m[1] === "storyboard" ? { storyboard_budget: v } : { frames_budget: v })); }
      if ((m = l.match(/(?:max(?:imum)?|set)\s+(?:concurrent|parallel)\s+jobs?\s+(?:to\s+)?(\d+)/))) return er(await run("set_settings", { max_concurrent_jobs: +m[1] }));
      if (/show.*(storyboard)/.test(l)) return er(await run("show_media", { what: "storyboard" })); if (/(show|preview).*(latest|last).*(video|clip)/.test(l)) return er(await run("show_media", { what: "latest video" })); if (/show.*(video|clip)/.test(l)) return er(await run("show_media", { what: "videos" }));
      if (/(show|see).*(all )?(frames|start frames)|gallery/.test(l)) return er(await run("show_media", { what: "frames" })); if (/(show|preview).*(final|movie)/.test(l)) return er(await run("show_media", { what: "final movie" }));
      if (/\bexport\b/.test(l)) return er(await run("export_movie", {}));
      if (/\b(create|make|generate|write|produce)\b.*\b(movie|film|short|story|video)\b/.test(l) || /\b\d+[- ]scene\b/.test(l)) {
        if (!IDLEOK(s.state)) return say(pid, { type: "text", text: `A movie is already in production (${s.state.toLowerCase().replace(/_/g, " ")}). Start a new one? Everything made so far stays in the Library.`, buttons: [{ label: "Start a new movie", act: "restart", ref: { text: t }, style: "bad" }, { label: "Keep going", act: "dismiss", ref: {} }] });
        return startBrief(pid, t);
      }
      return reply(pid, `I did not understand that. ${DIR.llm.on() ? "" : "Without an AI key I only know commands like: “create a 16-scene 9:16 movie about …”, “approve”, “regenerate scene 4”, “change scene 7 to a nighttime battle”, “pause”, “resume”, “show all frames”, “show GPU status”, “how much have I spent?”, “export the movie”. Add an AI key in Settings → AI Director to talk freely."}`);
    }
    const IDLEOK = st => DIR.IDLE.has(st);
    async function llmAgent(pid, text) {
      const s = await get(pid), sc = await scenesOf(pid), tools = Object.values(T).filter(t => t.perm !== "approval").map(t => ({ name: t.name, description: t.desc + (t.perm === "paid" ? " (spends GPU money)" : ""), input_schema: t.schema }));
      const sys = `You are AI Director, the production agent of an AI movie studio, working inside one project. You act through tools; never pretend to have done something a tool did not do. You cannot approve anything: approvals (storyboard, characters, frames, video spending, final) are buttons the user presses; tell them to press the button. To start a movie from a request, call start_movie with the user's words. State: ${s.state}${s.paused ? " (paused)" : ""}${s.halted ? " halted: " + s.halted.why : ""}. Scenes: ${sc.map((x, i) => `${i + 1}. ${x.title}`).join("; ") || "none"}. Spent ${APP.money(s.spend.total)} of ${APP.money(s.cfg.budget.project)}. Keep answers to 1-3 short sentences.`;
      const msgs = s.msgs.filter(m => m.type === "text" && m.text).slice(-10).map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.text })); while (msgs.length && msgs[0].role !== "user") msgs.shift(); if (!msgs.length || msgs[msgs.length - 1].role !== "user") msgs.push({ role: "user", content: text });
      const all = tools.concat([{ name: "start_movie", description: "Plan a new movie from the user's request and start the production (writes the story and draws the storyboard).", input_schema: { type: "object", properties: { request: { type: "string" } }, required: ["request"] } }]);
      for (let step = 0; step < 6; step++) {
        const j = await DIR.llm.call({ system: sys, messages: msgs, tools: all, max: 1200 }); msgs.push({ role: "assistant", content: j.content });
        const calls = (j.content || []).filter(c => c.type === "tool_use");
        if (!calls.length) { const tx = (j.content || []).filter(c => c.type === "text").map(c => c.text).join("\n").trim(); if (tx) await reply(pid, tx); return; }
        const results = []; for (const c of calls) { const r = c.name === "start_movie" ? (IDLEOK((await get(pid)).state) ? (await startBrief(pid, c.input.request || text), { ok: true }) : { error: "A movie is already in production; ask the user to confirm a restart with the button." }) : await DIR.runTool(pid, c.name, c.input, "llm"); results.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(r).slice(0, 2500) }); }
        msgs.push({ role: "user", content: results });
      }
    }
    DIR.handleUser = async (pid, text, media) => {
      await DIR.userSay(pid, text, media);
      try {
        if (DIR.llm.on()) { const l = text.trim().toLowerCase(), a = /^(yes|y|ok|okay|approve|approved|looks good|go ahead|proceed)[.!]*$/.test(l) ? await approvalFor(pid) : null; if (a) { const r = await DIR.runTool(pid, a[0], a[1], "user_text"); if (r.error) await reply(pid, r.error); return; } await llmAgent(pid, text); }
        else await ruleAgent(pid, text);
      } catch (e) { await DIR.mutate(pid, s => { s.errors.push({ at: Date.now(), where: "chat", error: String(e.message || e).slice(0, 300) }); }); await reply(pid, "That failed: " + String((e && e.message) || e).slice(0, 220)); }
    };
    // button presses (the user's explicit approvals); `ref` carries the exact version/asset the button was made for
    DIR.act = async (pid, act, ref, msgId, idx) => {
      const mark = () => msgId != null && DIR.mutate(pid, s => { const m = s.msgs.find(x => x.id === msgId); if (m && m.buttons && m.buttons[idx]) m.buttons[idx].used = true; });
      const run = async (n, a) => { const r = await DIR.runTool(pid, n, a, "ui"); if (r.error) await reply(pid, r.error); else await mark(); return r; };
      switch (act) {
        case "approve_storyboard": return run("approve_storyboard", ref); case "approve_character": return run("approve_character", ref); case "regen_character": return run("regenerate_character", ref);
        case "approve_first": return run("approve_first_frames", { map: JSON.stringify(ref.map) }); case "approve_frames": return run("approve_frames", { map: JSON.stringify(ref.map) });
        case "authorize_videos": return run("authorize_videos", ref); case "approve_clips": return run("approve_clips", { map: JSON.stringify(ref.map) }); case "approve_final": return run("approve_final", ref);
        case "regen_storyboard": return run("regenerate_storyboard", {}); case "regen_frame": return run("regenerate_scene_frame", ref); case "regen_clip": return run("regenerate_scene_clip", ref);
        case "export_again": return run("export_movie", {}); case "resume": return run("resume_production", {});
        case "set_quality": { const s = await get(pid); if (s.state !== "VIDEO_AWAITING_AUTHORIZATION") return reply(pid, "That card is out of date."); for (const sc of await scenesOf(pid)) await setSettings(sc, { quality: ref.q }); await mark(); return authCard(pid); }
        case "raise_budget": { const s = await get(pid), st = ref.stage; await mutate(pid, s2 => { s2.cfg.budget.project = +(s2.cfg.budget.project + 3).toFixed(2); if (st && st !== "videos") s2.cfg.budget[st] = +((s2.cfg.budget[st] || 0) + 2).toFixed(2); if (st === "videos" && s2.auth) { s2.auth.max = +(s2.auth.max + 2).toFixed(2); } s2.halted = null; }); await mark(); await reply(pid, `Limits raised (project ${APP.money(s.cfg.budget.project + 3)}${st && st !== "videos" ? ", " + st + " +$2" : ""}${st === "videos" ? ", videos +$2" : ""}). Continuing.`); return advance(pid); }
        case "retry": await mutate(pid, s => { s.halted = null; s.paused = false; }); await mark(); return advance(pid);
        case "dismiss": return mark();
        case "confirm_replace": { await mark(); const chars = (await api("characters")).items, p = await projectOf(pid), s = await get(pid); await grant(pid, "replace-scenes", String(Date.now())); return plan(pid, s.brief, chars, p); }
        case "restart": { await mark(); await mutate(pid, s => { s.state = "DRAFT"; s.pending = {}; }); return DIR.startBrief(pid, ref.text); }
        case "change_ref": { const s = await get(pid); await reply(pid, "Opening the character editor. Change or add reference photos there, then ask me to regenerate the scene."); const sc = (await scenesOf(pid))[0], c = sc && (await api("characters")).items.find(x => (sc.characters || []).includes(x.id)); if (c && window.SP && SP.editCharacter) SP.editCharacter(c, () => APP.changed("chars")); return; }
      }
    };
    // recover after a reload / reconnect: continue only stages that are mid-run (waiting states stay waiting)
    DIR.resume = async pid => { const s = await get(pid); if (!s.paused && !s.halted && DIR.stages[s.state]) { await advance(pid); } };
    document.dispatchEvent(new Event("dir-ready"));
  };
  if (window.DIR && window.DIR.init2) go(); else document.addEventListener("dir-core-ready", go, { once: true });
})();
