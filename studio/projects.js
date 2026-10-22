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
    const SECTIONS = [["storyboard", "Storyboard"], ["scenes", "Scenes"], ["characters", "Characters"], ["videos", "Videos"], ["settings", "Settings"]];
    const ALIAS = { director: ["settings", "look"], editor: ["videos", "editor"], automation: ["settings", "studioflows"], manual: ["", ""] };   // older links keep working
    let ws = null, token = 0, poll = null, listFilter = "active", listQ = "";

    // ------------------------------------------------------------------ routing
    // Which workspace opens: an explicit link wins; otherwise the mode/section remembered for THIS project; first time = Manual Editor (Storyboard). AI Director is never chosen for the user.
    function resolveMode(pid, raw) {
      let sec = raw || "", sub = "";
      if (ALIAS[sec]) [sec, sub] = ALIAS[sec];
      if (!sec) sec = APP.LS.get("ws_mode:" + pid, "manual") === "ai" ? "ai" : APP.LS.get("ws_sec:" + pid, "storyboard");
      if (sec !== "ai" && !SECTIONS.some(x => x[0] === sec)) sec = "storyboard";
      APP.LS.set("ws_mode:" + pid, sec === "ai" ? "ai" : "manual"); if (sec !== "ai") APP.LS.set("ws_sec:" + pid, sec);
      if (SUBS_DEFAULT[sec]) sub = sub || APP.LS.get(`ws_sub:${pid}:${sec}`, SUBS_DEFAULT[sec]);
      return [sec, sub];
    }
    const SUBS_DEFAULT = { videos: "clips", settings: "look" };
    async function renderRoute() {
      if (document.getElementById("v-studio").hidden) return;
      const my = ++token, { projectId, mode, sceneId } = APP.state;
      legacy.style.display = "none"; legacy.classList.remove("ws-legacy");
      try { if (!projectId) { stopPoll(); ws = null; return await list(my); } { const [sec, sub] = resolveMode(projectId, mode); await workspace(projectId, sec, sceneId, my, sub); } }
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
      rootEl.replaceChildren(h("div", { class: "hm-hero" }, h("div", { class: "ds-sub" }, `${projects.length} project${projects.length === 1 ? "" : "s"}`), h("div", { class: "ds-row ds-wrap", style: "min-width:0" }, h("button", { class: "ds-btn", onclick: deletedSheet }, "Recently deleted"), projects.length && window.BULK ? h("button", { class: "ds-btn bad", id: "bk-del-open", onclick: () => window.BULK.deleteProjects({ onDone: () => list(++token) }) }, "Delete projects…") : null, h("button", { class: "ds-btn pri", onclick: () => APP.newProject() }, icon("plus"), "New project"))),
        h("div", { class: "ds-row ds-wrap", style: "margin:14px 0" }, h("div", { class: "ds-grow", style: "min-width:200px" }, search), seg),
        shown.length ? h("div", { class: "ds-grid wide" }, shown.map(p => APP.projectCard(p, scenesBy[p.id] || [], APP.pipeline(scenesBy[p.id] || []))))
          : h("div", { class: "ds-empty" }, icon("film"), h("b", {}, projects.length ? "No projects match" : "No projects yet"), projects.length ? "Try another filter or search." : "A project holds your scenes, start frames, videos and the final edit.", projects.length ? null : h("button", { class: "ds-btn pri", onclick: () => APP.newProject() }, "Create your first project")));
    }

    // ------------------------------------------------------------------ workspace
    async function workspace(pid, mode, sceneId, my, sub) {
      const first = !ws || ws.pid !== pid;
      if (first) rootEl.replaceChildren(h("div", { class: "ds-stack" }, h("div", { class: "ds-skel", style: "height:40px" }), h("div", { class: "ds-skel", style: "height:60vh" })));
      const [project, scenes, chars] = await Promise.all([APP.project(pid), APP.scenes(pid, true), APP.chars()]);
      if (my !== token) return;
      if (!project) throw new Error("This project no longer exists on this device.");
      const keep = ws && ws.pid === pid ? ws : { view: "frame" };
      ws = Object.assign(keep, { pid, project, scenes, chars, mode, sub: sub || "" }); ws.sig = sigOf();
      ws.sceneId = scenes.some(s => s.id === sceneId) ? sceneId : (scenes.some(s => s.id === ws.sceneId) ? ws.sceneId : (scenes[0] || {}).id || "");
      APP.state.sceneId = ws.sceneId; APP.LS.set("sb_project", pid);
      draw(); startPoll();
      if (APP.state.review && ws.sceneId) { APP.state.review = false; const sc = scenes.find(s => s.id === ws.sceneId); if (sc) APP.openReview(sc, project, ctx()); }
    }
    // ------------------------------------------------------------------ chat (AI Director): one node per project, reused by every redraw; full size in AI mode, a bottom sheet in Manual mode
    function chatNode() {
      if (!window.DIR || !DIR.createChat) { document.addEventListener("dir-ui-ready", () => { if (ws) draw(); }, { once: true }); return h("div", { class: "ds-empty" }, "AI Director is loading…"); }
      if (!ws.chat || ws.chatPid !== ws.pid) { if (ws.chat && ws.chat.destroy) ws.chat.destroy(); ws.chat = DIR.createChat(ws.pid); ws.chatPid = ws.pid; }
      return ws.chat;
    }
    function chatSheet() {
      const chat = chatNode(); chat.classList.remove("compact");
      const wrap = h("div", { class: "dir-sheetwrap", role: "dialog", "aria-modal": "true", "aria-label": "AI Director" }), box = h("div", { class: "box" });
      const close = () => { wrap.remove(); document.removeEventListener("keydown", esc); };
      const esc = e => { if (e.key === "Escape") close(); };
      box.append(h("div", { class: "hd" }, "AI Director", h("button", { class: "ds-btn icon ghost", "aria-label": "Close chat", onclick: close }, icon("x"))), chat);
      wrap.onclick = e => { if (e.target === wrap) close(); }; wrap.append(box); document.addEventListener("keydown", esc); document.body.append(wrap);
      setTimeout(() => { const l = chat.querySelector(".dir-list"); if (l) l.scrollTop = l.scrollHeight; }, 50);
    }
    const pid_ = () => (ws && ws.pid) || "";
    const cur = () => (ws && ws.scenes.find(s => s.id === ws.sceneId)) || null;
    const ctx = () => ({ refresh, project: ws.project, scenes: ws.scenes, actions });
    const sigOf = () => JSON.stringify([ws.project && [ws.project.name, ws.project.aspect, ws.project.updated], ws.scenes.map(s => [s.id, s.status, s.start_asset, s.video_asset, s.error, s.title, s.action, s.duration, (s.settings || {}).review, (s.settings || {}).cidentity && 1, (s.settings || {}).cflags && 1, (s.characters || []).join()])]);
    // the workspace only redraws when something visible changed (no flicker, no lost scroll position while jobs run)
    async function refresh(force) {
      if (!ws) return; const [project, scenes] = await Promise.all([APP.project(ws.pid), APP.scenes(ws.pid, true)]); if (!ws || !project) return;
      ws.project = project; ws.scenes = scenes; if (!scenes.some(s => s.id === ws.sceneId)) ws.sceneId = (scenes[0] || {}).id || "";
      const sig = sigOf(); if (!force && sig === ws.sig) { updateStrip(); return; }
      const ae = document.activeElement; if (!force && ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && rootEl.contains(ae)) { ws.sig = sig; updateStrip(); return; }   // editing a field: keep the selected scene and the cursor
      ws.sig = sig; const y = window.scrollY; draw(); window.scrollTo(0, y);
    }
    function startPoll() {   // while the workspace is open: every 2 s (cheap: it only redraws when something visible changed); paused while the tab is hidden
      stopPoll(); let n = 0;
      poll = setInterval(() => {
        if (document.visibilityState !== "visible" || !ws || host.hidden) return; n++;
        const busy = ws.scenes.some(s => APP.sceneInfo(s).busy) || (ws.kickUntil || 0) > Date.now();
        refresh().catch(() => {}); if (n % 4 === 0 && APP.refreshGpu) APP.refreshGpu().then(updateStrip).catch(() => {});
        const cid = ws.project && ws.project.data && ws.project.data.connector_id; if (cid && window.APP && APP.live) APP.live.watch(cid);   // chat movies: the single live poller (studio/live.js) keeps them current
      }, 2000);
    }
    function stopPoll() { if (poll) clearInterval(poll); poll = null; }
    function pick(id) { ws.sceneId = id; APP.state.sceneId = id; history.replaceState(null, "", `#/projects/${ws.pid}/${ws.mode}/${id}`); draw(); }
    function go(sec, sub) { if (sub) APP.LS.set(`ws_sub:${ws.pid}:${sec}`, sub); APP.go(`/projects/${ws.pid}/${sec}${ws.sceneId && sec !== "ai" ? "/" + ws.sceneId : ""}`); }
    function setMode(m) { go(m === "ai" ? "ai" : APP.LS.get("ws_sec:" + ws.pid, "storyboard")); }

    // ------------------------------------------------------------------ chrome: compact header, mode switch, section tabs, live progress strip
    function stats() {
      const p = ws.project, infos = ws.scenes.map(s => APP.sceneInfo(s, p)), n = infos.length, c = k => infos.filter(i => i.key === k).length;
      const done = infos.filter(i => i.hasVideo).length, frames = infos.filter(i => i.hasFrame).length, active = infos.filter(i => i.busy).length, fix = c("failed"), review = c("review"), approved = infos.filter(i => i.approved).length;
      const pct = n ? (frames / n) * 0.4 + (done / n) * 0.6 : 0;
      const status = !n ? ["Empty", ""] : active ? ["Generating", "run"] : fix ? ["Needs fix", "bad"] : review ? ["To review", "warn"] : done === n ? ["Done", "ok"] : ["In progress", ""];
      return { n, done, frames, active, fix, review, approved, pct, status };
    }
    function todaySpend() { const today = new Date().toDateString(); return ((APP.gpu && APP.gpu.recent) || []).filter(j => new Date((j.finished || 0) * 1000).toDateString() === today).reduce((a, j) => a + (j.cost || 0), 0); }
    function stripChips(st) {
      const g = APP.gpu || {}, chip = (cls, bold, label) => h("span", { class: "c " + cls }, h("i"), h("b", {}, bold), label ? " " + label : "");
      return [chip("ok", st.done + "/" + st.n, "done"), st.active ? chip("run", st.active, "active") : null, st.fix ? chip("bad", st.fix, "needs fix") : null, st.review ? chip("warn", st.review, "to review") : null,
        h("span", { class: "c" }, h("i"), (g.label || "GPU") + (g.running && g.running.length ? " · " + g.running.length + " job" + (g.running.length > 1 ? "s" : "") : "")), h("span", { class: "c" }, h("b", {}, APP.money(todaySpend())), "today")];
    }
    function updateStrip() { const el = document.getElementById("ws-strip"); if (!el || !ws) return; const st = stats(); el.replaceChildren(...stripChips(st).filter(Boolean)); const pb = document.getElementById("ws-pb"); if (pb) { pb.style.width = Math.round(st.pct * 100) + "%"; pb.parentElement.setAttribute("aria-valuenow", Math.round(st.pct * 100)); pb.parentElement.classList.toggle("bad", st.fix > 0); } }
    function tabsEl(items, cur, onPick, cls = "ws-tabs") {
      const bar = h("div", { class: cls, role: "tablist" }, items.map(([k, l]) => h("button", { type: "button", role: "tab", class: k === cur ? "on" : "", "aria-selected": k === cur, onclick: () => onPick(k) }, l)));
      const wrap = h("div", { class: "ws-tabs-wrap" }, bar), edges = () => { wrap.classList.toggle("l", bar.scrollLeft > 4); wrap.classList.toggle("r", bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 4); };
      bar.addEventListener("scroll", edges, { passive: true });
      setTimeout(() => { const on = bar.querySelector(".on"); if (on) bar.scrollLeft = on.offsetLeft - (bar.clientWidth - on.offsetWidth) / 2; edges(); }, 0);   // the selected section is always visible
      return wrap;
    }
    const SUBS = { videos: [["clips", "Clips"], ["editor", "Editor"]], settings: [["look", "Look"], ["studioflows", "Workflows"], ["queue", "Queue"]] };

    function draw() {
      if (!ws) return;
      const { project: p, scenes, mode } = ws, st = stats(), ai = mode === "ai";
      const head = h("div", { class: "ws-head2" },
        h("button", { class: "ds-btn icon ghost", "aria-label": "All projects", onclick: () => APP.go("/projects") }, icon("back")),
        h("div", { class: "t" }, h("h1", { title: txt(p.name, "Untitled project") }, txt(p.name, "Untitled project")),
          h("div", { class: "ws-meta" }, h("span", { class: "ds-pill" }, p.aspect), h("span", {}, `${st.n} scene${st.n === 1 ? "" : "s"}`), h("span", { class: "ds-pill " + st.status[1] }, st.status[0]))),
        ai ? null : h("button", { class: "ds-btn icon", "aria-label": "Open AI Director chat", title: "AI Director chat", onclick: () => chatSheet() }, icon("sparkle")),
        h("button", { class: "ds-btn icon", "aria-label": "Project menu", onclick: () => projectMenu() }, icon("dots")));
      const prog = h("div", { class: "ws-prog" + (st.fix ? " bad" : ""), role: "progressbar", "aria-label": "Project progress", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(st.pct * 100) }, h("i", { id: "ws-pb", style: `width:${Math.round(st.pct * 100)}%` }));
      const modeSw = h("div", { class: "ws-mode", role: "tablist", "aria-label": "Mode" }, [["manual", "Manual Editor", "film"], ["ai", "AI Director", "sparkle"]].map(([k, l, ic]) => h("button", { type: "button", role: "tab", class: (k === "ai") === ai ? "on" : "", "aria-selected": (k === "ai") === ai, onclick: () => setMode(k) }, icon(ic), l)));
      const sec = ws.mode, sub = ws.sub, legacyNow = !ai && ((sec === "videos" && sub === "editor") || (sec === "settings" && (sub === "studioflows" || sub === "queue"))), key = pid_() + ":" + sec + ":" + sub;
      if (!legacyNow && legacy.parentElement !== host) host.append(legacy);   // the old screens go back to their hidden home when not in use
      const reuse = legacyNow && ws.legacyBody && ws.legacyKey === key;   // keep the mounted Editor / Workflows screen (and anything not saved yet) untouched by refreshes
      if (ai) { ws.legacyBody = null; ws.legacyKey = ""; legacy.style.display = "none"; rootEl.replaceChildren(h("div", { class: "ws ws-ai" }, head, prog, modeSw, chatNode())); chatNode().classList.toggle("compact", false); return; }
      const strip = h("div", { class: "ws-strip", id: "ws-strip", "aria-label": "Generation progress", "aria-live": "off" }, stripChips(st).filter(Boolean));
      const tabs = tabsEl(SECTIONS, sec, k => go(k)), subseg = SUBS[sec] ? h("div", { class: "ws-subseg", role: "tablist" }, SUBS[sec].map(([k, l]) => h("button", { type: "button", role: "tab", class: k === sub ? "on" : "", "aria-selected": k === sub, onclick: () => go(sec, k) }, l))) : null;
      const body = reuse ? ws.legacyBody : h("div", { id: "ws-content", class: "ds-stack", style: "min-width:0" });
      ws.legacyBody = legacyNow ? body : null; ws.legacyKey = legacyNow ? key : "";
      const wsEl = h("div", { class: "ws" }, head, prog, modeSw, tabs, strip, subseg, body);
      rootEl.replaceChildren(wsEl);
      if (reuse) { legacy.style.display = ""; return; }
      if (sec === "storyboard") galleryMode(body); else if (sec === "scenes") storyboardMode(body); else if (sec === "characters") charactersMode(body);
      else if (sec === "videos") { if (sub === "editor") legacyMode(body, "editor"); else videosMode(body); } else if (sec === "settings") { if (sub === "look") directorMode(body); else legacyMode(body, "automation"); }
      wsEl.classList.toggle("has-bar", !!wsEl.querySelector(".ws-bar"));
    }

    // ------------------------------------------------------------------ Storyboard gallery: 9:16 cells, lazy small thumbnails, tap = full-screen viewer with the ORIGINAL picture
    const shortStatus = info => info.key === "failed" ? ["Needs fix", "bad"] : info.busy ? ["Generating", "run"] : info.hasVideo ? ["Video", "ok"] : info.key === "rejected" ? ["Rejected", "bad"] : info.approved ? ["Approved", "ok"] : info.hasFrame ? ["To review", "warn"] : info.key === "draft" ? ["Draft", ""] : info.key === "await_import" ? ["Needs picture", "warn"] : ["No frame", ""];
    function viewerItems(filterFn) {
      const p = ws.project, out = [];
      ws.scenes.forEach((s, i) => { if (!s.start_asset_url || (filterFn && !filterFn(s))) return; const info = APP.sceneInfo(s, p), [lab, tone] = shortStatus(info); out.push({ url: s.start_asset_url, thumb: APP.thumbPeek ? APP.thumbPeek("a" + s.start_asset, 360) : "", title: `Scene ${i + 1}${s.title && !/^scene \d+$/i.test(s.title.trim()) ? " · " + s.title : ""}`, status: lab, tone, scene: s, id: s.id, filename: `scene-${i + 1}` }); });
      return out;
    }
    function openViewer(sc) {
      const items = viewerItems(), idx = Math.max(0, items.findIndex(x => x.id === sc.id)); if (!items.length) return;
      APP.viewer(items, idx, { onReview: it => APP.openReview(it.scene, ws.project, ctx()) });
    }
    function cell(sc, i, p, onTap, video) {
      const info = APP.sceneInfo(sc, p), [lab, tone] = shortStatus(info), fr = h("div", { class: "gl-frame", style: `--ar:${APP.arCss(p.aspect)}` });
      if (info.hasFrame) { fr.classList.add("sk"); const im = APP.lazyThumb ? APP.lazyThumb("a" + sc.start_asset, sc.start_asset_url, `Scene ${i + 1}`) : h("img", { src: sc.start_asset_url, loading: "lazy", alt: "" }); im.addEventListener("load", () => fr.classList.remove("sk")); im.addEventListener("error", () => fr.classList.remove("sk")); fr.append(im); }
      else fr.append(h("div", { class: "gl-empty" }, icon(info.busy ? "sparkle" : "img"), info.busy ? "Making the frame…" : "No frame yet"));
      const cap = h("div", { class: "gl-cap" }, h("b", {}, txt(sc.title, "Scene " + (i + 1))), h("span", {}, `${sc.duration || 6}s${video ? (info.hasVideo ? " · video ready" : "") : ""}`));
      return h("button", { type: "button", class: "gl-cell " + tone, onclick: onTap, "aria-label": `Scene ${i + 1}, ${lab}. ${info.hasFrame ? "Open full screen" : "Open scene"}` }, fr, h("span", { class: "gl-num" }, i + 1), h("span", { class: "gl-st" }, h("i"), lab), cap);
    }
    function emptyScenes(body) {
      body.append(h("div", { class: "ds-empty" }, icon("film"), h("b", {}, "No scenes yet"), "Plan the story first. Each scene becomes one start frame and one video.",
        h("div", { class: "ds-row ds-wrap", style: "justify-content:center" }, h("button", { class: "ds-btn pri", onclick: () => actions.addScene() }, icon("plus"), "Add a scene"), h("button", { class: "ds-btn", onclick: () => actions.plan() }, icon("sparkle"), "Auto-plan scenes"), h("button", { class: "ds-btn", onclick: () => actions.importScenes() }, "Import JSON"))));
    }
    function galleryMode(body) {
      const { project: p, scenes } = ws; if (!scenes.length) return emptyScenes(body);
      const infos = scenes.map(s => APP.sceneInfo(s, p)), F = [["all", "All", () => true], ["review", "To review", i => i.key === "review"], ["approved", "Approved", i => i.approved && !i.hasVideo], ["run", "Generating", i => i.busy], ["fix", "Needs fix", i => i.key === "failed" || i.key === "rejected"]];
      const cnt = k => infos.filter(F.find(f => f[0] === k)[2]).length, cur = ws.glFilter || "all", pred = F.find(f => f[0] === cur)[2];
      const bar = h("div", { class: "gl-bar", role: "tablist", "aria-label": "Filter scenes" }, F.map(([k, l]) => h("button", { type: "button", role: "tab", class: "ds-chip" + (k === cur ? " on" : ""), "aria-selected": k === cur, onclick: () => { ws.glFilter = k; draw(); } }, `${l} ${cnt(k)}`)));
      const shown = scenes.map((s, i) => [s, i]).filter(([s, i]) => pred(infos[i]));
      const grid = h("div", { class: "gl-grid", role: "list" }, shown.map(([s, i]) => cell(s, i, p, () => { if (s.start_asset_url) openViewer(s); else { ws.sceneId = s.id; go("scenes"); } })));
      body.append(window.APP && APP.live ? APP.live.card(p) : null, window.IMP ? IMP.card(p, scenes, { actions, chars: ws.chars, refresh: () => refresh(true) }) : null, window.BULK ? window.BULK.bar({ project: p, scenes, refresh: () => refresh(true), redraw: () => draw() }) : null, bar, shown.length ? grid : h("div", { class: "ds-empty" }, "No scenes in this filter."), h("div", { class: "ds-small", style: "text-align:center" }, "Tap a picture to see it full screen. Pinch or double-tap to zoom."));
    }
    function videosMode(body) {
      const { project: p, scenes } = ws; if (!scenes.length) return emptyScenes(body);
      const grid = h("div", { class: "gl-grid" }, scenes.map((s, i) => cell(s, i, p, () => clipSheet(s, i), true)));
      body.append(h("div", { class: "ds-small" }, "Tap a scene to watch its video or make one. Videos only start when you confirm the cost."), grid);
    }
    function clipSheet(sc, i) {
      const p = ws.project, info = APP.sceneInfo(sc, p);
      if (info.hasVideo) { const items = ws.scenes.map((s, j) => s.video_asset_url ? { video: s.video_asset_url, thumb: s.start_asset_url || "", title: `Scene ${j + 1} · video`, status: "Video", tone: "ok", id: s.id, filename: `scene-${j + 1}` } : null).filter(Boolean); return APP.viewer(items, Math.max(0, items.findIndex(x => x.id === sc.id)), {}); }
      APP.sheet((box, close) => box.append(h("h2", { class: "ds-h2", style: "font-size:17px;margin-bottom:6px" }, `Scene ${i + 1} · ${txt(sc.title, "Untitled")}`), h("div", { class: "ds-row ds-wrap", style: "margin-bottom:12px" }, h("span", { class: "ds-pill " + shortStatus(info)[1] }, shortStatus(info)[0]), h("span", { class: "ds-pill" }, "~" + APP.money(APP.estimate(sc, "clip")) + " per video")),
        h("p", { class: "ds-sub" }, info.busy ? "This scene is being made on the GPU. You can leave this page." : !info.hasFrame ? "Make and approve the start frame first (Scenes tab)." : !info.approved ? "Approve the start frame first, then make the video." : "The start frame is approved. A video takes about 7 minutes on the GPU."),
        h("div", { class: "ds-row" }, h("button", { class: "ds-btn ghost", style: "flex:1", onclick: close }, "Close"), h("button", { class: "ds-btn", style: "flex:1", onclick: () => { close(); ws.sceneId = sc.id; go("scenes"); } }, "Open scene"),
          info.approved && !info.busy ? h("button", { class: "ds-btn pri", style: "flex:1.3", onclick: () => { close(); actions.video(sc); } }, icon("play"), "Make video") : null)));
    }
    function charactersMode(body) {
      const p = ws.project, inProject = new Set([...(p.characters || []), ...ws.scenes.flatMap(s => s.characters || [])]), mine = ws.chars.filter(c => inProject.has(c.id)), rest = ws.chars.filter(c => !inProject.has(c.id));
      const uses = c => ws.scenes.filter(s => (s.characters || []).includes(c.id)).length;
      const card = (c, add) => h("div", { class: "ch-card" }, h("div", { class: "th" }, c.thumb ? h("img", { src: c.thumb, alt: c.name, loading: "lazy", decoding: "async" }) : icon("user")),
        h("div", { class: "b" }, h("b", {}, txt(c.name, "Unnamed")), h("span", {}, add ? `${(c.refs || []).length} reference${(c.refs || []).length === 1 ? "" : "s"}` : `${(c.refs || []).length} reference${(c.refs || []).length === 1 ? "" : "s"} · in ${uses(c)} scene${uses(c) === 1 ? "" : "s"}`)),
        add ? h("button", { class: "ds-btn sm", onclick: async () => { try { await APP.saveProject(p, { characters: [...(p.characters || []), c.id] }); await refresh(true); } catch (e) { APP.fail(e); } } }, icon("plus"), "Add")
          : h("button", { class: "ds-btn sm", onclick: () => window.SP.editCharacter(c, () => { APP.changed("chars"); refresh(true); }) }, "Edit"));
      body.append(h("div", { class: "ds-h2" }, "In this project"), mine.length ? h("div", { class: "ch-list" }, mine.map(c => card(c, false))) : h("div", { class: "ds-empty" }, icon("user"), h("b", {}, "No characters in this project"), "Add saved characters below. Their reference photos keep faces consistent in every scene."),
        rest.length ? [h("div", { class: "ds-h2", style: "margin-top:8px" }, "Saved in your Library"), h("div", { class: "ch-list" }, rest.map(c => card(c, true)))] : null, h("div", { class: "ds-small" }, "Reference photos are never changed here. Open the Library to add or replace them."));
    }

    // ------------------------------------------------------------------ shared pieces
    const thumbOf = (sc, project) => { const url = sc.start_asset_url; return h("div", { class: "ds-thumb", style: `--ar:${APP.arCss(project.aspect)}` }, url ? (APP.lazyThumb ? APP.lazyThumb("a" + sc.start_asset, url, "") : h("img", { src: url, loading: "lazy", alt: "", decoding: "async" })) : (sc.video_asset_url ? h("video", { src: sc.video_asset_url + "#t=0.3", muted: true, preload: "metadata" }) : icon("img"))); };
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
      const view = swipeable(h("div", { class: "ws-view" + (land ? " land" : "") }, h("div", { class: "ds-thumb contain", style: `--ar:${ar}`, onclick: () => info.hasFrame && openViewer(sc), title: info.hasFrame ? "Tap for full screen" : "" }, inner)));
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
    // Sticky action bar (fixed above the bottom navigation on phones, safe-area aware). Unavailable actions are disabled AND explained in the hint line.
    function actionBar(sc, info) {
      const est = APP.money(APP.estimate(sc, "frame")), clip = APP.money(APP.estimate(sc, "clip"));
      const b = (cls, label, fn, ico, dis, why) => h("button", { type: "button", class: "ds-btn " + cls, disabled: !!dis, title: dis && why ? why : label, "aria-label": label + (dis && why ? ". " + why : ""), onclick: fn }, ico ? icon(ico) : null, h("span", { class: "lbl" }, label));
      let hint = "", btns = [];
      if (info.busy) { hint = "Working on the GPU. You can leave this page; it keeps going."; btns = [b("", info.key === "video_run" ? "Making video\u2026" : "Making frame\u2026", null, null, true, "Wait until it finishes"), sc.job_id ? b("bad", "Cancel", () => actions.cancel(sc), "x") : null]; }
      else if (!info.hasFrame) { const no = !sc.action && !sc.title; hint = no ? "Describe what happens in the scene first." : `Uses the GPU: about ${est}. You confirm before it starts.`; btns = [b("pri", `Make frame \u00b7 ~${est}`, () => actions.frame(sc), "sparkle", no, "Describe the scene first")]; }
      else if (info.key === "review" || info.key === "rejected") { hint = `Approve keeps this frame. Redo uses the GPU (~${est}) and keeps the old frame in Versions.`; btns = [b("bad", "Reject", () => actions.reject(sc), "x"), b("", "Redo", () => actions.frame(sc), "refresh"), b("ok", "Approve", () => actions.approve(sc), "check", info.review === "approved", "Already approved")]; }
      else if (info.key === "approved") { hint = `Frame approved. A video costs about ${clip} and takes ~7 min; you confirm first.`; btns = [b("", "New frame", () => actions.frame(sc), "refresh"), b("pri", `Make video \u00b7 ~${clip}`, () => actions.video(sc), "play")]; }
      else { hint = "Video ready."; btns = [b("", "Full screen", () => openViewer(sc), "zoom", !sc.start_asset_url, "No frame to show"), b("", "New video", () => actions.video(sc), "play"), sc.video_asset ? h("a", { class: "ds-btn", href: sc.video_asset_url, download: (sc.title || "scene") + ".mp4", "aria-label": "Save the video" }, icon("down"), h("span", { class: "lbl" }, "Save")) : null]; }
      return h("div", { class: "ws-bar", role: "group", "aria-label": "Scene actions" }, h("div", { class: "ws-hint" }, hint), h("div", { class: "ws-btns" }, btns.filter(Boolean)));
    }

    // ------------------------------------------------------------------ Storyboard mode
    // desktop: drag the two splitters to resize the scene list and the properties panel (remembered)
    function splitters(bodyEl) {
      const set = (k, v) => { bodyEl.style.setProperty(k, v + "px"); APP.LS.set("ws" + k, String(v)); };
      for (const k of ["--rail-w", "--panel-w"]) { const v = APP.LS.get("ws" + k, ""); if (v) bodyEl.style.setProperty(k, v + "px"); }
      for (const which of ["rail", "panel"]) {
        const el = h("div", { class: "ws-split " + which, role: "separator", "aria-orientation": "vertical", title: "Drag to resize" });
        el.onpointerdown = e => { el.setPointerCapture(e.pointerId); el.classList.add("drag"); const r = bodyEl.getBoundingClientRect();
          el.onpointermove = ev => { if (which === "rail") set("--rail-w", Math.round(Math.min(340, Math.max(120, ev.clientX - r.left)))); else set("--panel-w", Math.round(Math.min(600, Math.max(280, r.right - ev.clientX)))); };
          el.onpointerup = () => { el.classList.remove("drag"); el.onpointermove = null; }; };
        bodyEl.append(el);
      }
    }
    function storyboardMode(body) {
      const { project: p, scenes } = ws, sc = cur();
      if (!scenes.length) { body.append(h("div", { class: "ds-empty" }, icon("film"), h("b", {}, "No scenes yet"), "Plan the story first. Each scene becomes one start frame and one video.",
        h("div", { class: "ds-row ds-wrap", style: "justify-content:center" }, h("button", { class: "ds-btn pri", onclick: () => actions.addScene() }, icon("plus"), "Add a scene"), h("button", { class: "ds-btn", onclick: () => actions.plan() }, icon("sparkle"), "Auto-plan scenes"), h("button", { class: "ds-btn", onclick: () => actions.importScenes() }, "Import JSON")))); return; }
      const info = APP.sceneInfo(sc, p);
      body.append(h("div", { class: "ws-body" }, rail(), h("div", { class: "ws-stage" }, h("div", { class: "ds-row ds-between ds-wrap" }, h("div", {}, h("div", { class: "ds-h2" }, `Scene ${scenes.indexOf(sc) + 1}${sc.title && !/^scene \d+$/i.test(sc.title.trim()) ? " · " + sc.title : ""}`), h("div", { class: "ds-small" }, `${sc.duration || 6}s${sc.location ? " · " + sc.location : ""}`)), statusRow(sc, info)),
        stage(sc, info), sc.error ? h("div", { class: "ck" }, h("span", { class: "ds-pill bad" }, "Error"), h("div", {}, APP.txt(sc.error), h("span", {}, "Try again; if it keeps failing, check Settings → Diagnostics."))) : null, actionBar(sc, info)),
        propsPanel(sc, info)));
      const wb = body.querySelector(".ws-body"); if (wb) splitters(wb);
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
      if (!ws || ws.mode !== "settings") return;
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
      body.append(h("div", { class: "ws-body" }, rail(), h("div", { class: "ws-stage" }, sc ? [h("div", { class: "ds-h2" }, `Scene ${ws.scenes.indexOf(sc) + 1} · camera & look`), stage(sc, APP.sceneInfo(sc, p))[1], h("div", { class: "ds-card flat" }, h("div", { class: "ds-small", style: "margin-bottom:6px" }, "Prompt sent to the video model"), preview)] : h("div", { class: "ds-empty" }, icon("film"), h("b", {}, "Add scenes in Storyboard first"))),
        h("div", { class: "ws-panel" }, h("p", { class: "ds-small", style: "margin:0" }, "Presets are written into the prompt. They steer the model but are not guaranteed camera controls."),
          h("details", { class: "ws-sec", open: true }, h("summary", {}, "Scene overrides"), h("div", { class: "in" }, sc ? [h("div", { class: "ds-field" }, h("label", {}, "Camera movement"), camera), ...over, h("div", { class: "ds-field" }, h("label", {}, "Video quality"), quality), h("div", { class: "ds-field" }, h("label", {}, "Video model"), h("div", { class: "ds-pill" }, "MiniMax-H3 · image to video with sound"))] : h("div", { class: "ds-sub" }, "Select a scene."))),
          h("details", { class: "ws-sec" }, h("summary", {}, "Project look (all scenes)"), h("div", { class: "in" }, ...lookCards, saved)))));
      showPrompt();
    }

    // ------------------------------------------------------------------ Editor and Automation: the existing screens, mounted inside the workspace
    async function legacyMode(body, mode) {
      const { pid } = ws;
      legacy.style.display = ""; legacy.classList.add("ws-legacy"); body.append(legacy);
      try { if (mode === "editor") { await window.SP.use.editor(pid); window.showTab("editor"); } else { const k = ws.sub === "queue" ? "queue" : "studioflows"; if (k === "studioflows") await window.SP.use.flows(pid); window.showTab(k); } } catch (e) { APP.fail(e); }
    }

    // ------------------------------------------------------------------ actions (everything that can cost money asks first, and never runs by itself)
    // start a GPU job without freezing the screen: the job runs in the background, the workspace shows its progress and a toast announces the result
    function kick(key, label, starter) {
      ws.kickUntil = Date.now() + 90000;
      const p = APP.once(key, async () => { try { await starter(); APP.toast(label + " is ready.", "ok"); } catch (e) { APP.fail(e, label); } finally { try { await refresh(); } catch {} } });
      [1500, 4000, 9000].forEach(ms => setTimeout(() => refresh().catch(() => {}), ms));
      return p;
    }
    const viaChat = sc => !!(sc.settings && sc.settings.cm) && !!APP.LS.get("connector_act", "");   // chat frames are decided in the chat only when the actions link was added; otherwise this app decides (locally)
    const actions = {
      async addScene() { try { const s = await api("scenes", { project_id: ws.pid, title: "New scene", characters: ws.project.characters }); ws.sceneId = s.id; APP.changed("scenes"); await refresh(); } catch (e) { APP.fail(e, "Could not add the scene"); } },
      async plan() { await window.SP.sb.use(ws.pid); window.SP.sb.planDialog(); },
      async importScenes() { await window.SP.sb.use(ws.pid); window.SP.sb.importDialog(); },
      async frame(sc) {
        if (window.IMP && IMP.gpuFramesBlocked(ws.project)) return IMP.sheet(ws.project, sc, { refresh: () => refresh(true), scenes: ws.scenes });   // "ChatGPT Storyboard Import": the replacement is imported, never made on the GPU
        if (viaChat(sc)) return APP.chatAct("regenerate", sc, ws.project);
        const info = APP.sceneInfo(sc, ws.project);
        if (!(await APP.confirm(info.hasFrame ? "Make a new start frame?" : "Make the start frame?", `Uses the GPU (about ${APP.money(APP.estimate(sc, "frame"))} of RunPod credit).${info.hasFrame ? " The current frame stays in Frame versions." : ""}${APP.budgetNote ? APP.budgetNote(APP.estimate(sc, "frame")) : ""}${APP.gpu.state === "asleep" ? "\nThe GPU is asleep and needs about 5 minutes to wake." : ""}`, "Generate"))) return;
        kick("frame:" + sc.id, "Start frame", async () => { await window.SP.sb.use(ws.pid); await window.SP.sb.frame(sc.id); });
        APP.toast("Making the start frame. You can leave this page; it keeps going.", "ok");
      },
      async import(sc) { if (window.IMP) IMP.sheet(ws.project, sc, { refresh: () => refresh(true), scenes: ws.scenes }); },
      async importMany() { if (window.IMP) IMP.bulk(ws.project, ws.scenes, { refresh: () => refresh(true) }); },
      async video(sc) {
        if (viaChat(sc)) return APP.chatAct("approve", sc, ws.project);
        const info = APP.sceneInfo(sc, ws.project);
        if (!info.approved) return APP.toast("Approve the start frame first.");
        if (!(await APP.confirm("Make the video?", `Uses the GPU for about 7 minutes (about ${APP.money(APP.estimate(sc, "clip"))} of RunPod credit). This only starts because you pressed Generate.${APP.budgetNote ? APP.budgetNote(APP.estimate(sc, "clip")) : ""}`, "Generate video"))) return;
        kick("video:" + sc.id, "Video", async () => { await window.SP.sb.use(ws.pid); await window.SP.sb.video(sc.id); });
        APP.toast("Making the video (about 7 minutes). You can leave this page; it keeps going.", "ok");
      },
      async approve(sc) {
        if (viaChat(sc)) return APP.chatAct("approve", sc, ws.project);
        try { await APP.saveScene(sc, { settings: { ...(sc.settings || {}), review: "approved", approved_at: Date.now() / 1000, approved_asset: sc.start_asset } }); APP.toast("Frame approved" + (sc.settings && sc.settings.cm ? " in this app (the chat movie itself is unchanged)" : "") + ". Nothing is generated until you press Make video.", "ok"); await refresh(true); } catch (e) { APP.fail(e); }
      },
      async reject(sc) {
        if (viaChat(sc)) return APP.chatAct("reject", sc, ws.project);
        try { await APP.saveScene(sc, { settings: { ...(sc.settings || {}), review: "rejected" } }); await refresh(true); APP.toast("Frame rejected. Generate a new one when you are ready."); } catch (e) { APP.fail(e); }
      },
      async cancel(sc) { if (await APP.confirm("Cancel this job?", "GPU time already used is not refunded.", "Cancel job", true)) { try { await fetch("/api/cancel/" + sc.job_id, { method: "POST" }); APP.toast("Cancelling…"); setTimeout(refresh, 1500); } catch (e) { APP.fail(e); } } },
    };
    APP.wsActions = actions;
    async function deleteProject(p) {
      const n = (ws && ws.pid === p.id ? ws.scenes.length : 0);
      if (!(await APP.confirm("Delete this project?", `\u201c${txt(p.name, "Untitled")}\u201d${n ? " and its " + n + " scene" + (n === 1 ? "" : "s") : ""} will be removed from your projects. Pictures, videos and characters stay in the Library, and you can restore the project from \u201cRecently deleted\u201d.`, "Delete project", true))) return;
      try { await api("projects/" + p.id + "/delete", {}); stopPoll(); ws = null; APP.changed("all"); APP.toast("Project deleted. You can restore it from Projects \u2192 Recently deleted.", "ok"); APP.go("/projects"); } catch (e) { APP.fail(e, "Could not delete the project"); }
    }
    APP.deleteProject = deleteProject;
    async function deletedSheet() {
      const gone = (await api("projects?deleted=1")).items || [];
      APP.sheet((box, close) => box.append(h("h2", { class: "ds-h2", style: "font-size:17px;margin-bottom:10px" }, "Recently deleted"), gone.length ? h("div", { class: "ds-stack", style: "gap:8px" }, gone.map(p => h("div", { class: "ds-row ds-between", style: "gap:8px" }, h("div", { class: "ds-grow", style: "min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, txt(p.name, "Untitled")),
        h("button", { class: "ds-btn sm", onclick: async () => { try { await api("projects/" + p.id + "/restore", {}); APP.changed("all"); close(); APP.toast("Project restored.", "ok"); } catch (e) { APP.fail(e); } } }, "Restore")))) : h("p", { class: "ds-sub" }, "Nothing here."), h("button", { class: "ds-btn", style: "width:100%;margin-top:12px", onclick: close }, "Close")));
    }
    function projectMenu() {
      const p = ws.project, sc = cur();
      APP.sheet((box, close) => box.append(h("h2", { class: "ds-h2", style: "font-size:17px;margin-bottom:10px" }, txt(p.name, "Project")), h("div", { class: "ds-stack", style: "gap:8px" },
        h("button", { class: "ds-btn", onclick: () => { close(); actions.addScene(); } }, icon("plus"), "Add scene"), h("button", { class: "ds-btn", onclick: () => { close(); actions.plan(); } }, icon("sparkle"), "Auto-plan scenes"), h("button", { class: "ds-btn", onclick: () => { close(); actions.importScenes(); } }, "Import scenes (JSON)"),
        sc ? h("button", { class: "ds-btn", onclick: async () => { close(); try { await api(`scenes/${sc.id}/duplicate`, {}); APP.changed("scenes"); await refresh(); } catch (e) { APP.fail(e); } } }, "Duplicate this scene") : null,
        sc ? h("button", { class: "ds-btn", onclick: async () => { close(); const i = ws.scenes.indexOf(sc), ids = ws.scenes.map(s => s.id); if (i > 0) { [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; await api("scenes/reorder", { project: ws.pid, ids }); APP.changed("scenes"); await refresh(); } } }, "Move scene earlier") : null,
        h("button", { class: "ds-btn", onclick: () => { close(); window.SP.editProject(p, () => { APP.changed("projects"); refresh(); }); } }, "Project settings"),
        h("button", { class: "ds-btn bad", onclick: () => { close(); deleteProject(p); } }, icon("x"), "Delete project"),
        sc ? h("button", { class: "ds-btn bad", onclick: async () => { close(); if (await APP.confirm("Delete this scene?", "Its frames and video stay in the Library.", "Delete", true)) { try { await api(`scenes/${sc.id}/delete`, {}); APP.changed("scenes"); await refresh(); } catch (e) { APP.fail(e); } } } }, "Delete this scene") : null)));
    }
    // keyboard: scene navigation, approve, regenerate (desktop)
    window.addEventListener("keydown", e => {
      if (host.hidden || !ws || ws.mode !== "scenes" || document.querySelector(".rv,.ds-sheet,.vw") || (e.target.closest && e.target.closest("input,textarea,select"))) return;
      const i = ws.scenes.findIndex(s => s.id === ws.sceneId);
      if (e.key === "ArrowRight" && i < ws.scenes.length - 1) pick(ws.scenes[i + 1].id); else if (e.key === "ArrowLeft" && i > 0) pick(ws.scenes[i - 1].id);
      else if (e.key.toLowerCase() === "a" && cur() && APP.sceneInfo(cur()).key === "review") actions.approve(cur()); else if (e.key.toLowerCase() === "r" && cur()) actions.frame(cur());
    });
    setTimeout(() => { if (!host.hidden) renderRoute(); }, 0);
  }
})();
