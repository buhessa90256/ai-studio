// Projects: the project list and the unified production workspace. One project selection and one scene selection drive all four modes
// (Storyboard, Director, Editor, Automation); the old Editor / Workflows screens are mounted inside the workspace rather than being separate pages.
"use strict";
(() => {
  if (!window.AppShell || !window.AppShell.v2) return;
  const wait = setInterval(() => { if (window.APP && APP.go && APP.projectCard) { clearInterval(wait); init(); } }, 80);
  function init() {
    const { h, icon, txt, api } = APP;
    const host = document.getElementById("v-studio"), legacy = document.getElementById("studio-main");
    const rootEl = h("div", { id: "ws-root" }); host.insertBefore(rootEl, host.firstChild);
    const MODES = [["storyboard", "Storyboard"], ["director", "Director"], ["editor", "Editor"], ["automation", "Automation"]];
    let ws = null, token = 0, poll = null, listFilter = "active", listQ = "";

    // ------------------------------------------------------------------ routing
    async function renderRoute() {
      if (document.getElementById("v-studio").hidden) return;
      const my = ++token, { projectId, mode, sceneId } = APP.state;
      legacy.style.display = "none"; legacy.classList.remove("ws-legacy");
      try { if (!projectId) { stopPoll(); ws = null; return await list(my); } await workspace(projectId, MODES.some(m => m[0] === mode) ? mode : "storyboard", sceneId, my); }
      catch (e) { if (my === token) { rootEl.replaceChildren(h("div", { class: "ds-empty" }, icon("warn"), h("b", {}, "Could not open this"), APP.txt(e.message, "Unknown error"), h("button", { class: "ds-btn", onclick: () => APP.go("/projects") }, "Back to projects"))); APP.fail(e); } }
    }
    APP.on("route", () => { if (location.hash.startsWith("#/projects")) renderRoute(); });
    APP.on("view:studio", () => { if (!location.hash.startsWith("#/projects")) { APP.state.projectId = ""; } renderRoute(); });
    APP.on("changed", () => { if (!host.hidden && ws) refresh(); else if (!host.hidden && !APP.state.projectId) renderRoute(); });

    // ------------------------------------------------------------------ project list
    async function list(my) {
      rootEl.replaceChildren(h("div", { class: "ds-stack" }, h("div", { class: "ds-skel", style: "height:44px" }), h("div", { class: "ds-grid wide" }, [1, 2, 3].map(() => h("div", { class: "ds-skel", style: "height:220px" })))));
      const projects = await APP.projects(true); const scenesBy = {};
      await Promise.all(projects.slice(0, 40).map(async p => { scenesBy[p.id] = await APP.scenes(p.id); }));
      if (my !== token) return;
      const q = listQ.trim().toLowerCase();
      const shown = projects.filter(p => !q || (p.name || "").toLowerCase().includes(q)).filter(p => listFilter === "all" || (listFilter === "active" ? !(scenesBy[p.id] || []).length || APP.pipeline(scenesBy[p.id]).vids < (scenesBy[p.id] || []).length : APP.pipeline(scenesBy[p.id] || []).vids === (scenesBy[p.id] || []).length && (scenesBy[p.id] || []).length));
      const search = h("input", { class: "ds-input", placeholder: "Search projects", value: listQ, "aria-label": "Search projects" }); search.oninput = () => { listQ = search.value; clearTimeout(list.t); list.t = setTimeout(() => list(++token), 250); };
      const seg = h("div", { class: "ds-seg" }, [["active", "In progress"], ["done", "Finished"], ["all", "All"]].map(([k, l]) => h("button", { type: "button", class: listFilter === k ? "on" : "", onclick: () => { listFilter = k; list(++token); } }, l)));
      rootEl.replaceChildren(h("div", { class: "hm-hero" }, h("div", {}, h("h1", { class: "ds-h" }, "Projects"), h("div", { class: "ds-sub" }, `${projects.length} project${projects.length === 1 ? "" : "s"}`)), h("button", { class: "ds-btn pri", onclick: () => APP.newProject() }, icon("plus"), "New project")),
        h("div", { class: "ds-row ds-wrap", style: "margin:14px 0" }, h("div", { class: "ds-grow", style: "min-width:200px" }, search), seg),
        shown.length ? h("div", { class: "ds-grid wide" }, shown.map(p => APP.projectCard(p, scenesBy[p.id] || [], APP.pipeline(scenesBy[p.id] || []))))
          : h("div", { class: "ds-empty" }, icon("film"), h("b", {}, projects.length ? "No projects match" : "No projects yet"), projects.length ? "Try another filter or search." : "A project holds your scenes, start frames, videos and the final edit.", projects.length ? null : h("button", { class: "ds-btn pri", onclick: () => APP.newProject() }, "Create your first project")));
    }

    // ------------------------------------------------------------------ workspace
    async function workspace(pid, mode, sceneId, my) {
      const first = !ws || ws.pid !== pid;
      if (first) rootEl.replaceChildren(h("div", { class: "ds-stack" }, h("div", { class: "ds-skel", style: "height:40px" }), h("div", { class: "ds-skel", style: "height:60vh" })));
      const [project, scenes, chars] = await Promise.all([APP.project(pid), APP.scenes(pid, true), APP.chars()]);
      if (my !== token) return;
      if (!project) throw new Error("This project no longer exists on this device.");
      const keep = ws && ws.pid === pid ? ws : { view: "frame" };
      ws = Object.assign(keep, { pid, project, scenes, chars, mode });
      ws.sceneId = scenes.some(s => s.id === sceneId) ? sceneId : (scenes.some(s => s.id === ws.sceneId) ? ws.sceneId : (scenes[0] || {}).id || "");
      APP.state.sceneId = ws.sceneId; APP.LS.set("sb_project", pid);
      draw(); startPoll();
      if (APP.state.review && ws.sceneId) { APP.state.review = false; const sc = scenes.find(s => s.id === ws.sceneId); if (sc) APP.openReview(sc, project, ctx()); }
    }
    const cur = () => (ws && ws.scenes.find(s => s.id === ws.sceneId)) || null;
    const ctx = () => ({ refresh, project: ws.project, scenes: ws.scenes, actions });
    async function refresh() { if (!ws) return; const [project, scenes] = await Promise.all([APP.project(ws.pid), APP.scenes(ws.pid, true)]); if (!ws || !project) return; ws.project = project; ws.scenes = scenes; if (!scenes.some(s => s.id === ws.sceneId)) ws.sceneId = (scenes[0] || {}).id || ""; draw(); }
    function startPoll() { stopPoll(); poll = setInterval(() => { if (document.visibilityState === "visible" && ws && ws.scenes.some(s => APP.sceneInfo(s).busy)) refresh().catch(() => {}); }, 5000); }
    function stopPoll() { if (poll) clearInterval(poll); poll = null; }
    function pick(id) { ws.sceneId = id; APP.state.sceneId = id; history.replaceState(null, "", `#/projects/${ws.pid}/${ws.mode}/${id}`); draw(); }
    function setMode(m) { APP.go(`/projects/${ws.pid}/${m}${ws.sceneId ? "/" + ws.sceneId : ""}`); }

    function draw() {
      if (!ws) return;
      const { project: p, scenes, mode } = ws, pl = APP.pipeline(scenes), pend = scenes.filter(s => APP.sceneInfo(s, p).key === "review").length;
      const head = h("div", { class: "ws-head" },
        h("button", { class: "ds-btn icon sm ghost", "aria-label": "All projects", onclick: () => APP.go("/projects") }, icon("back")),
        h("div", { class: "t" }, h("h1", {}, txt(p.name, "Untitled project")), h("div", { class: "ds-row ds-wrap", style: "gap:6px;margin-top:3px" }, h("span", { class: "ds-pill" }, p.aspect), h("span", { class: "ds-small" }, `${scenes.length} scene${scenes.length === 1 ? "" : "s"}`), pend ? h("span", { class: "ds-pill warn" }, pend + " to review") : null, ws.scenes.some(s => APP.sceneInfo(s).busy) ? h("span", { class: "ds-pill run" }, h("i"), "Generating") : null)),
        h("button", { class: "ds-btn icon sm", "aria-label": "Project menu", onclick: () => projectMenu() }, icon("dots")));
      const pipe = h("div", { class: "ws-pipe", "aria-label": "Production pipeline" }, pl.steps.map(s => h("span", { class: "ws-step" + (s.done ? " done" : s.cur ? " cur" : "") }, h("i"), s.name)));
      const seg = h("div", { class: "ds-seg", role: "tablist" }, MODES.map(([k, l]) => h("button", { type: "button", role: "tab", class: mode === k ? "on" : "", "aria-selected": mode === k, onclick: () => setMode(k) }, l)));
      const body = h("div", { id: "ws-content" });
      rootEl.replaceChildren(h("div", { class: "ws" }, head, pipe, h("div", { style: "overflow-x:auto" }, seg), body));
      if (mode === "storyboard") storyboardMode(body); else if (mode === "director") directorMode(body); else legacyMode(body, mode);
    }

    // ------------------------------------------------------------------ shared pieces
    const thumbOf = (sc, project) => { const url = sc.start_asset_url; return h("div", { class: "ds-thumb", style: `--ar:${APP.arCss(project.aspect)}` }, url ? h("img", { src: url, loading: "lazy", alt: "", decoding: "async" }) : (sc.video_asset_url ? h("video", { src: sc.video_asset_url + "#t=0.3", muted: true, preload: "metadata" }) : icon("img"))); };
    function rail() {
      const { project: p, scenes } = ws;
      const r = h("div", { class: "ws-rail", role: "listbox", "aria-label": "Scenes" }, scenes.map((s, i) => { const info = APP.sceneInfo(s, p);
        return h("div", { class: "ws-sc" + (s.id === ws.sceneId ? " on" : ""), role: "option", "aria-selected": s.id === ws.sceneId, tabindex: 0, onclick: () => pick(s.id), onkeydown: e => { if (e.key === "Enter") pick(s.id); } },
          thumbOf(s, p), h("span", { class: "st " + (info.tone || "") , title: info.label }), h("div", { class: "n" }, h("span", {}, "Scene " + (i + 1)), h("span", {}, (s.duration || 6) + "s"))); }),
        h("div", { class: "ws-sc", role: "button", tabindex: 0, title: "Add a scene", onclick: () => actions.addScene(), onkeydown: e => { if (e.key === "Enter") actions.addScene(); } }, h("div", { class: "ds-thumb", style: `--ar:${APP.arCss(p.aspect)}` }, icon("plus")), h("div", { class: "n" }, h("span", {}, "Add"))));
      setTimeout(() => { const on = r.querySelector(".on"); if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest", inline: "center" }); }, 0);
      return r;
    }
    const idPill = info => { const i = info.identity; if (!i) return h("span", { class: "ds-pill" }, "Identity: not checked"); const t = { pass: "ok", warn: "warn", fail: "bad" }[i.overall] || ""; return h("span", { class: "ds-pill " + t }, "Identity: " + ({ pass: "verified", warn: "uncertain", fail: "failed" }[i.overall] || APP.txt(i.overall, "unknown"))); };
    const statusRow = (sc, info) => h("div", { class: "ds-row ds-wrap", style: "gap:6px" }, h("span", { class: "ds-pill " + info.tone }, info.busy ? h("i") : null, info.label), idPill(info),
      info.flags.length ? h("span", { class: "ds-pill bad" }, icon("warn"), "Collage flagged") : null, info.hasFrame ? h("span", { class: "ds-pill " + (info.approved ? "ok" : info.review === "rejected" ? "bad" : "warn") }, info.approved ? "Approved" : info.review === "rejected" ? "Rejected" : "Not approved") : null,
      h("span", { class: "ds-pill" }, "~" + APP.money(info.cost) + " next step"));
    function stage(sc, info) {
      const p = ws.project, ar = APP.arCss(p.aspect), land = !APP.isPortrait(p.aspect);
      const showVideo = info.hasVideo && (ws.view === "video" || !info.hasFrame);
      let inner;
      if (showVideo) inner = h("video", { src: sc.video_asset_url, controls: true, playsinline: true, poster: sc.start_asset_url || null, preload: "metadata" });
      else if (info.hasFrame) inner = h("img", { src: sc.start_asset_url, alt: txt(sc.title, "Start frame"), decoding: "async" });
      else inner = h("div", { class: "ds-empty", style: "border:0;padding:12px" }, icon(info.busy ? "sparkle" : "img"), h("b", {}, info.busy ? "Making the start frame…" : "No start frame yet"), info.busy ? "The GPU may need about 5 minutes to wake. You can leave this page." : "Describe the scene, then generate its first frame.");
      const view = swipeable(h("div", { class: "ws-view" + (land ? " land" : "") }, h("div", { class: "ds-thumb contain", style: `--ar:${ar}`, onclick: () => info.hasFrame && APP.openReview(sc, p, ctx()), title: info.hasFrame ? "Open full review" : "" }, inner)));
      const tabs = info.hasFrame && info.hasVideo ? h("div", { class: "ds-seg", style: "align-self:center" }, [["frame", "Start frame"], ["video", "Video"]].map(([k, l]) => h("button", { type: "button", class: (showVideo ? "video" : "frame") === k ? "on" : "", onclick: () => { ws.view = k; draw(); } }, l))) : null;
      return [tabs, view];
    }
    // swipe left/right on the preview to move between scenes (phones)
    function swipeable(el) {
      let x0 = 0, y0 = 0, t0 = 0;
      el.addEventListener("touchstart", e => { const t = e.changedTouches[0]; x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); }, { passive: true });
      el.addEventListener("touchend", e => { const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0; if (Math.abs(dx) > 70 && Math.abs(dy) < 45 && Date.now() - t0 < 600) { const i = ws.scenes.findIndex(s => s.id === ws.sceneId), j = dx < 0 ? i + 1 : i - 1; if (ws.scenes[j]) pick(ws.scenes[j].id); } }, { passive: true });
      return el;
    }
    const reviewBtn = sc => h("button", { class: "ds-btn ghost icon", "aria-label": "Open full review", title: "Open full review", onclick: () => APP.openReview(sc, ws.project, ctx()) }, icon("zoom"));
    function actionBar(sc, info) {
      const b = (cls, label, fn, ico, dis) => h("button", { class: "ds-btn " + cls, disabled: !!dis, onclick: fn }, ico ? icon(ico) : null, label);
      const bar = h("div", { class: "ws-bar" });
      if (info.busy) bar.append(b("", info.key === "video_run" ? "Making video…" : "Making frame…", null, null, true), sc.job_id ? b("bad", "Cancel", () => actions.cancel(sc), "x") : null);
      else if (!info.hasFrame) bar.append(b("pri", `Generate start frame · ~${APP.money(APP.estimate(sc, "frame"))}`, () => actions.frame(sc), "sparkle", !sc.action && !sc.title));
      else if (info.key === "review" || info.key === "rejected") bar.append(b("bad", "Reject", () => actions.reject(sc)), b("", "Regenerate", () => actions.frame(sc), "refresh"), b("ok", "Approve", () => actions.approve(sc), "check"), reviewBtn(sc));
      else if (info.key === "approved") bar.append(b("pri", `Generate video · ~${APP.money(APP.estimate(sc, "clip"))}`, () => actions.video(sc), "play"), b("", "New frame", () => actions.frame(sc), "refresh"), reviewBtn(sc));
      else bar.append(b("", "Review", () => APP.openReview(sc, ws.project, ctx()), "zoom"), b("", "New video · ~" + APP.money(APP.estimate(sc, "clip")), () => actions.video(sc), "play"), sc.video_asset ? h("a", { class: "ds-btn", href: sc.video_asset_url, download: (sc.title || "scene") + ".mp4" }, "Save") : null);
      return bar;
    }

    // ------------------------------------------------------------------ Storyboard mode
    function storyboardMode(body) {
      const { project: p, scenes } = ws, sc = cur();
      if (!scenes.length) { body.append(h("div", { class: "ds-empty" }, icon("film"), h("b", {}, "No scenes yet"), "Plan the story first. Each scene becomes one start frame and one video.",
        h("div", { class: "ds-row ds-wrap", style: "justify-content:center" }, h("button", { class: "ds-btn pri", onclick: () => actions.addScene() }, icon("plus"), "Add a scene"), h("button", { class: "ds-btn", onclick: () => actions.plan() }, icon("sparkle"), "Auto-plan scenes"), h("button", { class: "ds-btn", onclick: () => actions.importScenes() }, "Import JSON")))); return; }
      const info = APP.sceneInfo(sc, p);
      body.append(h("div", { class: "ws-body" }, rail(), h("div", { class: "ws-stage" }, h("div", { class: "ds-row ds-between ds-wrap" }, h("div", {}, h("div", { class: "ds-h2" }, `Scene ${scenes.indexOf(sc) + 1}${sc.title && !/^scene \d+$/i.test(sc.title.trim()) ? " · " + sc.title : ""}`), h("div", { class: "ds-small" }, `${sc.duration || 6}s${sc.location ? " · " + sc.location : ""}`)), statusRow(sc, info)),
        stage(sc, info), sc.error ? h("div", { class: "ck" }, h("span", { class: "ds-pill bad" }, "Error"), h("div", {}, APP.txt(sc.error), h("span", {}, "Try again; if it keeps failing, check Settings → Diagnostics."))) : null, actionBar(sc, info)),
        propsPanel(sc, info)));
    }
    function propsPanel(sc, info) {
      const p = ws.project, saved = h("span", { class: "ds-small" }); let timer;
      const save = patch => { clearTimeout(timer); timer = setTimeout(async () => { try { await APP.saveScene(sc, patch()); saved.textContent = "Saved ✓"; setTimeout(() => saved.textContent = "", 1500); } catch (e) { APP.fail(e, "Could not save"); } }, 600); };
      const f = (key, label, ph, area) => { const el = h(area ? "textarea" : "input", { class: area ? "ds-text" : "ds-input", placeholder: ph || "", value: area ? null : txt(sc[key]) }, area ? txt(sc[key]) : null); el.oninput = () => { sc[key] = el.value; save(() => ({ [key]: el.value })); }; return h("div", { class: "ds-field" }, h("label", {}, label), el); };
      const chosen = new Set(sc.characters || []);
      const chars = h("div", { class: "ds-chips", style: "flex-wrap:wrap" }, ws.chars.map(c => h("button", { type: "button", class: "ds-chip" + (chosen.has(c.id) ? " on" : ""), onclick: e => { chosen.has(c.id) ? chosen.delete(c.id) : chosen.add(c.id); e.currentTarget.classList.toggle("on", chosen.has(c.id)); sc.characters = [...chosen]; save(() => ({ characters: [...chosen] })); } }, c.name)));
      const refs = ws.chars.filter(c => chosen.has(c.id)).flatMap(c => (c.refs || []).slice(0, 3).map(r => h("div", { class: "ds-thumb", style: "width:54px;height:54px;border-radius:10px", title: c.name + " · " + r.role }, h("img", { src: r.asset.url, loading: "lazy", alt: c.name }))));
      const hist = (sc.settings || {}).frame_history || [];
      return h("div", { class: "ws-panel" }, h("details", { class: "ws-sec", open: true }, h("summary", {}, "Scene"), h("div", { class: "in" }, f("title", "Title", "Scene title"), f("action", "What happens (visible movement)", "Hessa sits up and stretches her arms", true),
        h("div", { class: "ds-row" }, h("div", { class: "ds-grow ds-field" }, h("label", {}, "Location"), (() => { const el = h("input", { class: "ds-input", value: txt(sc.location), placeholder: "bedroom" }); el.oninput = () => { sc.location = el.value; save(() => ({ location: el.value })); }; return el; })()), h("div", { style: "width:92px", class: "ds-field" }, h("label", {}, "Seconds"), (() => { const el = h("input", { class: "ds-input", type: "number", min: 2, max: 60, value: sc.duration || 6 }); el.oninput = () => { sc.duration = +el.value || 6; save(() => ({ duration: +el.value || 6 })); }; return el; })())), saved)),
        h("details", { class: "ws-sec", open: true }, h("summary", {}, "Characters & references"), h("div", { class: "in" }, ws.chars.length ? chars : h("div", { class: "ds-sub" }, "No characters yet. Add them in the Library."), refs.length ? h("div", { class: "ds-row ds-wrap", style: "gap:6px" }, refs) : null, h("div", { class: "ds-small" }, "Their reference photos are used for the start frame (identity only, never layout)."))),
        h("details", { class: "ws-sec" }, h("summary", {}, "Frame versions" + (hist.length ? " (" + hist.length + ")" : "")), h("div", { class: "in" }, hist.length ? h("div", { class: "ds-row ds-wrap", style: "gap:8px" }, hist.slice().reverse().map(x => h("div", { class: "rv-ver", style: "width:62px", onclick: () => APP.openReview(sc, ws.project, ctx(), x.asset) }, h("img", { src: "/media/" + x.asset, alt: "v" + x.v, loading: "lazy" }), h("b", {}, "v" + x.v)))) : h("div", { class: "ds-sub" }, "Every new start frame is kept here so you can compare and go back."))),
        h("details", { class: "ws-sec" }, h("summary", {}, "Cost & progress"), h("div", { class: "in" }, h("div", { class: "ws-stats" }, h("div", {}, "Start frame", h("b", {}, "~" + APP.money(APP.estimate(sc, "frame")))), h("div", {}, "Video", h("b", {}, "~" + APP.money(APP.estimate(sc, "clip")))), h("div", {}, "Status", h("b", {}, info.label)), h("div", {}, "Approval", h("b", {}, info.approved ? "Approved" : info.hasFrame ? "Waiting" : "–"))))));
    }

    // ------------------------------------------------------------------ Director mode (native): project look, per-scene overrides, generation settings
    async function directorMode(body) {
      const { project: p } = ws, sc = cur();
      const presets = await api("director");
      if (!ws || ws.mode !== "director") return;
      const look = { ...(p.data.director || {}) }, saved = h("span", { class: "ds-small" });
      let t; const persist = () => { clearTimeout(t); t = setTimeout(async () => { try { await APP.saveProject(p, { data: { ...p.data, director: look } }); saved.textContent = "Saved ✓"; } catch (e) { APP.fail(e, "Could not save"); } }, 500); };
      const preview = h("div", { class: "ds-sub" });
      const showPrompt = async () => { if (!sc) return; try { const r = await api(`scenes/${sc.id}/prompt`); preview.textContent = txt(r.video_prompt, "Add what happens in the scene to see its video prompt."); } catch { preview.textContent = ""; } };
      const lookCards = Object.entries(presets).map(([g, def]) => h("div", { class: "ds-field" }, h("label", {}, def.label + " (project default)"), h("div", { class: "ds-chips" }, [h("button", { type: "button", class: "ds-chip" + (look[g] ? "" : " on"), "data-i": "" }, "None"), ...def.items.map(it => h("button", { type: "button", class: "ds-chip" + (look[g] === it.id ? " on" : ""), "data-i": it.id }, it.label))])));
      lookCards.forEach((c, k) => { const g = Object.keys(presets)[k]; [...c.querySelectorAll(".ds-chip")].forEach(b => b.onclick = () => { [...c.querySelectorAll(".ds-chip")].forEach(x => x.classList.remove("on")); b.classList.add("on"); b.dataset.i ? look[g] = b.dataset.i : delete look[g]; persist(); }); });
      const over = sc ? (() => { sc.settings = sc.settings || {}; const d = sc.settings.director = sc.settings.director || {}; let tt; const sv = () => { clearTimeout(tt); tt = setTimeout(async () => { try { await APP.saveScene(sc, { settings: sc.settings }); showPrompt(); } catch (e) { APP.fail(e); } }, 500); };
        return Object.entries(presets).map(([g, def]) => { const sel = h("select", { class: "ds-select" }, [h("option", { value: "" }, "Project default"), ...def.items.map(it => h("option", { value: it.id, selected: d[g] === it.id }, it.label))]); sel.onchange = () => { sel.value ? d[g] = sel.value : delete d[g]; sv(); }; return h("div", { class: "ds-field" }, h("label", {}, def.label), sel); }); })() : [];
      const quality = sc ? (() => { const sel = h("select", { class: "ds-select" }, [["high", "High (sharper, slower)"], ["fast", "Fast (cheaper)"]].map(([v, l]) => h("option", { value: v, selected: ((sc.settings || {}).quality || "high") === v }, l))); sel.onchange = async () => { try { await APP.saveScene(sc, { settings: { ...(sc.settings || {}), quality: sel.value } }); } catch (e) { APP.fail(e); } }; return sel; })() : null;
      const camera = sc ? (() => { const el = h("input", { class: "ds-input", value: txt(sc.camera), placeholder: "slow push-in, tracking shot" }); let tt; el.oninput = () => { clearTimeout(tt); tt = setTimeout(async () => { try { await APP.saveScene(sc, { camera: el.value }); showPrompt(); } catch (e) { APP.fail(e); } }, 600); }; return el; })() : null;
      body.append(h("div", { class: "ws-body" }, rail(), h("div", { class: "ws-stage" }, sc ? [h("div", { class: "ds-h2" }, `Scene ${ws.scenes.indexOf(sc) + 1} · camera & look`), stage(sc, APP.sceneInfo(sc, p))[1], h("div", { class: "ds-card flat" }, h("div", { class: "ds-small", style: "margin-bottom:6px" }, "Prompt sent to the video model"), preview), actionBar(sc, APP.sceneInfo(sc, p))] : h("div", { class: "ds-empty" }, icon("film"), h("b", {}, "Add scenes in Storyboard first"))),
        h("div", { class: "ws-panel" }, h("p", { class: "ds-small", style: "margin:0" }, "Presets are written into the prompt. They steer the model but are not guaranteed camera controls."),
          h("details", { class: "ws-sec", open: true }, h("summary", {}, "Scene overrides"), h("div", { class: "in" }, sc ? [h("div", { class: "ds-field" }, h("label", {}, "Camera movement"), camera), ...over, h("div", { class: "ds-field" }, h("label", {}, "Video quality"), quality), h("div", { class: "ds-field" }, h("label", {}, "Video model"), h("div", { class: "ds-pill" }, "MiniMax-H3 · image to video with sound"))] : h("div", { class: "ds-sub" }, "Select a scene."))),
          h("details", { class: "ws-sec" }, h("summary", {}, "Project look (all scenes)"), h("div", { class: "in" }, ...lookCards, saved)))));
      showPrompt();
    }

    // ------------------------------------------------------------------ Editor and Automation: the existing screens, mounted inside the workspace
    async function legacyMode(body, mode) {
      const { pid } = ws;
      const subs = mode === "automation" ? [["studioflows", "Workflows"], ["queue", "Queue & retries"]] : null;
      legacy.style.display = ""; legacy.classList.add("ws-legacy");
      body.append(subs ? h("div", { class: "ds-seg", id: "ws-sub", style: "margin-bottom:10px" }, subs.map(([k, l], i) => h("button", { type: "button", class: (ws.sub || subs[0][0]) === k ? "on" : "", onclick: () => { ws.sub = k; show(k); [...document.querySelectorAll("#ws-sub button")].forEach((x, j) => x.classList.toggle("on", subs[j][0] === k)); } }, l))) : null, legacy);
      const show = k => { window.showTab(k); };
      try { if (mode === "editor") { await window.SP.use.editor(pid); window.showTab("editor"); } else { const k = ws.sub || subs[0][0]; if (k === "studioflows") await window.SP.use.flows(pid); window.showTab(k); } } catch (e) { APP.fail(e); }
    }

    // ------------------------------------------------------------------ actions (everything that can cost money asks first, and never runs by itself)
    const actions = {
      async addScene() { try { const s = await api("scenes", { project_id: ws.pid, title: "New scene", characters: ws.project.characters }); ws.sceneId = s.id; APP.changed("scenes"); await refresh(); } catch (e) { APP.fail(e, "Could not add the scene"); } },
      async plan() { await window.SP.sb.use(ws.pid); window.SP.sb.planDialog(); },
      async importScenes() { await window.SP.sb.use(ws.pid); window.SP.sb.importDialog(); },
      async frame(sc) {
        if (sc.settings && sc.settings.cm) return APP.chatAct("regenerate", sc, ws.project);
        const info = APP.sceneInfo(sc, ws.project);
        if (!(await APP.confirm(info.hasFrame ? "Make a new start frame?" : "Make the start frame?", `Uses the GPU (about ${APP.money(APP.estimate(sc, "frame"))} of RunPod credit). The current frame stays in Frame versions.${APP.gpu.state === "asleep" ? "\nThe GPU is asleep and needs about 5 minutes to wake." : ""}`, "Generate"))) return;
        await APP.once("frame:" + sc.id, async () => { try { await window.SP.sb.use(ws.pid); await window.SP.sb.frame(sc.id); APP.toast("Start frame is being made. You can leave this page.", "ok"); } catch (e) { APP.fail(e, "Start frame"); } await refresh(); });
      },
      async video(sc) {
        if (sc.settings && sc.settings.cm) return APP.chatAct("approve", sc, ws.project);
        const info = APP.sceneInfo(sc, ws.project);
        if (!info.approved) return APP.toast("Approve the start frame first.");
        if (!(await APP.confirm("Make the video?", `Uses the GPU for about 7 minutes (about ${APP.money(APP.estimate(sc, "clip"))} of RunPod credit). This only starts because you pressed Generate.`, "Generate video"))) return;
        await APP.once("video:" + sc.id, async () => { try { await window.SP.sb.use(ws.pid); await window.SP.sb.video(sc.id); APP.toast("Video is being made.", "ok"); } catch (e) { APP.fail(e, "Video"); } await refresh(); });
      },
      async approve(sc) {
        if (sc.settings && sc.settings.cm) return APP.chatAct("approve", sc, ws.project);
        try { await APP.saveScene(sc, { settings: { ...(sc.settings || {}), review: "approved", approved_at: Date.now() / 1000 } }); APP.toast("Frame approved. Nothing is generated until you press Generate video.", "ok"); await refresh(); } catch (e) { APP.fail(e); }
      },
      async reject(sc) {
        if (sc.settings && sc.settings.cm) return APP.chatAct("reject", sc, ws.project);
        try { await APP.saveScene(sc, { settings: { ...(sc.settings || {}), review: "rejected" } }); await refresh(); APP.toast("Frame rejected. Generate a new one when you are ready."); } catch (e) { APP.fail(e); }
      },
      async cancel(sc) { if (await APP.confirm("Cancel this job?", "GPU time already used is not refunded.", "Cancel job", true)) { try { await fetch("/api/cancel/" + sc.job_id, { method: "POST" }); APP.toast("Cancelling…"); setTimeout(refresh, 1500); } catch (e) { APP.fail(e); } } },
    };
    APP.wsActions = actions;
    function projectMenu() {
      const p = ws.project, sc = cur();
      APP.sheet((box, close) => box.append(h("h2", { class: "ds-h2", style: "font-size:17px;margin-bottom:10px" }, txt(p.name, "Project")), h("div", { class: "ds-stack", style: "gap:8px" },
        h("button", { class: "ds-btn", onclick: () => { close(); actions.addScene(); } }, icon("plus"), "Add scene"), h("button", { class: "ds-btn", onclick: () => { close(); actions.plan(); } }, icon("sparkle"), "Auto-plan scenes"), h("button", { class: "ds-btn", onclick: () => { close(); actions.importScenes(); } }, "Import scenes (JSON)"),
        sc ? h("button", { class: "ds-btn", onclick: async () => { close(); try { await api(`scenes/${sc.id}/duplicate`, {}); APP.changed("scenes"); await refresh(); } catch (e) { APP.fail(e); } } }, "Duplicate this scene") : null,
        sc ? h("button", { class: "ds-btn", onclick: async () => { close(); const i = ws.scenes.indexOf(sc), ids = ws.scenes.map(s => s.id); if (i > 0) { [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; await api("scenes/reorder", { project: ws.pid, ids }); APP.changed("scenes"); await refresh(); } } }, "Move scene earlier") : null,
        h("button", { class: "ds-btn", onclick: () => { close(); window.SP.editProject(p, () => { APP.changed("projects"); refresh(); }); } }, "Project settings"),
        sc ? h("button", { class: "ds-btn bad", onclick: async () => { close(); if (await APP.confirm("Delete this scene?", "Its frames and video stay in the Library.", "Delete", true)) { try { await api(`scenes/${sc.id}/delete`, {}); APP.changed("scenes"); await refresh(); } catch (e) { APP.fail(e); } } } }, "Delete this scene") : null)));
    }
    // keyboard: scene navigation, approve, regenerate (desktop)
    window.addEventListener("keydown", e => {
      if (host.hidden || !ws || ws.mode !== "storyboard" || document.querySelector(".rv,.ds-sheet") || (e.target.closest && e.target.closest("input,textarea,select"))) return;
      const i = ws.scenes.findIndex(s => s.id === ws.sceneId);
      if (e.key === "ArrowRight" && i < ws.scenes.length - 1) pick(ws.scenes[i + 1].id); else if (e.key === "ArrowLeft" && i > 0) pick(ws.scenes[i - 1].id);
      else if (e.key.toLowerCase() === "a" && cur() && APP.sceneInfo(cur()).key === "review") actions.approve(cur()); else if (e.key.toLowerCase() === "r" && cur()) actions.frame(cur());
    });
    setTimeout(() => { if (!host.hidden) renderRoute(); }, 0);
  }
})();
