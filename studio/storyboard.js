// Studio Pro storyboard: scene cards per project, continuity-aware prompts, keyframes, videos, approval before GPU spend.
(() => {
  const { api, h, debounce, modal, uploadFiles, thumb, err, loaders, fileB64 } = window.SP;
  const css = document.createElement("style");
  css.textContent = `
  .sb-scene { background:var(--panel); border:1px solid var(--line); border-radius:12px; margin-bottom:12px; overflow:hidden }
  .sb-scene.drag { opacity:.5 } .sb-scene.over { border-color:var(--accent) }
  .sb-head { display:flex; gap:10px; align-items:center; padding:10px 12px; cursor:pointer }
  .sb-grip { cursor:grab; color:var(--muted); user-select:none; padding:0 4px; font-size:18px }
  .sb-head .t { flex:1; min-width:0 } .sb-head .t b { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
  .sb-head .t span { color:var(--muted); font-size:12.5px }
  .sb-th { width:96px; aspect-ratio:16/9; border-radius:6px; background:var(--bg); object-fit:cover; flex:none; display:flex; align-items:center; justify-content:center; color:var(--muted); font-size:11px; overflow:hidden }
  .sb-th img, .sb-th video { width:100%; height:100%; object-fit:cover }
  .sb-st { font-size:11.5px; padding:2px 9px; border-radius:99px; background:var(--soft); color:var(--accent); white-space:nowrap }
  .sb-st.done { background:rgba(31,138,76,.15); color:var(--ok) } .sb-st.failed { background:rgba(192,57,43,.15); color:var(--bad) }
  .sb-body { padding:4px 14px 14px; border-top:1px solid var(--line) }
  .sb-frames { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px; margin-top:8px }
  .sb-frame { border:1px solid var(--line); border-radius:10px; padding:8px; background:var(--bg) } .sb-frame .pic { aspect-ratio:16/9; border-radius:6px; background:var(--panel); display:flex; align-items:center; justify-content:center; color:var(--muted); font-size:13px; overflow:hidden }
  .sb-frame .pic img, .sb-frame .pic video { width:100%; height:100%; object-fit:cover }
  .sb-frame .actions { margin-top:8px }
  .sb-warn { background:var(--soft); border-radius:8px; padding:8px 12px; font-size:13px; margin:8px 0 }
  .sb-pick { display:grid; grid-template-columns:repeat(auto-fill,minmax(110px,1fr)); gap:8px; margin-top:10px }
  .sb-pick div { aspect-ratio:1; border-radius:8px; overflow:hidden; cursor:pointer; border:2px solid transparent; background:var(--bg) } .sb-pick div:hover { border-color:var(--accent) } .sb-pick img { width:100%; height:100%; object-fit:cover }
  @media (max-width:820px) { .sb-th { width:64px } }`;
  document.head.append(css);

  // ---- tab
  const nav = document.getElementById("tabs"), main = (document.getElementById("studio-main") || document.querySelector("main"));
  const btn = h("button", { "data-tab": "storyboard" }, "Storyboard");
  btn.onclick = () => window.showTab("storyboard");
  nav.insertBefore(btn, nav.querySelector('[data-tab="history"]'));
  main.insertBefore(h("section", { class: "tab wide", id: "tab-storyboard" }), document.getElementById("tab-history"));
  try { if (localStorage.getItem("tab") === "storyboard") setTimeout(() => window.showTab("storyboard"), 0); } catch {}

  const SIZE = { "16:9": [1344, 768], "9:16": [768, 1344], "1:1": [1024, 1024], "4:3": [1152, 864], "21:9": [1536, 656] };
  const LABEL = { draft: "Draft", keyframe_generating: "Making start frame…", keyframe_ready: "Start frame ready", queued: "Queued", generating: "Making video…", done: "Video ready", failed: "Failed", cancelled: "Cancelled" };
  const S = { projectId: localStorage.getItem("sb_project") || "", open: new Set(), tracking: new Set(), enhancing: new Set(), idResults: {}, projects: [], chars: [], scenes: [], project: null };
  const root = () => document.getElementById("tab-storyboard");

  const toDataUrl = async url => fileB64(await (await fetch(url)).blob());
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const sameShape = (w, h, W, H) => Math.abs(w / h - W / H) / (W / H) < 0.01;
  // Fit a picture to exactly W x H WITHOUT stretching: one scale factor for both axes. A different shape shows the whole picture and fills the rest with a
  // blurred, enlarged copy of itself (background extension); the same shape is scaled uniformly and trimmed by a few pixels.
  async function fitToShape(url, W, H) {
    const bmp = await createImageBitmap(await (await fetch(url)).blob());
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const g = cv.getContext("2d");
    const cover = Math.max(W / bmp.width, H / bmp.height);
    if (sameShape(bmp.width, bmp.height, W, H)) {
      g.drawImage(bmp, (bmp.width - W / cover) / 2, (bmp.height - H / cover) / 2, W / cover, H / cover, 0, 0, W, H);
    } else {
      const big = cover * 1.12, bw = bmp.width * big, bh = bmp.height * big;  // oversized so the blur has no dark rim
      g.filter = "blur(" + Math.round(Math.max(W, H) / 40) + "px)"; g.drawImage(bmp, (W - bw) / 2, (H - bh) / 2, bw, bh); g.filter = "none";
      const fit = Math.min(W / bmp.width, H / bmp.height), dw = bmp.width * fit, dh = bmp.height * fit;
      g.drawImage(bmp, (W - dw) / 2, (H - dh) / 2, dw, dh);
    }
    return fileB64(await new Promise(r => cv.toBlob(r, "image/png")));
  }
  async function imageSize(url) { const b = await createImageBitmap(await (await fetch(url)).blob()); return [b.width, b.height]; }

  async function pickAsset(kind = "image") {
    return new Promise(async resolve => {
      const m = modal(); let done = false;
      const finish = a => { if (!done) { done = true; m.close(); resolve(a); } };
      const { items } = await api("assets?type=" + kind);
      const grid = h("div", { class: "sb-pick" }, items.map(a => h("div", { onclick: () => finish(a), title: a.filename }, thumb(a))));
      const input = h("input", { type: "file", accept: kind + "/*", hidden: true });
      input.onchange = async () => { const [a] = await uploadFiles([...input.files]); if (a) finish(a); };
      m.firstChild.append(h("div", { class: "sp-bar" }, h("h3", { style: "flex:1" }, "Pick from your assets"), h("button", { class: "sp-btn", onclick: () => finish(null) }, "Cancel"),
        h("button", { class: "sp-btn pri", onclick: () => input.click() }, "Upload"), input), items.length ? grid : h("p", { class: "hint" }, "No images in your library yet. Upload one."));
    });
  }

  window.SP.pickAsset = pickAsset;

  // ---- job tracking (survives reload: the job id and status are stored on the scene)
  async function track(sc, kind) {
    if (S.tracking.has(sc.id)) return;
    S.tracking.add(sc.id);
    try {
      while (true) {
        await sleep(8000);
        let r;
        try { r = await api("../status/" + sc.job_id); } catch (e) { if (String(e.message).includes("404")) { sc = await patch(sc, { status: "failed", error: "The job was lost. Try again." }); break; } continue; }
        if (r.files && r.files.length) {
          const file = r.files.find(f => kind === "video" ? /\.(mp4|webm)$/i.test(f) : /\.(png|jpe?g|webp)$/i.test(f)) || r.files[0];
          const asset = await api("register", { file });
          let note = "";
          if (kind !== "video") {  // check the shape of the new start frame; videos are always fed a correctly shaped copy (see makeVideo)
            try { const [pw, ph] = SIZE[S.project.aspect] || SIZE["16:9"], [iw, ih] = await imageSize(asset.url || ("/media/" + asset.id)); if (!sameShape(iw, ih, pw, ph)) note = `Note: this start frame is ${iw}x${ih} but the project is ${S.project.aspect}. It will be fitted without stretching (background extended) when the video is made.`; } catch {}
          }
          sc = await patch(sc, kind === "video" ? { video_asset: asset.id, status: "done", error: "" } : { start_asset: asset.id, status: "keyframe_ready", error: note });
          break;
        }
        if (r.error) { sc = await patch(sc, { status: String(r.error).toLowerCase().includes("cancel") ? "cancelled" : "failed", error: String(r.error).slice(0, 300) }); break; }
      }
    } finally { S.tracking.delete(sc.id); draw(); }
  }
  const patch = async (sc, ch) => { const n = await api("scenes", { ...sc, ...ch }); const i = S.scenes.findIndex(x => x.id === sc.id); if (i >= 0) S.scenes[i] = n; draw(); return n; };
  const generate = async body => (await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || "Error " + r.status); return j; })).id;

  async function makeKeyframe(sc) {
    const [w, hh] = SIZE[S.project.aspect] || SIZE["16:9"];
    const p = await api(`scenes/${sc.id}/prompt`);
    if (!p.scene_text.trim()) throw new Error("Describe what happens in this scene first (Action).");
    let job;
    if (sc.characters.length) {
      const b = await api("board", { characters: sc.characters, width: w, height: hh });  // the board has the project's shape, so the start frame comes out in that shape
      job = await generate({ tool: "qwen_edit", params: { image: b.image, prompt: b.prompt + " Create a new photorealistic " + S.project.aspect + " photo of these same characters: " + p.scene_text + " Sharp, high detail, no extra people." } });
    } else job = await generate({ tool: "qwen_image", params: { prompt: p.scene_text + " Photorealistic, sharp, high detail.", width: w, height: hh, turbo: true } });
    sc = await patch(sc, { status: "keyframe_generating", job_id: job, error: "" });
    return track(sc, "keyframe");
  }
  async function makeVideo(sc) {
    const idx = S.scenes.findIndex(x => x.id === sc.id), prev = idx > 0 ? S.scenes[idx - 1] : null;
    if (sc.chain_prev && prev && prev.video_asset) {  // continuity: start where the previous scene ended
      const lf = await api("lastframe", { asset_id: prev.video_asset });
      sc = await patch(sc, { start_asset: lf.id });
    }
    if (!sc.start_asset) throw new Error("This scene needs a start frame first.");
    const [w, hh] = SIZE[S.project.aspect] || SIZE["16:9"];
    const p = await api(`scenes/${sc.id}/prompt`);
    const params = { prompt: p.video_prompt, image: await fitToShape(sc.start_asset_url, w, hh), width: w, height: hh, seconds: sc.duration, quality: "high" };  // exactly the video's shape: the model must not resize (stretch) it
    if (sc.end_asset) params.last_image = await fitToShape(sc.end_asset_url, w, hh);
    const job = await generate({ tool: "minimax_h3", params });
    sc = await patch(sc, { status: "generating", job_id: job, error: "" });
    return track(sc, "video");
  }
  // SeedVR2 video upscale (short side 1080). Clips must stay under about 7 MB (RunPod's input limit). The original stays in Assets.
  async function enhanceScene(sc) {
    if (!sc.video_asset) throw new Error("This scene has no video yet.");
    if ((sc.settings || {}).enhanced) throw new Error("This video is already enhanced.");
    const blob = await (await fetch(sc.video_asset_url)).blob();
    if (blob.size > 7 * 1048576) throw new Error("This clip is " + (blob.size / 1048576).toFixed(1) + " MB; the upscaler takes up to about 7 MB. Trim it in the editor first.");
    S.enhancing.add(sc.id); draw();
    try {
      const media = await fileB64(blob);
      const asset = await window.SP.runJob("seedvr2_upscale", { prompt: "enhance", kind: "video", media, media_ext: ".mp4", resolution: 1080 }, () => {}, /\.(mp4|webm)$/i);
      sc = await patch(sc, { video_asset: asset.id, settings: { ...(sc.settings || {}), enhanced: true, original_video: sc.video_asset } });
    } finally { S.enhancing.delete(sc.id); draw(); }
  }
  const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { err(e); } };

  // ---- UI
  function sceneCard(sc, i) {
    const open = S.open.has(sc.id), busy = ["keyframe_generating", "generating", "queued"].includes(sc.status);
    const auto = debounce(async () => { const n = await api("scenes", sc); S.scenes[S.scenes.findIndex(x => x.id === sc.id)] = { ...n }; head.querySelector(".t b").textContent = n.title || "Untitled scene"; }, 700);
    const field = (key, label, ph = "", area = false) => {
      const el = area ? h("textarea", { style: "min-height:64px", placeholder: ph }, sc[key] || "") : h("input", { type: "text", value: sc[key] || "", placeholder: ph });
      el.oninput = () => { sc[key] = el.value; auto(); };
      return h("div", {}, h("label", {}, label), el);
    };
    const thumbEl = sc.video_asset_url ? h("video", { src: sc.video_asset_url + "#t=0.3", muted: true, preload: "metadata" }) : sc.start_asset_url ? h("img", { src: sc.start_asset_url }) : "no frame";
    const head = h("div", { class: "sb-head", onclick: e => { if (e.target.closest(".sb-grip,button")) return; open ? S.open.delete(sc.id) : S.open.add(sc.id); draw(); } },
      h("span", { class: "sb-grip", draggable: true, title: "Drag to reorder" }, "⋮⋮"),
      h("div", { class: "sb-th" }, thumbEl),
      h("div", { class: "t" }, h("b", {}, sc.title || "Untitled scene"), h("span", {}, `${i + 1} · ${sc.duration}s${sc.location ? " · " + sc.location : ""}`)),
      h("span", { class: "sb-st " + (sc.status === "done" ? "done" : sc.status === "failed" ? "failed" : "") }, LABEL[sc.status] || sc.status),
      h("button", { class: "sp-btn", title: "Move up", onclick: guard(() => move(i, -1)) }, "▲"), h("button", { class: "sp-btn", title: "Move down", onclick: guard(() => move(i, 1)) }, "▼"));
    const card = h("div", { class: "sb-scene", "data-id": sc.id }, head);
    const grip = head.querySelector(".sb-grip");
    grip.ondragstart = e => { e.dataTransfer.setData("text/plain", sc.id); card.classList.add("drag"); };
    grip.ondragend = () => card.classList.remove("drag");
    card.ondragover = e => { e.preventDefault(); card.classList.add("over"); };
    card.ondragleave = () => card.classList.remove("over");
    card.ondrop = guard(async e => { e.preventDefault(); card.classList.remove("over"); const from = e.dataTransfer.getData("text/plain"); if (!from || from === sc.id) return;
      const ids = S.scenes.map(x => x.id).filter(x => x !== from); ids.splice(ids.indexOf(sc.id), 0, from); await reorder(ids); });
    if (!open) return card;

    const chars = h("div", { class: "sp-pick" }, S.chars.map(c => { const b = h("button", { class: "sp-btn" + (sc.characters.includes(c.id) ? " on" : ""), type: "button" }, c.thumb ? h("img", { src: c.thumb }) : null, c.name);
      b.onclick = () => { const k = sc.characters.indexOf(c.id); k < 0 ? sc.characters.push(c.id) : sc.characters.splice(k, 1); b.classList.toggle("on", k < 0); auto(); }; return b; }));
    const dur = h("input", { type: "number", min: 2, max: 60, value: sc.duration }); dur.oninput = () => { sc.duration = +dur.value || 6; auto(); };
    const frame = (label, key, extra) => h("div", { class: "sb-frame" }, h("b", { style: "font-size:13px" }, label),
      h("div", { class: "pic" }, sc[key + "_url"] ? h("img", { src: sc[key + "_url"] }) : "none"),
      h("div", { class: "actions" }, h("button", { class: "sp-btn", onclick: guard(async () => { const a = await pickAsset(); if (a) await patch(sc, { [key]: a.id, status: key === "start_asset" && sc.status === "draft" ? "keyframe_ready" : sc.status }); }) }, "Pick / upload"),
        sc[key] ? h("button", { class: "sp-btn", onclick: guard(() => patch(sc, { [key]: "" })) }, "Clear") : null, extra));
    const dirRow = () => { sc.settings = sc.settings || {}; sc.settings.director = sc.settings.director || {};
      return h("div", {}, h("label", {}, "Director (prompt-based, the model may follow loosely)"), h("div", { class: "sp-three" }, Object.entries(S.presets || {}).map(([g, def]) => {
        const sel = h("select", { title: def.label }, [h("option", { value: "" }, def.label + ": project default"), ...def.items.map(it => h("option", { value: it.id, selected: sc.settings.director[g] === it.id }, it.label))]);
        sel.onchange = () => { if (sel.value) sc.settings.director[g] = sel.value; else delete sc.settings.director[g]; auto(); }; return sel; }))); };
    const chain = h("label", { class: "check", style: "margin-top:8px" }, h("input", { type: "checkbox", checked: !!sc.chain_prev }), " Start from the previous scene's last frame (continuity)");
    chain.firstChild.onchange = e => { sc.chain_prev = e.target.checked ? 1 : 0; auto(); };
    card.append(h("div", { class: "sb-body" },
      h("div", { class: "sp-two" }, field("title", "Scene title"), h("div", {}, h("label", {}, "Duration (seconds)"), dur)),
      field("purpose", "Story purpose", "Why this scene exists in the story"),
      h("div", { class: "sp-three" }, field("location", "Location", "hallway"), field("time_of_day", "Time of day", "morning"), field("lighting", "Lighting", "warm, soft")),
      field("props", "Props", "golden key"), h("label", {}, "Characters in this scene"), chars,
      field("action", "What happens: describe visible movement (e.g. \"Hessa sits up and stretches her arms\")", "", true),
      h("div", { class: "sp-two" }, field("camera", "Camera movement", "slow push-in, tracking shot"), field("dialogue", "Dialogue")),
      h("div", { class: "sp-two" }, field("sfx", "Sound effects"), field("music", "Music cue")),
      dirRow(), chain,
      h("div", { class: "sb-frames" },
        frame("Start frame", "start_asset", h("button", { class: "sp-btn pri", disabled: busy, onclick: guard(() => makeKeyframe(sc)) }, sc.characters.length ? "Generate from characters" : "Generate")),
        frame("End frame (optional)", "end_asset"),
        h("div", { class: "sb-frame" }, h("b", { style: "font-size:13px" }, "Video"), h("div", { class: "pic" }, sc.video_asset_url ? h("video", { src: sc.video_asset_url, controls: true }) : LABEL[sc.status] || ""),
          h("div", { class: "actions" },
            h("button", { class: "sp-btn pri", disabled: busy || !S.project.data.approved, title: S.project.data.approved ? "" : "Approve the storyboard first", onclick: guard(async () => { if (confirm(`Make a ${sc.duration}s video on the GPU? This uses RunPod credit (about 7 minutes of GPU).`)) await makeVideo(sc); }) }, sc.video_asset ? "Regenerate video" : "Generate video"),
            sc.video_asset ? ((sc.settings || {}).enhanced
              ? h("button", { class: "sp-btn", title: "Go back to the original video", onclick: guard(async () => { await patch(sc, { video_asset: sc.settings.original_video, settings: { ...sc.settings, enhanced: false, original_video: "" } }); }) }, "Use original")
              : h("button", { class: "sp-btn", disabled: busy || S.enhancing.has(sc.id), title: "Upscale to 1080p with SeedVR2 on the GPU", onclick: guard(async () => { if (confirm("Enhance this video to 1080p on the GPU? (RunPod credit, a few minutes)")) await enhanceScene(sc); }) }, S.enhancing.has(sc.id) ? "Enhancing…" : "Enhance to 1080p")) : null,
            busy && sc.job_id ? h("button", { class: "sp-btn bad", onclick: guard(async () => { await fetch("/api/cancel/" + sc.job_id, { method: "POST" }); }) }, "Cancel") : null))),
      sc.error ? h("p", { class: "sb-warn", style: "color:var(--bad)" }, sc.error) : null,
      S.idResults[sc.id] ? h("p", { class: "sb-warn" }, S.idResults[sc.id]) : null,
      h("div", { class: "actions" },
        h("button", { class: "sp-btn", onclick: guard(async () => { await api(`scenes/${sc.id}/duplicate`, {}); load(); }) }, "Duplicate"),
        sc.characters.length && (sc.video_asset || sc.start_asset) ? h("button", { class: "sp-btn", title: "Compare faces in this shot with the characters' reference photos (runs on this PC)", onclick: guard(async () => {
          S.idResults[sc.id] = "Checking faces…"; draw();
          try {
            const r = await api("identity", { scene_id: sc.id });
            S.idResults[sc.id] = !r.available ? (window.StudioBackend ? r.install : "Face matching is not installed on this PC. Install it with: " + r.install)
              : r.faces_found ? "Face check (" + r.faces_found + " face(s) seen): " + r.results.map(x => x.similarity == null ? x.character + ": " + x.note : `${x.character} ${x.similarity.toFixed(2)} ${x.verdict === "match" ? "✓ clear match" : x.verdict === "low" ? "⚠ low: look at this shot" : "? uncertain (side view or similar faces)"}`).join(" · ") + ". Only clear front views are reliable; treat this as a hint."
              : "No face found in this shot, so it could not be checked.";
          } catch (e) { S.idResults[sc.id] = "Check failed: " + e.message; }
          draw(); }) }, "Check identities") : null,
        h("button", { class: "sp-btn bad", onclick: guard(async () => { if (confirm("Delete this scene?")) { await api(`scenes/${sc.id}/delete`, {}); load(); } }) }, "Delete"))));
    return card;
  }
  async function move(i, d) { const ids = S.scenes.map(x => x.id), j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; await reorder(ids); }
  async function reorder(ids) { S.scenes = (await api("scenes/reorder", { project: S.projectId, ids })).items; draw(); }

  async function setApproved(v) { const p = S.project; S.project = await api("projects", { ...p, data: { ...p.data, approved: v } }); draw(); }

  function draw() {
    const r = root(); if (!r) return;
    const total = S.scenes.reduce((a, s) => a + (s.duration || 0), 0), p = S.project;
    const sel = h("select", { style: "max-width:260px" }, [h("option", { value: "" }, "Choose a project…"), ...S.projects.map(x => h("option", { value: x.id, selected: x.id === S.projectId }, x.name))]);
    sel.onchange = () => { S.projectId = sel.value; try { localStorage.setItem("sb_project", S.projectId); } catch {} load(); };
    const bar = h("div", { class: "sp-bar" }, h("h2", {}, "Storyboard"), sel);
    r.replaceChildren(bar);
    if (!p) { r.append(h("p", { class: "sp-empty" }, S.projects.length ? "Choose a project to see its scenes." : "Create a project first (Projects tab).")); return; }
    const approved = !!p.data.approved;
    bar.append(
      h("button", { class: "sp-btn", onclick: guard(planDialog) }, "Auto-plan scenes"), h("button", { class: "sp-btn", onclick: guard(importDialog) }, "Import scenes"),
      h("button", { class: "sp-btn", onclick: guard(async () => { const s = await api("scenes", { project_id: S.projectId, title: "New scene", characters: p.characters }); S.open.add(s.id); await load(); }) }, "+ Scene"));
    r.append(h("div", { class: "sb-warn" }, `${S.scenes.length} scene${S.scenes.length === 1 ? "" : "s"} · ${total}s planned of ${p.duration}s target`,
      total > p.duration * 1.15 || total < p.duration * 0.85 ? " — duration differs from the target." : ""),
      h("div", { class: "sp-bar" }, h("label", { class: "check", style: "margin:0" }, (() => { const c = h("input", { type: "checkbox", checked: approved }); c.onchange = guard(() => setApproved(c.checked)); return c; })(),
        " Storyboard approved — allows spending GPU time on videos"),
        h("button", { class: "sp-btn pri", disabled: !approved || !S.scenes.length, onclick: guard(generateAll) }, "Generate all videos")));
    if (!S.scenes.length) r.append(h("p", { class: "sp-empty" }, "No scenes yet. Use Auto-plan, Import scenes, or + Scene."));
    S.scenes.forEach((sc, i) => r.append(sceneCard(sc, i)));
  }

  async function generateAll() {
    const todo = S.scenes.filter(s => s.status !== "done");
    if (!todo.length) return alert("All scenes already have videos.");
    if (!confirm(`Generate ${todo.length} video${todo.length === 1 ? "" : "s"} one after another?\nAbout 7 minutes of GPU each (${Math.round(todo.length * 7)} min, uses RunPod credit). Keep this page open; each scene's progress is saved.`)) return;
    for (const s0 of todo) {
      let sc = S.scenes.find(x => x.id === s0.id);
      if (!sc.start_asset && !(sc.chain_prev && S.scenes.findIndex(x => x.id === sc.id) > 0)) { await makeKeyframe(sc); sc = S.scenes.find(x => x.id === s0.id); if (sc.status === "failed") return alert("Stopped: " + sc.error); }
      await makeVideo(sc); sc = S.scenes.find(x => x.id === s0.id);
      if (sc.status !== "done") return alert("Stopped at '" + (sc.title || "scene") + "': " + (sc.error || sc.status));
    }
  }

  // used by the Workflows runner: same functions as the buttons, sequential, stop on the first failure
  window.SP.sb = {
    async use(pid) { S.projectId = pid; await load(); },
    async keyframes() {
      let n = 0;
      for (const s0 of [...S.scenes]) {
        let sc = S.scenes.find(x => x.id === s0.id), i = S.scenes.indexOf(sc);
        if (sc.start_asset || (sc.chain_prev && i > 0)) continue;
        await makeKeyframe(sc); sc = S.scenes.find(x => x.id === s0.id); n++;
        if (sc.status === "failed") throw new Error("Start frame failed for '" + (sc.title || "scene") + "': " + sc.error);
      }
      return n;
    },
    async videos() {
      let n = 0;
      for (const s0 of [...S.scenes]) {
        let sc = S.scenes.find(x => x.id === s0.id);
        if (sc.status === "done") continue;
        await makeVideo(sc); sc = S.scenes.find(x => x.id === s0.id); n++;
        if (sc.status !== "done") throw new Error("Video failed for '" + (sc.title || "scene") + "': " + (sc.error || sc.status));
      }
      return n;
    },
    async enhance() {
      let n = 0;
      for (const s0 of [...S.scenes]) {
        const sc = S.scenes.find(x => x.id === s0.id);
        if (!sc.video_asset || (sc.settings || {}).enhanced) continue;
        await enhanceScene(sc); n++;
      }
      return n;
    },
    scenes: () => S.scenes,
    async approve(v) { await setApproved(v); },
  };

  function planDialog() {
    const m = modal(); const idea = h("textarea", { placeholder: "Your idea in a sentence or two (optional)", style: "min-height:90px" }, S.project.story || "");
    const secs = h("select", {}, [15, 30, 60, 90, 120].map(d => h("option", { value: d, selected: d === S.project.duration }, d + " s")));
    const custom = h("input", { type: "number", placeholder: "or custom seconds", min: 6 }), clip = h("select", {}, [4, 5, 6, 8, 10].map(d => h("option", { value: d, selected: d === 6 }, d + " s per scene")));
    m.firstChild.append(h("h3", {}, "Auto-plan scenes"),
      h("p", { class: "hint" }, "Builds a story skeleton: one card per story beat (introduction → ending), sized to your target length. It is a template, not AI-written: you write the details. For a written story, ask any chat assistant for JSON and use Import scenes."),
      h("label", {}, "Idea"), idea, h("div", { class: "sp-three" }, h("div", {}, h("label", {}, "Movie length"), secs), h("div", {}, h("label", {}, "Custom"), custom), h("div", {}, h("label", {}, "Scene length"), clip)),
      h("div", { class: "actions" }, h("button", { class: "sp-btn pri", onclick: guard(async () => {
        if (S.scenes.length && !confirm("This adds scenes after the existing ones. Continue?")) return;
        await api("scenes/plan", { project: S.projectId, idea: idea.value, seconds: +custom.value || +secs.value, clip: +clip.value, characters: S.project.characters });
        m.close(); load(); }) }, "Create scenes"), h("button", { class: "sp-btn", onclick: m.close }, "Cancel")));
  }
  function importDialog() {
    const m = modal(); const ta = h("textarea", { style: "min-height:220px;font-family:monospace;font-size:12.5px", placeholder: '[{"title":"Hessa wakes up","duration":6,"location":"bedroom","time_of_day":"morning","action":"Hessa stretches in bed","camera":"slow push-in","dialogue":"","sfx":"birds","music":"soft piano"}]' });
    const rep = h("input", { type: "checkbox" });
    m.firstChild.append(h("h3", {}, "Import scenes"), h("p", { class: "hint" }, "Paste a JSON list of scenes (title, purpose, duration, location, time_of_day, lighting, props, action, camera, dialogue, sfx, music). Characters of the project are added to each scene."),
      ta, h("label", { class: "check" }, rep, " Replace existing scenes"),
      h("div", { class: "actions" }, h("button", { class: "sp-btn pri", onclick: guard(async () => {
        let items; try { items = JSON.parse(ta.value); } catch { throw new Error("That is not valid JSON."); }
        if (!Array.isArray(items)) throw new Error("Expected a list: [ {...}, {...} ]");
        items = items.map(x => ({ ...x, characters: x.characters || S.project.characters }));
        await api("scenes/import", { project: S.projectId, scenes: items, replace: rep.checked }); m.close(); load(); }) }, "Import"), h("button", { class: "sp-btn", onclick: m.close }, "Cancel")));
  }

  async function load() {
    S.projects = (await api("projects")).items; S.chars = (await api("characters")).items; if (!S.presets) S.presets = await api("director");
    S.project = S.projectId ? S.projects.find(p => p.id === S.projectId) || null : null;
    S.scenes = S.project ? (await api("scenes?project=" + S.projectId)).items : [];
    draw();
    for (const sc of S.scenes) if (sc.job_id && ["keyframe_generating", "generating", "queued"].includes(sc.status)) track(sc, sc.status === "generating" ? "video" : "keyframe");
  }
  loaders.storyboard = () => load().catch(err);
})();
