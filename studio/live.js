// Live progress for movies made through the chat connector (ChatGPT / Claude): the app shows what the backend is doing WITHOUT asking the chat for an update.
//
// Why it used to go stale: the app only re-downloaded the movie while a project was open (the whole 120 KB record every 4 s, which overlapped itself), the background sync was gated on an element
// the v2 interface hides, responses could be cached, and nothing showed whether the data was fresh.
//
// How it works now (one singleton, nothing else polls):
//  - every 5 s while something is generating (30 s when idle, paused while the page is hidden, immediate refresh when it becomes visible / back online),
//  - each poll is ONE small READ-ONLY GET of /ro/<token>/dashboard (a few KB) with cache:"no-store" + a cache-busting parameter; the server also answers Cache-Control: no-store,
//  - the heavy sync (download new frames / clips into the project) only runs when the dashboard says a frame version / clip / state changed, so thumbnails appear within one poll,
//  - failures back off exponentially (5, 10, 20, 40, 60 s + jitter) and the header shows Live / Reconnecting / Offline with the time of the last successful update,
//  - it NEVER calls an action route: polling cannot approve, regenerate, submit or restart anything.
"use strict";
(() => {
  if (window.__liveLoaded) return;
  window.__liveLoaded = true;
  const wait = setInterval(() => { if (window.APP && APP.LS && APP.go && APP.h) { clearInterval(wait); init(); } }, 100);

  function init() {
    const { LS, h } = APP;
    const FAST = 5000, SLOW = 30000, MAXB = 60000, TIMEOUT = 12000, ACTIVE_STAGES = new Set(["accepted", "queued", "worker_assigned", "generating", "validating", "waiting_to_retry"]);
    const S = { status: "idle", fails: 0, last: 0, error: "", movies: {}, assets: {}, watched: new Set(), found: new Set(), timer: null, busy: false, ctrl: null, ticks: 0, nextAt: 0, requests: 0 };
    const base = () => LS.get("connector_url", "");
    const visible = () => document.visibilityState === "visible";
    const online = () => navigator.onLine !== false;

    // ------------------------------------------------------------------ pure helpers (also used by the tests)
    const isActive = d => !!d && (["running", "queued"].includes(d.status) || (d.scenes || []).some(s => s.lifecycle && ACTIVE_STAGES.has(s.lifecycle.stage)) || ((d.gpu && d.gpu.workers && d.gpu.workers.running) ? (d.scenes || []).some(s => s.gpu) : false));
    const assetKey = d => (d.scenes || []).map(s => [s.scene, s.frame_version, s.frame_done ? 1 : 0, s.clip_done ? 1 : 0, s.state].join(":")).join("|") + "|" + d.status + "|" + (d.phase || "");
    const delay = (fails, active) => fails ? Math.min(MAXB, FAST * 2 ** (fails - 1)) : active ? FAST : SLOW;
    const jitter = ms => ms + Math.floor(Math.random() * 800);

    // ------------------------------------------------------------------ network: read-only, never cached
    async function getJ(path) {
      S.ctrl = new AbortController();
      const t = setTimeout(() => S.ctrl && S.ctrl.abort(), TIMEOUT);
      try {
        S.requests++;
        const r = await fetch(base() + path + (path.includes("?") ? "&" : "?") + "_=" + Date.now(), { method: "GET", cache: "no-store", credentials: "omit", signal: S.ctrl.signal });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "the connector answered " + r.status);
        return j;
      } finally { clearTimeout(t); S.ctrl = null; }
    }

    // ------------------------------------------------------------------ state + header indicator
    function setStatus(st, err) { const was = S.status; S.status = st; S.error = err ? String(err.message || err).slice(0, 120) : ""; if (was !== st) APP.emit("live-status", { status: st }); paint(); }
    const ago = () => { if (!S.last) return ""; const s = Math.max(0, Math.round((Date.now() - S.last) / 1000)); return s < 60 ? s + " s ago" : s < 3600 ? Math.round(s / 60) + " min ago" : Math.round(s / 3600) + " h ago"; };
    const clock = t => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    let pill, styled = false;
    function css() {
      if (styled) return; styled = true;
      document.head.append(h("style", {}, `
#live.live-ok .dot{background:#3fbf7f}#live.live-warn .dot{background:#e0a84a}#live.live-bad .dot{background:#e5594b}#live.live-idle .dot{background:#8a8a96}
#live{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;flex:none}@media (max-width:420px){#live.has-d .lv-l,#live.has-d .lv-s{display:none}}#live .dot{width:9px;height:9px;border-radius:50%;flex:none}
.lv{border:1px solid var(--line,#3a3a48);border-radius:14px;padding:12px;margin:0 0 12px;background:var(--card,rgba(127,127,127,.08));font-size:14px}
.lv-h{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:space-between}.lv-h b{font-size:15px}.lv-mut{opacity:.72}.lv-ok{color:#3fbf7f}.lv-warn{color:#e0a84a}.lv-bad{color:#e5594b}
.lv-bar{height:8px;border-radius:9px;background:rgba(127,127,127,.25);overflow:hidden;margin:8px 0}.lv-bar i{display:block;height:100%;background:var(--acc,#7c6cf0);transition:width .6s}
.lv-sc{padding:8px 0;border-top:1px solid rgba(127,127,127,.2)}.lv-steps{display:flex;gap:4px;margin:6px 0 2px}.lv-steps i{flex:1;height:5px;border-radius:3px;background:rgba(127,127,127,.3)}.lv-steps i.on{background:var(--acc,#7c6cf0)}.lv-steps i.now{background:#3fbf7f}
.lv button{font:inherit;color:inherit;border:1px solid var(--line,#4a4a58);background:transparent;border-radius:10px;padding:8px 12px;min-height:44px;cursor:pointer}`));
    }
    function mount() {
      if (pill || !document.getElementById("gpu")) return;
      css();
      pill = h("button", { class: "gpu live-idle", id: "live", type: "button", hidden: true, "aria-live": "polite", onclick: () => { APP.toast && APP.toast("Refreshing…"); tick(true); } }, h("span", { class: "dot" }), h("span", { id: "live-txt" }, "Live"));
      document.getElementById("gpu").before(pill);
    }
    function paint() {
      mount(); if (!pill) return;
      const on = !!base();
      pill.hidden = !on; if (!on) return;
      const txt = pill.querySelector("#live-txt"), wait = S.nextAt ? Math.max(0, Math.round((S.nextAt - Date.now()) / 1000)) : 0;
      const m = { connected: ["live-ok", "Live", S.last ? ago() : ""], reconnecting: ["live-warn", "Reconnecting", S.fails ? "retry " + wait + " s" : ""], offline: ["live-bad", "Offline", ""], idle: ["live-idle", "Live", ""] }[S.status] || ["live-idle", "Live", ""];
      pill.className = "gpu " + m[0] + (m[2] ? " has-d" : ""); txt.replaceChildren(h("span", { class: "lv-l" }, m[1]), m[2] ? h("span", { class: "lv-s" }, " · ") : "", m[2] ? h("span", { class: "lv-d" }, m[2]) : ""); pill.setAttribute("aria-label", m[1] + (m[2] ? ", " + m[2] : ""));   // narrow phones show only the detail ("2 s ago"): the coloured dot already says connected / reconnecting
      pill.title = S.status === "connected" ? "Connected to your connector. Last updated " + clock(S.last) + "." + (visible() ? "" : "") : S.status === "offline" ? "No internet connection. It reconnects by itself." : S.status === "reconnecting" ? "Could not reach the connector (" + S.error + "). Trying again with a growing pause." : "Not polling yet.";
    }
    let paintTimer = null;
    const startPaint = () => { if (!paintTimer) paintTimer = setInterval(paint, 1000); };
    const stopPaint = () => { if (paintTimer) { clearInterval(paintTimer); paintTimer = null; } };

    // ------------------------------------------------------------------ the poller
    function targets() {
      const t = new Set([...S.watched]);
      for (const id of S.found) t.add(id);
      return [...t].slice(0, 3);
    }
    async function discover() {      // a tiny list: which recent movies are active? (new movies started in the chat show up here)
      const { movies } = await getJ("/movies?limit=4");
      S.found = new Set((movies || []).filter(m => ["running", "queued"].includes(m.status)).map(m => m.id));
    }
    async function tick(manual) {
      if (!base()) { setStatus("idle"); return schedule(SLOW); }
      if (S.busy) return;
      if (!online()) { setStatus("offline"); return schedule(delay(Math.max(1, S.fails), false)); }
      S.busy = true; S.ticks++;
      try {
        if (!S.watched.size || S.ticks % 6 === 1 || manual) await discover();
        let active = false;
        for (const id of targets()) {
          const d = await getJ("/dashboard?id=" + encodeURIComponent(id));
          if (d.error || !d.scenes) { S.movies[id] && delete S.movies[id]; continue; }
          handle(id, d); active = active || isActive(d);
        }
        S.last = Date.now(); S.fails = 0; setStatus("connected");
        S.active = active;
      } catch (e) {
        if (e && e.name === "AbortError" && !visible()) { S.busy = false; return; }     // we aborted it because the page was hidden: not an error
        S.fails++; setStatus(online() ? "reconnecting" : "offline", e);
      } finally { S.busy = false; }
      schedule(delay(S.fails, S.active));
    }
    function handle(id, d) {
      const key = assetKey(d), prev = S.assets[id];
      S.movies[id] = d; S.assets[id] = key;
      if (prev !== key && window.__connectorSyncMovie) Promise.resolve(window.__connectorSyncMovie(id)).then(ok => { if (ok === false) S.assets[id] = "retry"; });   // new frame / clip / state: copy it into the project now (thumbnails appear within one poll); a skipped sync is retried on the next poll
      APP.emit("live", { id, d });
    }
    function schedule(ms) {
      clearTimeout(S.timer); S.timer = null;
      if (!visible()) { S.nextAt = 0; return; }                // hidden / locked: no timer at all; the visibility handler restarts it
      const wait = jitter(ms); S.nextAt = Date.now() + wait;
      S.timer = setTimeout(() => tick(false), wait);
    }
    function resume(why) {
      if (!visible()) return;
      startPaint(); paint();
      if (S.busy) return;
      tick(true);                                              // immediately, not at the next 5 s boundary
    }
    document.addEventListener("visibilitychange", () => {
      if (visible()) resume("visible");
      else { clearTimeout(S.timer); S.timer = null; S.nextAt = 0; stopPaint(); if (S.ctrl) try { S.ctrl.abort(); } catch {} }
    });
    window.addEventListener("online", () => { S.fails = 0; resume("online"); });
    window.addEventListener("offline", () => { setStatus("offline"); clearTimeout(S.timer); S.timer = null; });
    window.addEventListener("pageshow", e => { if (e.persisted) resume("pageshow"); });
    document.addEventListener("resume", () => resume("resume"));      // Page Lifecycle (Android Chrome after a freeze)

    // ------------------------------------------------------------------ the live card (shown above the storyboard of a chat movie)
    const mm = s => s == null ? "" : Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
    const STEPS = ["Request accepted", "Queued", "Worker assigned", "Generating", "Validating", "Ready for review"];
    function card(project) {
      const cid = project && project.data && project.data.connector_id;
      if (!cid) return null;
      S.watched.add(cid);
      const node = h("div", { class: "lv", id: "lv-" + cid });
      let was = false;
      const draw = () => {
        const d = S.movies[cid];
        const top = h("div", { class: "lv-h" }, h("b", {}, "Live progress"), h("span", { class: "lv-mut" }, S.last ? `Updated ${clock(S.last)} (${ago()})` : "Waiting for the first update…"),
          h("button", { type: "button", id: "lv-refresh", onclick: () => tick(true) }, "Refresh"));
        if (!d) { node.replaceChildren(top, h("div", { class: "lv-mut" }, S.status === "reconnecting" ? "Reconnecting: " + S.error : "Loading…")); return; }
        const sc = d.scenes || [], frames = sc.filter(s => s.frame_done).length, vids = sc.filter(s => s.clip_done).length, gp = d.gpu && d.gpu.workers, c = d.cost || {}, pr = d.protection || {};
        const live = sc.filter(s => s.gpu || (s.lifecycle && ACTIVE_STAGES.has(s.lifecycle.stage)));
        const errs = sc.filter(s => s.lifecycle && s.lifecycle.stage === "failed" || s.needs_fix);
        node.replaceChildren(top,
          h("div", { class: "lv-bar" }, h("i", { style: `width:${Math.round((d.progress || 0) * 100)}%` })),
          h("div", {}, `${Math.round((d.progress || 0) * 100)}% · ${frames}/${sc.length} start frames · ${vids}/${sc.length} videos · `, h("span", { class: "lv-mut" }, String(d.phase || d.status).replace(/_/g, " "))),
          h("div", { class: "lv-mut", style: "font-size:13px;margin-top:4px" }, gp ? `GPU: ${gp.running || 0} working · ${gp.idle || 0} idle · ${gp.initializing || 0} starting${d.gpu.jobs ? " · " + (d.gpu.jobs.inQueue || 0) + " in queue" : ""}` : "GPU: status unavailable",
            pr.gpu_cold ? " · cold GPU: models load first (can take ~20 min)" : ""),
          pr.paused ? h("div", { class: "lv-warn" }, "Paused: " + (pr.reason || "paused")) : null,
          live.map(s => h("div", { class: "lv-sc" }, h("b", {}, "Scene " + s.scene), " ", h("span", {}, s.lifecycle ? s.lifecycle.label : ""),
            s.gpu ? h("div", { class: "lv-mut", style: "font-size:13px" }, [s.gpu.node ? `${s.gpu.node} ${s.gpu.nodes || ""}${s.gpu.node_seconds ? " (" + mm(s.gpu.node_seconds) + ")" : ""}` : "", s.gpu.elapsed_seconds != null ? "running " + mm(s.gpu.elapsed_seconds) : "", s.gpu.queued_seconds ? "waited " + mm(s.gpu.queued_seconds) + " in queue" : "", s.gpu.worker_id ? "worker " + String(s.gpu.worker_id).slice(0, 5) : ""].filter(Boolean).join(" · ")) : null,
            s.lifecycle && s.lifecycle.step > 0 ? h("div", { class: "lv-steps", title: STEPS.join(" → ") }, STEPS.map((_, k) => h("i", { class: k + 1 < s.lifecycle.step ? "on" : k + 1 === s.lifecycle.step ? "now" : "" }))) : null,
            s.task_retries ? h("div", { class: "lv-mut", style: "font-size:13px" }, `tries ${s.task_retries}/3${s.next_action ? " · " + s.next_action : ""}`) : (s.next_action ? h("div", { class: "lv-mut", style: "font-size:13px" }, s.next_action) : null))),
          !live.length ? h("div", { class: "lv-mut" }, "No GPU job is running for this movie right now.") : null,
          errs.length ? h("div", { class: "lv-bad", style: "margin-top:6px" }, h("b", {}, "Latest problem: "), `Scene ${errs[0].scene}: ${String((errs[0].needs_fix && errs[0].needs_fix.reason) || errs[0].error || (errs[0].lifecycle && errs[0].lifecycle.label) || "needs a fix").slice(0, 160)}`) : null,
          d.production && d.production.hold && d.production.hold.on ? h("div", { class: "lv-warn", style: "margin-top:6px" }, "Production Hold is ON: no new GPU job can start. " + (d.production.hold.reason || "")) : null,
          h("div", { class: "lv-mut", style: "font-size:13px;margin-top:6px" }, `Recorded GPU time: $${Number(c.actual_usd_so_far || 0).toFixed(2)}${c.actual_aed_so_far != null ? " (" + Number(c.actual_aed_so_far).toFixed(2) + " AED)" : ""} (finished work $${Number(c.productive_usd || 0).toFixed(2)} + failed or cancelled $${Number(c.wasted_usd || 0).toFixed(2)}), calculated by AI Studio from RunPod's job run times${c.rate_usd_per_hour ? " at $" + Number(c.rate_usd_per_hour).toFixed(2) + "/hour" : ""}, not RunPod's invoice (worker start-up and idle time come on top). Plan estimate $${Number(c.estimated_usd || 0).toFixed(2)}${c.estimated_aed != null ? " (" + Number(c.estimated_aed).toFixed(2) + " AED)" : ""}.${c.recalculated ? " Recalculated at the real hourly rate; the old figure is kept." : ""}`));
      };
      draw();
      const off = APP.on("live", e => { if (!node.isConnected) { if (was) off(); return; } was = true; if (e.id === cid) draw(); });
      APP.on("live-status", () => { if (node.isConnected) draw(); });
      const t = setInterval(() => { if (!node.isConnected) { if (was) clearInterval(t); return; } was = true; if (visible()) draw(); }, 1000);   // the "updated 5 s ago" text
      return node;
    }

    APP.live = {
      watch: id => { if (id && !S.watched.has(id)) { S.watched.add(id); if (S.last && !S.busy) schedule(0); } }, unwatch: id => S.watched.delete(id), get: id => S.movies[id] || null, status: () => ({ status: S.status, last: S.last, fails: S.fails, error: S.error, requests: S.requests }),
      refresh: () => tick(true), card, _t: { isActive, assetKey, delay, state: S, tick },
    };
    mount(); startPaint();
    if (visible()) setTimeout(() => tick(true), 800);
  }
})();
