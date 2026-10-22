// AI Studio v2 core: shared state, data cache, GPU service, helpers (icons, toasts, sheets). Loaded after the Studio screens; every screen of the new
// interface reads the same project / scene selection and the same cached data from here, so the modes never disagree.
"use strict";
(() => {
  if (!window.SP) return;
  const { api, h } = window.SP;
  const LS = { get: (k, d = null) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const listeners = {};
  const APP = window.APP = {
    LS, api, h,
    on(evt, fn) { (listeners[evt] ||= new Set()).add(fn); return () => listeners[evt].delete(fn); },
    emit(evt, data) { (listeners[evt] || []).forEach(fn => { try { fn(data); } catch (e) { console.warn(evt, e); } }); },
    state: { projectId: LS.get("sb_project", ""), sceneId: "", mode: "storyboard" },
  };

  // ------------------------------------------------------------------ small helpers
  APP.txt = (v, fallback = "") => (v === null || v === undefined || v === "null" || v === "undefined" || v === "NaN") ? fallback : String(v);
  APP.money = n => n == null || isNaN(n) ? "–" : "$" + Number(n).toFixed(Number(n) < 10 ? 2 : 0);
  APP.ago = t => { if (!t) return ""; const s = Math.max(0, Math.round(Date.now() / 1000 - t)); return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " d ago"; };
  APP.arCss = aspect => ({ "9:16": "9 / 16", "16:9": "16 / 9", "1:1": "1 / 1", "4:3": "4 / 3", "21:9": "21 / 9" }[aspect] || "16 / 9");
  APP.isPortrait = aspect => ["9:16"].includes(aspect);
  const PATH = { home: "M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z", film: "M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4", lib: "M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 15l4-4 4 4 3-3 5 5M9 8.5h.01", gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
    plus: "M12 5v14M5 12h14", check: "M5 12.5l4.5 4.5L19 7.5", x: "M6 6l12 12M18 6L6 18", back: "M15 5l-7 7 7 7", refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7", play: "M7 4.5v15l12-7.5z", zoom: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3M8 11h6M11 8v6", full: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
    cmp: "M12 3v18M4 7h5v10H4zM15 7h5v10h-5z", user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0", sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z", bolt: "M13 2L4 14h7l-1 8 9-12h-7z", search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3", img: "M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM9 9.5h.01M4 16l5-5 4 4 3-3 4 4", vid: "M4 6h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM17 10l5-3v10l-5-3", warn: "M12 3l10 18H2zM12 10v5M12 18.5h.01",
    star: "M12 3l2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.3l1.1-6.2L3 9.7l6.2-.9z", dots: "M5 12h.01M12 12h.01M19 12h.01", up: "M12 19V5M5 12l7-7 7 7", link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1", mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" };
  APP.icon = (name, cls = "ds-ico") => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", cls); s.setAttribute("aria-hidden", "true"); const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", PATH[name] || PATH.dots); s.append(p); return s; };

  // ------------------------------------------------------------------ toasts, sheets, errors
  let toastHost;
  APP.toast = (msg, kind = "", ms = 4200) => {
    toastHost ||= document.body.appendChild(h("div", { class: "ds-toast-host", "aria-live": "polite" }));
    const t = h("div", { class: "ds-toast " + kind }, msg); toastHost.append(t); setTimeout(() => t.remove(), ms); return t;
  };
  APP.fail = (e, what = "") => {
    let m = String((e && e.message) || e || "Something went wrong");
    if (/failed to fetch|networkerror|load failed/i.test(m)) m = "No connection. Check your internet and try again.";
    else if (/quota/i.test(m)) m = "This device is out of storage. Free up space in Settings → Storage.";
    else if (/401|403|unauthor/i.test(m)) m = "RunPod refused the request. Check the API key in Settings.";
    console.warn(what, e); APP.toast((what ? what + ": " : "") + m, "bad", 6500);
  };
  APP.sheet = (build, opts = {}) => {
    const box = h("div", { class: "box" }), wrap = h("div", { class: "ds-sheet" }, box);
    const close = () => { wrap.remove(); document.removeEventListener("keydown", esc); opts.onClose && opts.onClose(); };
    const esc = ev => { if (ev.key === "Escape") close(); };
    wrap.onclick = ev => { if (ev.target === wrap) close(); }; document.addEventListener("keydown", esc); document.body.append(wrap);
    build(box, close); return { close, box };
  };
  APP.confirm = (title, body, okLabel = "Continue", danger = false) => new Promise(res => {
    APP.sheet((box, close) => box.append(h("h2", { class: "ds-h2", style: "font-size:17px;margin-bottom:6px" }, title), h("p", { class: "ds-sub", style: "margin:0 0 16px;white-space:pre-line" }, body),
      h("div", { class: "ds-row" }, h("button", { class: "ds-btn ghost", style: "flex:1", onclick: () => { close(); res(false); } }, "Cancel"),
        h("button", { class: "ds-btn " + (danger ? "bad" : "pri"), style: "flex:1", onclick: () => { close(); res(true); } }, okLabel))), { onClose: () => res(false) });
  });
  // one action at a time per key (prevents double taps from starting paid work twice)
  const running = new Set();
  APP.once = async (key, fn) => { if (running.has(key)) { APP.toast("Already working on that…"); return; } running.add(key); try { return await fn(); } finally { running.delete(key); } };

  // ------------------------------------------------------------------ data cache (shared by every screen), synced across tabs
  const cache = { projects: null, scenes: {}, chars: null, at: {} };
  const bc = (() => { try { return new BroadcastChannel("ai-studio-v2"); } catch { return null; } })();
  APP.changed = (what = "all") => { if (what === "all" || what === "projects") cache.projects = null; if (what === "all" || what === "scenes") cache.scenes = {}; if (what === "all" || what === "chars") cache.chars = null; APP.emit("changed", what); try { bc && bc.postMessage({ what }); } catch {} };
  if (bc) bc.onmessage = e => { const w = (e.data || {}).what || "all"; if (w === "all" || w === "projects") cache.projects = null; if (w === "all" || w === "scenes") cache.scenes = {}; if (w === "all" || w === "chars") cache.chars = null; APP.emit("changed", w); };
  APP.projects = async (force) => (!force && cache.projects) || (cache.projects = (await api("projects")).items);
  APP.chars = async (force) => (!force && cache.chars) || (cache.chars = (await api("characters")).items);
  APP.scenes = async (pid, force) => { if (!pid) return []; if (!force && cache.scenes[pid]) return cache.scenes[pid]; return (cache.scenes[pid] = (await api("scenes?project=" + pid)).items); };
  APP.project = async pid => (await APP.projects()).find(p => p.id === pid) || null;
  APP.saveScene = async (sc, patch) => { const n = await api("scenes", { ...sc, ...patch }); delete cache.scenes[sc.project_id]; APP.changed("scenes"); return n; };
  APP.saveProject = async (p, patch) => { const n = await api("projects", { ...p, ...patch }); cache.projects = null; APP.changed("projects"); return n; };

  // ------------------------------------------------------------------ scene facts: one place decides what a scene's status means
  const EST = { frame: 0.07, clip: 0.2 };
  APP.estimate = (sc, what = "both") => { const clip = EST.clip * (0.7 + 0.3 * (sc.duration || 6) / 6); return what === "frame" ? EST.frame : what === "clip" ? clip : EST.frame + clip; };
  APP.sceneInfo = (sc, project) => {
    const st = sc.settings || {}, busyFrame = sc.status === "keyframe_generating", busyVideo = ["generating", "queued"].includes(sc.status);
    const hasFrame = !!sc.start_asset_url, hasVideo = !!sc.video_asset_url;
    const review = st.review || (st.cstate === "frame_awaiting_approval" ? "pending" : "");
    const approved = review === "approved" || hasVideo || ["frame_done", "video_waiting", "video_generating", "video_done"].includes(st.cstate);
    const idv = st.cidentity || null;
    let key = "empty", label = "No frame yet", tone = "";
    if (busyFrame) { key = "frame_run"; label = "Making start frame"; tone = "run"; }
    else if (busyVideo) { key = "video_run"; label = "Making video"; tone = "run"; }
    else if (sc.status === "failed") { key = "failed"; label = "Failed"; tone = "bad"; }
    else if (hasVideo) { key = "video_done"; label = "Video ready"; tone = "ok"; }
    else if (hasFrame && review === "rejected") { key = "rejected"; label = "Frame rejected"; tone = "bad"; }
    else if (hasFrame && !approved) { key = "review"; label = "Needs your review"; tone = "warn"; }
    else if (hasFrame) { key = "approved"; label = "Frame approved"; tone = "ok"; }
    else if (sc.action) { key = "draft"; label = "Ready for a frame"; }
    const flags = (st.cflags || []).filter(Boolean);
    return { key, label, tone, hasFrame, hasVideo, approved, review, identity: idv, flags, busy: busyFrame || busyVideo, cost: APP.estimate(sc, hasFrame ? "clip" : "both"), fromChat: !!st.cm, version: (st.frame_history || []).length || st.kv || 1 };
  };
  APP.pipeline = (scenes) => {
    const n = scenes.length, info = scenes.map(s => APP.sceneInfo(s));
    const frames = info.filter(i => i.hasFrame).length, appr = info.filter(i => i.hasFrame && i.approved).length, vids = info.filter(i => i.hasVideo).length;
    const steps = [["Storyboard", n > 0], ["Start frames", n > 0 && frames === n], ["Review", n > 0 && appr === n], ["Video", n > 0 && vids === n], ["Editing", false], ["Export", false]];
    let cur = steps.findIndex(s => !s[1]); if (cur < 0) cur = steps.length - 1;
    return { steps: steps.map((s, i) => ({ name: s[0], done: s[1], cur: i === cur })), frames, appr, vids, n };
  };

  // ------------------------------------------------------------------ GPU + credit service (clear states, no contradictions)
  const gpu = APP.gpu = { state: "unknown", label: "GPU", detail: "Checking…", workers: {}, jobs: {}, running: [], recent: [], balance: null, perHour: null, spent: null, error: "", at: 0 };
  APP.gpuClassify = (health, queue) => {
    const rp = (health && health.runpod) || {}, w = rp.workers || {}, j = rp.jobs || {};
    const up = (w.idle || 0) + (w.ready || 0) + (w.running || 0);
    if ((health && health.error) || (!up && !(w.initializing) && ((w.unhealthy || 0) > 0 || (w.throttled || 0) > 0))) return { state: "unavailable", label: "GPU unavailable", detail: (health && health.error) || "RunPod has no healthy worker right now (throttled or unhealthy). Try again in a few minutes." };
    if (w.running) return { state: "running", label: "GPU running", detail: `${w.running} worker${w.running === 1 ? "" : "s"} working${j.inQueue ? ", " + j.inQueue + " queued" : ""}` };
    if (w.initializing) return { state: "initializing", label: "GPU starting", detail: "A worker is waking up (about 5 minutes). It costs money while it starts." };
    if (up) return { state: "idle", label: "GPU idle", detail: "Awake and ready. Jobs start in seconds; it sleeps by itself after about 10 idle minutes." };
    return { state: "asleep", label: "GPU asleep", detail: "Costs nothing. The first job wakes it (about 5 minutes)." };
  };
  let gpuBusy = false;
  APP.refreshGpu = async (force) => {
    if (gpuBusy || (!force && Date.now() - gpu.at < 8000)) return gpu; gpuBusy = true;
    try {
      const [health, bal, q] = await Promise.all([api("../health").catch(e => ({ error: String(e.message || e) })), api("../balance").catch(() => ({})), api("../queue").catch(() => ({ running: [], recent: [] }))]);
      const c = APP.gpuClassify(health, q), rp = (health.runpod || {});
      Object.assign(gpu, c, { workers: rp.workers || {}, jobs: rp.jobs || {}, running: q.running || [], recent: q.recent || [], balance: bal.balance ?? null, perHour: bal.per_hour ?? (c.state === "asleep" ? 0 : 1.22), spent: q.cost_recent ?? null, error: health.error || "", at: Date.now() });
    } finally { gpuBusy = false; }
    APP.emit("gpu", gpu); paintHeader(); return gpu;
  };
  function paintHeader() {
    const chip = document.getElementById("gpu"); if (!chip) return;
    const dot = chip.querySelector(".dot"), t = chip.querySelector("span:last-child");
    const cls = { running: "run", idle: "idle", initializing: "init", asleep: "off", unavailable: "bad", unknown: "off" }[gpu.state] || "off";
    if (dot) dot.className = "dot " + cls; if (t) t.textContent = gpu.label.replace("GPU ", "");
    chip.title = gpu.detail;
  }
  window.refreshGpu = () => APP.refreshGpu(true);   // the old header chip refresh now uses the same classification
  setInterval(() => { if (document.visibilityState === "visible") APP.refreshGpu(); }, 15000);

  // ------------------------------------------------------------------ selection (kept in sync with the old screens through the shared localStorage key)
  APP.select = (pid, sceneId) => { APP.state.projectId = pid || ""; APP.state.sceneId = sceneId || ""; LS.set("sb_project", pid || ""); APP.emit("select", APP.state); };
})();
