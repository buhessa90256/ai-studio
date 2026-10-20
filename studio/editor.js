// Studio Pro editor: video track, extra audio tracks, text overlays/subtitles, preview, and FFmpeg export on the PC.
(() => {
  const { api, h, debounce, err, loaders, fmtSize } = window.SP;
  const css = document.createElement("style");
  css.textContent = `
  .ed-wrap { display:grid; grid-template-columns:minmax(300px,520px) 1fr; gap:18px } @media (max-width:900px){ .ed-wrap { grid-template-columns:1fr } }
  .ed-prev video { width:100%; border-radius:10px; background:#000; display:block; max-height:46vh }
  .ed-lane { position:relative; height:64px; background:var(--bg); border:1px solid var(--line); border-radius:8px; margin:6px 0; overflow:hidden }
  .ed-scroll { overflow-x:auto; padding-bottom:4px } .ed-track { display:flex; gap:2px; min-height:64px }
  .ed-clip { height:64px; border-radius:6px; background:var(--soft); border:2px solid var(--line); padding:4px 6px; font-size:11.5px; overflow:hidden; cursor:pointer; flex:none; position:relative; user-select:none }
  .ed-clip.sel { border-color:var(--accent) } .ed-clip.over { outline:2px dashed var(--accent) } .ed-clip b { display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
  .ed-clip .tr { position:absolute; right:0; top:0; bottom:0; width:6px; background:var(--accent); opacity:.6 }
  .ed-blk { position:absolute; top:6px; height:50px; border-radius:6px; background:rgba(31,138,76,.25); border:1px solid var(--ok); font-size:11px; padding:2px 6px; overflow:hidden; white-space:nowrap }
  .ed-row { display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:8px; align-items:end }
  .ed-item { border:1px solid var(--line); border-radius:10px; padding:10px; margin-bottom:8px; background:var(--panel) }
  .ed-item label { margin-top:6px; font-size:12px }`;
  document.head.append(css);

  const nav = document.getElementById("tabs"), main = (document.getElementById("studio-main") || document.querySelector("main"));
  const btn = h("button", { "data-tab": "editor" }, "Editor");
  btn.onclick = () => window.showTab("editor");
  nav.insertBefore(btn, nav.querySelector('[data-tab="history"]'));
  main.insertBefore(h("section", { class: "tab wide", id: "tab-editor" }), document.getElementById("tab-history"));
  try { if (localStorage.getItem("tab") === "editor") setTimeout(() => window.showTab("editor"), 0); } catch {}

  const E = { projectId: localStorage.getItem("sb_project") || "", tl: { clips: [], audio: [], texts: [] }, sel: null, zoom: 40, projects: [], playing: false };
  const uid = () => Math.random().toString(36).slice(2, 10);
  const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
  const dur = c => Math.max(0, c.out - c.in);
  const total = () => E.tl.clips.reduce((a, c, i) => a + dur(c) - (i < E.tl.clips.length - 1 ? Math.min(c.transition || 0, dur(c)) : 0), 0);
  const save = debounce(async () => { try { E.tl = await api("timeline", { project: E.projectId, timeline: E.tl }); status.textContent = "Saved ✓"; } catch (e) { status.textContent = "Not saved: " + e.message; } }, 600);
  const status = h("span", { class: "sp-saved" });
  const changed = (redraw = true) => { status.textContent = "Saving…"; save(); if (redraw) draw(); };
  const field = (label, value, onchange, attrs = {}) => { const i = h("input", { type: "number", step: "0.1", value, ...attrs }); i.onchange = () => onchange(num(i.value)); return h("div", {}, h("label", {}, label), i); };
  const mm = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}.${String(Math.floor((s % 1) * 10))}`;

  let video;
  function loadClip(c, startAt) {
    if (!video) return;
    video.src = c.url + "#t=" + c.in; video.dataset.clip = c.id;
    video.onloadedmetadata = () => { video.currentTime = startAt ?? c.in; };
  }
  async function playAll() {
    const clips = E.tl.clips; if (!clips.length) return;
    E.playing = true;
    for (const c of clips) {
      if (!E.playing) break;
      await new Promise(res => {
        video.src = c.url; video.onloadedmetadata = () => { video.currentTime = c.in; video.play(); };
        video.ontimeupdate = () => { if (video.currentTime >= c.out - 0.03 || !E.playing) { video.pause(); video.ontimeupdate = null; res(); } };
        video.onended = res;
      });
    }
    E.playing = false;
  }

  function draw() {
    const root = document.getElementById("tab-editor");
    const sel = h("select", { style: "max-width:240px" }, [h("option", { value: "" }, "Choose a project…"), ...E.projects.map(p => h("option", { value: p.id, selected: p.id === E.projectId }, p.name))]);
    sel.onchange = () => { E.projectId = sel.value; try { localStorage.setItem("sb_project", E.projectId); } catch {} load(); };
    root.replaceChildren(h("div", { class: "sp-bar" }, h("h2", {}, "Editor"), sel, status));
    if (!E.projectId) { root.append(h("p", { class: "sp-empty" }, "Choose a project.")); return; }
    const c = E.tl.clips.find(x => x.id === E.sel);
    video = h("video", { controls: true, playsinline: true });
    if (c) loadClip(c);
    const exportBox = h("div", { id: "ed-export" });
    const left = h("div", { class: "ed-prev" }, video,
      h("div", { class: "actions" },
        h("button", { class: "sp-btn", onclick: () => playAll() }, "▶ Play timeline (video)"), h("button", { class: "sp-btn", onclick: () => { E.playing = false; video.pause(); } }, "Stop")),
      h("p", { class: "hint" }, `${E.tl.clips.length} clip${E.tl.clips.length === 1 ? "" : "s"} · ${mm(total())} long. The preview plays the video clips only; music, text and fades are in the exported file.`),
      h("div", { class: "card", style: "margin-top:10px" }, h("b", {}, "Export"), h("div", { class: "actions" },
        h("button", { class: "sp-btn pri", onclick: () => doExport(false, exportBox) }, "Export MP4 (source size)"), h("button", { class: "sp-btn", onclick: () => doExport(true, exportBox) }, "Export 1080p")), exportBox));

    // video track
    const track = h("div", { class: "ed-track" }, E.tl.clips.map((k, i) => {
      const el = h("div", { class: "ed-clip" + (k.id === E.sel ? " sel" : ""), draggable: true, style: `width:${Math.max(56, dur(k) * E.zoom)}px`, title: k.name, onclick: () => { E.sel = k.id; draw(); } },
        h("b", {}, `${i + 1}. ${k.name}`), `${mm(dur(k))}`, k.transition ? h("span", { class: "tr", title: "transition to next" }) : null);
      el.ondragstart = e => e.dataTransfer.setData("text/plain", String(i));
      el.ondragover = e => { e.preventDefault(); el.classList.add("over"); }; el.ondragleave = () => el.classList.remove("over");
      el.ondrop = e => { e.preventDefault(); const from = +e.dataTransfer.getData("text/plain"); if (from === i) return; const [m] = E.tl.clips.splice(from, 1); E.tl.clips.splice(i, 0, m); changed(); };
      return el;
    }));
    const zoom = h("input", { type: "range", min: 10, max: 120, value: E.zoom, style: "max-width:160px" }); zoom.oninput = () => { E.zoom = +zoom.value; draw(); };
    const audioLane = h("div", { class: "ed-lane" }, E.tl.audio.map(a => h("div", { class: "ed-blk", style: `left:${a.start * E.zoom}px;width:${Math.max(30, (a.out - a.in) * E.zoom)}px` }, `♪ ${a.kind}: ${a.name}`)),
      E.tl.texts.map(t => h("div", { class: "ed-blk", style: `left:${t.start * E.zoom}px;width:${Math.max(30, t.dur * E.zoom)}px;top:34px;height:22px;background:rgba(91,79,224,.25);border-color:var(--accent)` }, "T " + t.text)));
    const tools = h("div", { class: "actions" },
      h("button", { class: "sp-btn", onclick: guard(async () => { E.tl = await api("timeline/from_scenes", { project: E.projectId, replace: true }); E.sel = null; draw(); }) }, "Fill from scene videos"),
      h("button", { class: "sp-btn", onclick: guard(async () => { const a = await window.SP.pickAsset("video"); if (!a) return; E.tl.clips.push({ id: uid(), asset_id: a.id, in: 0, out: 0, transition: 0 }); E.tl = await api("timeline", { project: E.projectId, timeline: { ...E.tl, clips: E.tl.clips.map(k => k.out ? k : { ...k, out: 9999 }) } }); draw(); }) }, "+ Video clip"),
      h("label", { style: "margin:0;display:flex;align-items:center;gap:6px;font-weight:400" }, "Zoom", zoom));

    // selected clip editor
    let inspector = h("p", { class: "hint" }, "Click a clip to trim, split or fade it. Drag clips to reorder.");
    if (c) {
      const i = E.tl.clips.indexOf(c);
      inspector = h("div", { class: "ed-item" }, h("b", {}, `Clip ${i + 1}: ${c.name}`), h("div", { class: "ed-row" },
        field("Trim start (s)", c.in, v => { c.in = Math.min(Math.max(0, v), c.out - 0.2); changed(); }), field("Trim end (s)", c.out, v => { c.out = Math.min(Math.max(c.in + 0.2, v), c.duration); changed(); }),
        field("Fade in (s)", c.fade_in || 0, v => { c.fade_in = Math.max(0, v); changed(false); }), field("Fade out (s)", c.fade_out || 0, v => { c.fade_out = Math.max(0, v); changed(false); }),
        field("Crossfade to next (s)", c.transition || 0, v => { c.transition = Math.max(0, Math.min(v, 3)); changed(); }), field("Volume", c.volume ?? 1, v => { c.volume = Math.max(0, v); changed(false); })),
        h("div", { class: "actions" },
          h("button", { class: "sp-btn", onclick: () => { const t = video.currentTime; if (video.dataset.clip !== c.id || t <= c.in + 0.2 || t >= c.out - 0.2) return alert("Move the preview to the split point inside this clip first (play or drag the slider)."); const b = { ...c, id: uid(), in: t, fade_in: 0 }; c.out = t; c.fade_out = 0; c.transition = 0; E.tl.clips.splice(i + 1, 0, b); E.sel = b.id; changed(); } }, "Split at preview time"),
          h("button", { class: "sp-btn", onclick: () => { E.tl.clips.push({ ...c, id: uid() }); changed(); } }, "Duplicate"),
          h("button", { class: "sp-btn bad", onclick: () => { E.tl.clips.splice(i, 1); E.sel = null; changed(); } }, "Remove clip")));
    }

    // audio + text
    const audioItems = E.tl.audio.map((a, i) => h("div", { class: "ed-item" }, h("b", {}, `${a.kind}: ${a.name}`), h("div", { class: "ed-row" },
      field("Starts at (s)", a.start, v => { a.start = Math.max(0, v); changed(); }), field("From (s)", a.in, v => { a.in = Math.max(0, v); changed(); }), field("To (s)", a.out, v => { a.out = Math.max(a.in + 0.2, Math.min(v, a.duration)); changed(); }),
      field("Volume", a.volume, v => { a.volume = Math.max(0, v); changed(false); }), field("Fade in", a.fade_in, v => { a.fade_in = Math.max(0, v); changed(false); }), field("Fade out", a.fade_out, v => { a.fade_out = Math.max(0, v); changed(false); })),
      h("div", { class: "actions" }, h("button", { class: "sp-btn bad", onclick: () => { E.tl.audio.splice(i, 1); changed(); } }, "Remove"))));
    const textItems = E.tl.texts.map((t, i) => { const ti = h("input", { type: "text", value: t.text, dir: "auto" }); ti.onchange = () => { t.text = ti.value; changed(); };
      const pos = h("select", {}, ["top", "center", "bottom"].map(p => h("option", { value: p, selected: p === t.pos }, p))); pos.onchange = () => { t.pos = pos.value; changed(false); };
      const kind = h("select", {}, ["text", "subtitle"].map(p => h("option", { value: p, selected: p === t.kind }, p))); kind.onchange = () => { t.kind = kind.value; changed(false); };
      return h("div", { class: "ed-item" }, h("label", {}, "Text"), ti, h("div", { class: "ed-row" }, field("Shows at (s)", t.start, v => { t.start = Math.max(0, v); changed(); }), field("For (s)", t.dur, v => { t.dur = Math.max(0.2, v); changed(); }),
        field("Size", t.size, v => { t.size = v; changed(false); }, { step: 2 }), h("div", {}, h("label", {}, "Position"), pos), h("div", {}, h("label", {}, "Kind"), kind)),
        h("div", { class: "actions" }, h("button", { class: "sp-btn bad", onclick: () => { E.tl.texts.splice(i, 1); changed(); } }, "Remove"))); });
    const right = h("div", {}, tools, h("div", { class: "ed-scroll" }, h("b", { style: "font-size:13px" }, "Video"), track, h("b", { style: "font-size:13px" }, "Audio & text"), audioLane), inspector,
      h("h3", { style: "margin:16px 0 6px" }, "Audio tracks"), ...audioItems,
      h("div", { class: "actions" }, h("button", { class: "sp-btn", onclick: guard(async () => { const a = await window.SP.pickAsset("audio"); if (!a) return; E.tl.audio.push({ id: uid(), asset_id: a.id, start: 0, in: 0, out: 9999, volume: 0.5, fade_in: 0, fade_out: 0, kind: "music" }); E.tl = await api("timeline", { project: E.projectId, timeline: E.tl }); draw(); }) }, "+ Music / sound / voice")),
      audioGenCard(),
      h("h3", { style: "margin:16px 0 6px" }, "Text & subtitles"), ...textItems,
      h("div", { class: "actions" }, h("button", { class: "sp-btn", onclick: () => { E.tl.texts.push({ id: uid(), text: "New text", start: 0, dur: 3, pos: "bottom", size: 44, color: "white", kind: "text" }); changed(); } }, "+ Text / subtitle"),
        h("button", { class: "sp-btn", title: "Writes subtitles from the speech in your movie (runs on this PC)", onclick: guard(subtitlesFromSpeech) }, "Subtitles from speech")));
    root.append(h("div", { class: "ed-wrap" }, left, right));
  }

  // ---- generate voice / sound effects / music with the GPU models and drop the result on the audio track
  const G = { mode: "voice", voice: "english", refAsset: null };
  const toDataUrl = async url => window.SP.fileB64(await (await fetch(url)).blob());
  function audioGenCard() {
    const info = h("p", { class: "hint" });
    const modes = { voice: "Voice", sfx: "Sound effect", music: "Music" };
    const chips = h("div", { class: "chips" }, Object.entries(modes).map(([k, v]) => h("button", { type: "button", class: G.mode === k ? "on" : "", onclick: () => { G.mode = k; draw(); } }, v)));
    const text = h("textarea", { style: "min-height:70px", placeholder: G.mode === "voice" ? "What the voice says (English or Chinese)" : G.mode === "music" ? "gentle warm orchestral children's adventure music, soft and magical" : "soft magical chime with sparkles" });
    const secs = h("input", { type: "number", value: G.mode === "music" ? 30 : 8, min: 1, max: 47 });
    const start = h("input", { type: "number", value: 0, min: 0, step: 0.5 }), vol = h("input", { type: "number", value: G.mode === "music" ? 0.25 : 1, min: 0, max: 3, step: 0.05 });
    const voice = h("select", {}, [["english", "Sample voice 1"], ["french", "Sample voice 2"], ["german", "Sample voice 3"], ["custom", "My own recording"]].map(([v, l]) => h("option", { value: v, selected: v === G.voice }, l)));
    const refNote = h("span", { class: "sp-saved" }, G.refAsset ? G.refAsset.filename : ""), refText = h("input", { type: "text", placeholder: "Exactly what is said in the recording" });
    const custom = h("div", { style: G.voice === "custom" ? "" : "display:none" }, h("label", {}, "Recording (5-15 s, one speaker)"),
      h("div", { class: "actions" }, h("button", { class: "sp-btn", type: "button", onclick: async () => { const a = await window.SP.pickAsset("audio"); if (a) { G.refAsset = a; refNote.textContent = a.filename; } } }, "Pick / upload recording"), refNote), refText);
    voice.onchange = () => { G.voice = voice.value; custom.style.display = G.voice === "custom" ? "" : "none"; };
    const out = h("p", { class: "hint" });
    const go = h("button", { class: "sp-btn pri", onclick: async () => {
      if (!text.value.trim()) return alert("Describe the sound or type the words first.");
      go.disabled = true;
      try {
        let tool, params;
        if (G.mode === "voice") {
          let wav, ref;
          if (G.voice === "custom") { if (!G.refAsset || !refText.value.trim()) throw new Error("Pick a recording and type what is said in it."); wav = await toDataUrl(G.refAsset.url); ref = refText.value.trim(); }
          else { wav = await window.SP.fileB64(await (await fetch(`/voices/${G.voice}.wav`)).blob()); ref = (await (await fetch(`/voices/${G.voice}.txt`)).text()).trim(); }
          tool = "f5_voice"; params = { prompt: text.value, voice_audio: wav, voice_text: ref, voice_ext: ".wav", speed: 1 };
        } else { tool = "stable_audio"; params = { prompt: text.value, seconds: Math.max(1, Math.min(47, +secs.value || 10)) }; }
        const asset = await window.SP.runJob(tool, params, t => out.textContent = t);
        E.tl.audio.push({ id: uid(), asset_id: asset.id, start: Math.max(0, +start.value || 0), in: 0, out: 9999, volume: +vol.value || 1, fade_in: 0, fade_out: G.mode === "music" ? 2 : 0, kind: G.mode === "music" ? "music" : G.mode === "voice" ? "voice" : "sfx" });
        E.tl = await api("timeline", { project: E.projectId, timeline: E.tl }); draw();
      } catch (e) { out.textContent = "Failed: " + e.message; go.disabled = false; }
    } }, "Generate and add to audio track");
    info.textContent = G.mode === "voice" ? "F5-TTS speaks English and Chinese; Arabic is not supported by this model. Only clone voices you have permission to use."
      : G.mode === "music" ? "Stable Audio Open makes up to 47 s of music or ambience; loop or layer it for longer scenes. Quality is best for short beds, not full songs."
      : "Stable Audio Open: describe the sound, up to 47 s.";
    return h("div", { class: "ed-item" }, h("b", {}, "Generate audio"), chips, h("label", {}, G.mode === "voice" ? "Text to speak" : "Describe it"), text,
      G.mode === "voice" ? h("div", {}, h("label", {}, "Voice"), voice, custom) : h("div", {}, h("label", {}, "Length (seconds, max 47)"), secs),
      h("div", { class: "ed-row" }, h("div", {}, h("label", {}, "Starts at (s)"), start), h("div", {}, h("label", {}, "Volume"), vol)), info, h("div", { class: "actions" }, go), out);
  }

  // speech -> subtitles: export the movie, transcribe its sound on this PC, add each sentence as a subtitle at the right time
  async function subtitlesFromSpeech() {
    const st = (await api("local_ai")).subtitles;
    if (!st.available && window.StudioBackend) return alert(st.install);
    if (!st.available) return alert("Speech-to-text is not installed on this PC.\n\nInstall it once with:\n" + st.install + "\n\nThen restart AI Studio.");
    if (!E.tl.clips.length) return alert("Add video clips first.");
    if (!confirm("This exports the movie, then listens to it on this PC (CPU) to write subtitles. The first time it downloads a speech model (about 500 MB). Continue?")) return;
    status.textContent = "Exporting…";
    await api("timeline", { project: E.projectId, timeline: E.tl });
    let j = await api("export", { project: E.projectId, resolution: "source" });
    while (j.status === "queued" || j.status === "rendering") { await new Promise(r => setTimeout(r, 1500)); j = await api("export/" + j.id); }
    if (j.status !== "done") throw new Error(j.error || "export failed");
    let s = await api("subtitles", { asset_id: j.asset.id });
    while (!["done", "failed"].includes(s.status)) { status.textContent = "Subtitles: " + s.status + "…"; await new Promise(r => setTimeout(r, 2500)); s = await api("subtitles/" + s.id); }
    if (s.status === "failed") throw new Error(s.error);
    if (!s.segments.length) { status.textContent = "No speech found."; return alert("No speech was found in the movie's sound."); }
    E.tl.texts = E.tl.texts.filter(t => t.kind !== "subtitle");
    for (const g of s.segments) E.tl.texts.push({ id: uid(), text: g.text, start: g.start, dur: Math.max(0.6, g.end - g.start), pos: "bottom", size: 40, color: "white", kind: "subtitle" });
    changed(); status.textContent = `${s.segments.length} subtitle(s) added (${s.language}). Check the text, then export again.`;
  }
  const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { err(e); } };

  async function doExport(hd, box) {
    try {
      await api("timeline", { project: E.projectId, timeline: E.tl });
      let j = await api("export", { project: E.projectId, resolution: hd ? "hd" : "source" });
      const bar = h("div", { class: "prog" }, h("div", { class: "bar" }, h("i", {})), h("div", { class: "row2" }, h("span", {}, "Rendering with FFmpeg…")));
      box.replaceChildren(bar);
      while (j.status === "queued" || j.status === "rendering") {
        await new Promise(r => setTimeout(r, 1500)); j = await api("export/" + j.id);
        bar.querySelector("i").style.width = Math.round(j.progress * 100) + "%";
      }
      if (j.status === "failed") { box.replaceChildren(h("p", { class: "sb-warn", style: "color:var(--bad)" }, j.error)); return; }
      box.replaceChildren(h("video", { src: j.asset.url, controls: true, style: "width:100%;border-radius:10px;margin-top:8px" }),
        h("div", { class: "actions" }, h("a", { class: "sp-btn", href: j.asset.url, download: j.asset.filename, style: "text-decoration:none" }, "Download MP4 (" + fmtSize(j.asset.size) + ")"), h("span", { class: "hint" }, "Also saved in Assets → export")));
    } catch (e) { box.replaceChildren(h("p", { class: "sb-warn", style: "color:var(--bad)" }, e.message)); }
  }

  async function load() {
    E.projects = (await api("projects")).items;
    if (E.projectId && !E.projects.find(p => p.id === E.projectId)) E.projectId = "";
    E.tl = E.projectId ? await api("timeline?project=" + E.projectId) : { clips: [], audio: [], texts: [] };
    if (E.sel && !E.tl.clips.find(c => c.id === E.sel)) E.sel = null;
    draw();
  }
  loaders.editor = () => load().catch(err);
})();
