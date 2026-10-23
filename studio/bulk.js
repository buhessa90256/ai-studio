// Approve All Frames + Cancel Everything for the storyboard gallery. One file shared by the phone app (Manual Editor, v2 shell) and the PC app (Storyboard screen).
// It only adds a bar above the gallery; frames, videos, projects and character references are never touched except the `review: approved` mark of the scenes you confirm.
//
// Approve All Frames
//  - ready = has a start frame, not approved, not rejected, nothing running, no automatic flag, and the identity check PASSED (chat/connector frames) - failed or uncertain identity,
//    rejected frames and flagged frames are listed separately for a manual look and are NEVER approved here. Frames made in this app have no face check on this device: they count as ready when nothing flagged them.
//  - one confirmation with the estimated GPU cost, then every ready frame is approved and its video is started through the app's own job queue (SP.sb.video) or, for chat movies, the connector's
//    action link (approve_all: one idempotent batch, server-side checks, the connector's worker queue).
//  - idempotent: every confirm carries a key; the record is stored BEFORE anything starts, the same key never starts anything twice; a scene that is already approved, already running or already has a
//    video is skipped; a frame replaced after you looked at it is skipped; retry sends only the unsuccessful scenes under a new key.
// Cancel Everything: pauses the AI Director, cancels every RunPod job (this device, other apps, everything RunPod lists), purges the RunPod queue and, with the actions link, stops the connector's movies.
"use strict";
(() => {
  const SP = () => window.SP, APPX = () => window.APP;
  const h = (tag, attrs, ...kids) => SP().h(tag, attrs, ...kids.flat(Infinity).filter(k => k != null && k !== false));   // never print "null": the PC app's helper does not skip empty children
  const api = (...a) => SP().api(...a);
  const LSget = (k, d = null) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
  const LSset = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const money = n => "$" + Number(n || 0).toFixed(2);
  const esc = s => String(s == null ? "" : s);
  const isPhoneApp = () => !!(window.StudioJobs && typeof window.runpod === "function");   // direct-to-RunPod app (GitHub Pages); the PC app goes through its server
  const note = (m, kind) => { try { APPX() && APPX().toast ? APPX().toast(m, kind || "") : null; } catch {} };

  // ------------------------------------------------------------------ one place that decides what a scene is (same rules as APP.sceneInfo; used when the v2 shell is not loaded)
  function info(sc, project) {
    if (APPX() && APPX().sceneInfo) return APPX().sceneInfo(sc, project);
    const st = sc.settings || {}, busyFrame = sc.status === "keyframe_generating", busyVideo = ["generating", "queued"].includes(sc.status), hasFrame = !!sc.start_asset_url, hasVideo = !!sc.video_asset_url;
    const review = st.review || (st.cstate === "frame_awaiting_approval" ? "pending" : "");
    const approved = review === "approved" || hasVideo || ["frame_done", "video_waiting", "video_generating", "video_done"].includes(st.cstate);
    let key = "empty";
    if (busyFrame) key = "frame_run"; else if (busyVideo) key = "video_run"; else if (sc.status === "failed") key = "failed"; else if (hasVideo) key = "video_done";
    else if (hasFrame && review === "rejected") key = "rejected"; else if (hasFrame && !approved) key = "review"; else if (hasFrame) key = "approved"; else if (sc.action) key = "draft";
    return { key, hasFrame, hasVideo, approved, review, identity: st.cidentity || null, flags: (st.cflags || []).filter(Boolean), busy: busyFrame || busyVideo };
  }
  const clipCost = sc => (APPX() && APPX().estimate) ? APPX().estimate(sc, "clip") : 0.2 * (0.7 + 0.3 * (sc.duration || 6) / 6);
  const version = sc => `${sc.start_asset || ""}:${(sc.settings || {}).kv || ""}`;
  const isChat = sc => !!(sc.settings && sc.settings.cm);
  const actLink = () => LSget("connector_act", "");
  const viaConnector = sc => isChat(sc) && !!actLink();     // same rule as the Manual Editor's single-scene buttons

  // ------------------------------------------------------------------ classification (pure)
  function classify(sc, project, idx) {
    const i = info(sc, project), st = sc.settings || {}, row = { id: sc.id, n: idx + 1, title: esc(sc.title) || "Scene " + (idx + 1), version: version(sc), chat: viaConnector(sc), cost: clipCost(sc) };
    if (i.approved || i.hasVideo) return { ...row, bucket: "approved", code: "already_approved", needsVideo: i.approved && !i.hasVideo && !i.busy, reason: i.hasVideo ? "video already made" : "already approved" };
    if (i.busy) return { ...row, bucket: "not_ready", code: "busy", reason: i.key === "frame_run" ? "start frame is being made" : "video is being made" };
    if (!i.hasFrame) return { ...row, bucket: "not_ready", code: "no_frame", reason: "start frame not made yet" };
    if (i.key === "failed") return { ...row, bucket: "not_ready", code: "needs_fix", reason: "needs a fix first" };
    if (i.key === "rejected") return { ...row, bucket: "review", code: "rejected", reason: "you rejected this frame" };
    const idv = i.identity;
    if (isChat(sc)) {
      if (!idv) return { ...row, bucket: "review", code: "identity_unchecked", reason: "identity not checked yet" };
      const verdicts = Object.entries(idv.chars || {});
      if (idv.overall === "fail" || verdicts.some(([, v]) => ["different", "looks like someone else", "no face in picture"].includes(v.verdict))) {
        const bad = verdicts.filter(([, v]) => v.verdict && v.verdict !== "match").map(([n, v]) => `${n}: ${v.verdict}`);
        return { ...row, bucket: "review", code: "identity_failed", reason: "identity check failed" + (bad.length ? " (" + bad.join(", ") + ")" : "") };
      }
      if (idv.overall !== "pass") return { ...row, bucket: "review", code: "identity_uncertain", reason: "identity uncertain (" + esc(idv.overall) + ")" };
    }
    if (i.flags.length) return { ...row, bucket: "review", code: "flagged", reason: "flagged: " + esc(i.flags[0]).slice(0, 90) };
    if (st.cwarn) return { ...row, bucket: "review", code: "flagged", reason: esc(st.cwarn).slice(0, 90) };
    return { ...row, bucket: "ready", code: "ready", reason: isChat(sc) ? "all checks passed" : "no flags (no face check on this device)", unchecked: !isChat(sc) };
  }
  function plan(project, scenes, onlyIds) {
    const rows = scenes.map((s, i) => classify(s, project, i));
    const by = b => rows.filter(r => r.bucket === b);
    const restart = onlyIds ? rows.filter(r => onlyIds.includes(r.id) && r.needsVideo && !r.chat).map(r => ({ ...r, bucket: "ready", restart: true, reason: "approved; its video did not start" })) : [];
    return { rows, ready: by("ready").concat(restart), review: by("review"), notReady: by("not_ready"), approved: by("approved"), estimated: by("ready").concat(restart).reduce((a, r) => a + r.cost, 0) };
  }

  // ------------------------------------------------------------------ batch records (stored BEFORE anything starts; the same key never runs twice)
  const recKey = (pid, key) => `bulk:${pid}:${key}`;
  const loadRec = (pid, key) => { try { return JSON.parse(LSget(recKey(pid, key), "null")); } catch { return null; } };
  const saveRec = rec => { LSset(recKey(rec.project, rec.key), JSON.stringify(rec)); LSset("bulk_last:" + rec.project, rec.key); try { const idx = JSON.parse(LSget("bulk_index", "[]")); if (!idx.includes(recKey(rec.project, rec.key))) { idx.push(recKey(rec.project, rec.key)); while (idx.length > 20) { try { localStorage.removeItem(idx.shift()); } catch {} } LSset("bulk_index", JSON.stringify(idx)); } } catch {} };
  const lastRec = pid => { const k = LSget("bulk_last:" + pid, ""); return k ? loadRec(pid, k) : null; };
  const newKey = () => "bk-" + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
  const inflight = new Set();    // scenes this tab is working on right now

  // ------------------------------------------------------------------ connector (chat movies): one idempotent batch through the actions link
  async function actPost(op, body) {
    const act = actLink(); if (!act) throw new Error("no actions link");
    const r = await fetch(`${act}/${op}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.error || "The connector answered " + r.status);
    return j;
  }
  const movieOf = scenes => (scenes.find(s => s.settings && s.settings.cm) || { settings: {} }).settings.cm;

  // ------------------------------------------------------------------ run the confirmed batch
  async function execute(ctx, key, pl, onlyIds) {
    const pid = ctx.project.id;
    const old = loadRec(pid, key);
    if (old) return { ...old, replayed: true };                       // the same confirmation again: nothing is sent twice
    const want = pl.ready.filter(r => !onlyIds || onlyIds.includes(r.id));
    const rec = { key, project: pid, created: Date.now(), rows: {}, chat: null, state: "running" };
    pl.rows.forEach(r => { rec.rows[r.id] = { n: r.n, title: r.title, status: r.bucket === "approved" ? "already_approved" : r.bucket === "review" ? "needs_review" : r.bucket === "not_ready" ? "not_ready" : "queued", reason: r.reason, chat: r.chat }; });
    if (onlyIds) for (const id of Object.keys(rec.rows)) if (!onlyIds.includes(id) && rec.rows[id].status === "queued") delete rec.rows[id];
    saveRec(rec);                                                      // BEFORE anything starts
    const chatRows = want.filter(r => r.chat), localRows = want.filter(r => !r.chat);
    if (chatRows.length) {
      const movie = movieOf(ctx.scenes), exp = {}, byCn = {};
      for (const r of chatRows) { const sc = ctx.scenes.find(s => s.id === r.id); exp[sc.settings.cn] = sc.settings.kv; byCn[sc.settings.cn] = r.id; }
      rec.chat = { movie, key, cns: Object.keys(byCn).map(Number) };
      try {
        const res = await actPost("approve_all", { movie_id: movie, idempotency_key: key, confirm: true, scenes: rec.chat.cns, expected_versions: exp });
        for (const [cn, v] of Object.entries(res.scenes || {})) { const id = byCn[cn]; if (id) rec.rows[id] = { ...rec.rows[id], status: v.status, reason: v.reason || v.code || "", code: v.code }; }
        rec.chat.state = res.state; rec.chat.applied = !!res.applied;
      } catch (e) { chatRows.forEach(r => { rec.rows[r.id] = { ...rec.rows[r.id], status: "failed", reason: String(e.message || e).slice(0, 140) }; }); rec.chat.state = "failed"; }
      saveRec(rec);
    }
    for (const r of localRows) {
      if (inflight.has(r.id) || LSget("bulk_claim:" + r.id, 0) > Date.now() - 600000) { rec.rows[r.id] = { ...rec.rows[r.id], status: "already_approved", reason: "already being handled by another request" }; continue; }
      inflight.add(r.id); LSset("bulk_claim:" + r.id, String(Date.now()));
      try {
        const fresh = await api("scenes/" + r.id), fi = info(fresh, ctx.project);
        if (r.restart) {
          if (fi.hasVideo || fi.busy) rec.rows[r.id] = { ...rec.rows[r.id], status: "already_approved", reason: fi.hasVideo ? "video already made" : "already being made" };
          else { rec.rows[r.id] = { ...rec.rows[r.id], status: "approved", reason: "approved" }; try { startVideo(ctx, fresh, rec); rec.rows[r.id].video = "started"; } catch (e) { rec.rows[r.id] = { ...rec.rows[r.id], status: "failed", code: "video_not_started", reason: String(e.message || e).slice(0, 140) }; } }
        }
        else if (version(fresh) !== r.version) rec.rows[r.id] = { ...rec.rows[r.id], status: "skipped", code: "frame_changed", reason: "the frame was replaced after you looked at it" };
        else if (fi.approved || fi.hasVideo || fi.busy) rec.rows[r.id] = { ...rec.rows[r.id], status: "already_approved", reason: fi.hasVideo ? "video already made" : fi.busy ? "already being made" : "already approved" };
        else {
          await api("scenes", { ...fresh, settings: { ...(fresh.settings || {}), review: "approved", approved_at: Date.now() / 1000, approved_asset: fresh.start_asset } });
          rec.rows[r.id] = { ...rec.rows[r.id], status: "approved", reason: "approved" };
          try { startVideo(ctx, fresh, rec); rec.rows[r.id].video = "started"; } catch (e) { rec.rows[r.id] = { ...rec.rows[r.id], status: "failed", code: "video_not_started", reason: String(e.message || e).slice(0, 140) }; }
        }
      } catch (e) { rec.rows[r.id] = { ...rec.rows[r.id], status: "failed", reason: String(e.message || e).slice(0, 140) }; }
      finally { inflight.delete(r.id); try { localStorage.removeItem("bulk_claim:" + r.id); } catch {} }   // the claim only protects the approve+start window against a second tab
      saveRec(rec);
      await new Promise(res => setTimeout(res, 600));                  // stagger: the GPU queue is not hit by every request in the same instant
    }
    rec.state = "sent"; saveRec(rec);
    try { APPX() && APPX().changed && APPX().changed("scenes"); } catch {}
    return rec;
  }
  // the app's own job queue (browser -> RunPod, or the PC server): the same function the single "Make video" button uses; runs in the background
  function startVideo(ctx, sc, rec) {
    const run = async () => { await SP().sb.use(ctx.project.id); await SP().sb.video(sc.id); };
    const guarded = APPX() && APPX().once ? () => APPX().once("video:" + sc.id, run) : run;
    Promise.resolve().then(guarded).catch(e => { if (rec && rec.rows[sc.id]) { rec.rows[sc.id] = { ...rec.rows[sc.id], status: "failed", code: "video_not_started", reason: String(e.message || e).slice(0, 140) }; saveRec(rec); }   /* same in-memory record the run keeps saving: no lost update */ note("Video for scene: " + String(e.message || e).slice(0, 120), "bad"); }).finally(() => { try { ctx.refresh && ctx.refresh(); } catch {} });
  }
  async function pollChat(ctx, rec) {
    if (!rec.chat || rec.chat.applied || rec.chat.state === "failed") return rec;
    try {
      const res = await actPost("approve_all_status", { movie_id: rec.chat.movie, idempotency_key: rec.chat.key });
      const byCn = {}; ctx.scenes.forEach(s => { if (s.settings && s.settings.cn) byCn[s.settings.cn] = s.id; });
      for (const [cn, v] of Object.entries(res.scenes || {})) { const id = byCn[cn]; if (id && rec.rows[id]) rec.rows[id] = { ...rec.rows[id], status: v.status, reason: v.reason || rec.rows[id].reason, code: v.code }; }
      rec.chat.applied = !!res.applied; rec.chat.state = res.state; saveRec(rec);
    } catch {}
    return rec;
  }

  // ------------------------------------------------------------------ UI
  let styled = false;
  function css() {
    if (styled) return; styled = true;
    document.head.append(h("style", {}, `
.bk{border:1px solid var(--line,#3a3a48);border-radius:14px;padding:12px;margin:0 0 12px;background:var(--card,rgba(127,127,127,.08))}
.bk-row{display:flex;gap:8px;flex-wrap:wrap}.bk button{font:inherit;color:inherit;border:1px solid var(--line,#4a4a58);background:transparent;border-radius:10px;padding:10px 14px;min-height:46px;cursor:pointer}
.bk button:disabled{opacity:.5;cursor:default}.bk .bk-go{flex:1 1 220px;background:var(--acc,#7c6cf0);border-color:var(--acc,#7c6cf0);color:#fff;font-weight:600;font-size:16px}
.bk .bk-stop{color:#e5594b;border-color:#e5594b;font-weight:600}.bk-n{display:inline-block;margin-left:8px;padding:1px 10px;border-radius:99px;background:rgba(255,255,255,.22);font-size:14px}
.bk-sum{font-size:14px;margin:8px 0 2px}.bk-ok{color:#3fbf7f}.bk-warn{color:#e0a84a}.bk-bad{color:#e5594b}.bk-mut{opacity:.72}
.bk ul{list-style:none;margin:6px 0;padding:0;font-size:14px}.bk li{margin:3px 0}.bk details{margin-top:6px;font-size:14px}.bk summary{cursor:pointer}
.bk-bar{height:8px;border-radius:9px;background:rgba(127,127,127,.25);overflow:hidden;margin:8px 0}.bk-bar i{display:block;height:100%;background:#3fbf7f;transition:width .6s}
.bk-sheet{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:flex-end;justify-content:center}
.bk-box{background:var(--bg,#1b1b22);color:var(--ink,#f1f1f3);width:min(520px,100%);max-height:90vh;overflow:auto;border-radius:16px 16px 0 0;padding:18px 16px calc(18px + env(safe-area-inset-bottom));box-sizing:border-box}
@media(min-width:700px){.bk-sheet{align-items:center}.bk-box{border-radius:16px}}
.bk-box h3{margin:0 0 8px;font-size:18px}.bk-box p{margin:6px 0;line-height:1.45}.bk-pill{display:inline-block;margin:2px 6px 2px 0;padding:1px 9px;border-radius:99px;border:1px solid #3fbf7f;color:#3fbf7f;font-size:13px}
.bk-box .bk-row{margin-top:14px}.bk-box button{font:inherit;color:inherit;border:1px solid var(--line,#4a4a58);background:transparent;border-radius:10px;padding:10px 14px;min-height:46px;cursor:pointer;flex:1}
.bk-box .pri{background:var(--acc,#7c6cf0);border-color:var(--acc,#7c6cf0);color:#fff;font-weight:600;flex:2}.bk-box .dng{background:#d64a3c;border-color:#d64a3c;color:#fff;font-weight:600;flex:2}.bk-box button:disabled{opacity:.5}
@media(min-width:700px){.bk .bk-go{flex:0 0 auto;min-width:300px}}`));
  }
  function sheet(build) {
    css();
    const box = h("div", { class: "bk-box", role: "dialog", "aria-modal": "true" }), wrap = h("div", { class: "bk-sheet" }, box);
    for (const m of ["append", "replaceChildren"]) { const orig = Element.prototype[m]; box[m] = (...kids) => orig.apply(box, kids.flat(Infinity).filter(k => k != null && k !== false)); }   // optional elements may be null: never print "null" (the PC app does not patch the DOM like the phone app does)
    const close = () => { wrap.remove(); document.removeEventListener("keydown", esc); };
    const esc = e => { if (e.key === "Escape") close(); };
    wrap.onclick = e => { if (e.target === wrap) close(); }; document.addEventListener("keydown", esc); document.body.append(wrap);
    build(box, close); return { box, close };
  }
  const list = rows => h("ul", {}, rows.map(r => h("li", {}, h("b", {}, "Scene " + r.n), " ", h("span", { class: "bk-mut" }, r.reason))));
  const ICON = { approved: "✔", already_approved: "✔", queued: "⏳", failed: "✘", skipped: "⚠", needs_review: "👁", not_ready: "…" };
  const TONE = { approved: "bk-ok", already_approved: "bk-ok", queued: "bk-mut", failed: "bk-bad", skipped: "bk-warn", needs_review: "bk-warn", not_ready: "bk-mut" };

  function panel(ctx, rec) {
    const liveInfo = id => { const sc = ctx.scenes.find(s => s.id === id); return sc ? info(sc, ctx.project) : null; };
    const rows = Object.entries(rec.rows).sort((a, b) => a[1].n - b[1].n);
    const acc = rows.filter(([, r]) => ["approved", "queued"].includes(r.status) || (r.status === "already_approved" && r.video));
    const done = acc.filter(([id]) => (liveInfo(id) || {}).hasVideo).length, started = acc.filter(([id]) => { const i = liveInfo(id); return i && (i.busy || i.hasVideo); }).length;
    const retry = rows.filter(([, r]) => r.status === "failed" || (r.status === "skipped" && r.code === "frame_changed")).map(([id]) => id);
    const live = id => { const i = liveInfo(id); return i ? (i.hasVideo ? "video done" : i.busy ? "video rendering" : "") : ""; };
    const node = h("div", { class: "bk", id: "bk-prog" },
      h("div", {}, h("b", {}, "Approve all frames"), h("span", { class: "bk-mut" }, ` · videos started ${started}/${acc.length}, finished ${done}/${acc.length}`)),
      h("div", { class: "bk-bar" }, h("i", { style: `width:${acc.length ? Math.round(100 * done / acc.length) : 0}%` })),
      h("ul", {}, rows.map(([id, r]) => h("li", { class: TONE[r.status] || "" }, `${ICON[r.status] || "•"} `, h("b", {}, "Scene " + r.n), " — " + r.status.replace("_", " "), r.reason && r.status !== "approved" ? ": " + r.reason : "", live(id) && ["approved", "already_approved", "queued"].includes(r.status) ? "  [" + live(id) + "]" : ""))),
      retry.length ? h("button", { class: "bk-go", style: "width:100%", onclick: () => run(ctx, retry) }, `Retry ${retry.length} unsuccessful (scene${retry.length > 1 ? "s" : ""} ${retry.map(id => rec.rows[id].n).join(", ")})`) : null);
    return node;
  }

  async function run(ctx, onlyIds) {
    const pl = plan(ctx.project, ctx.scenes, onlyIds), chatReady = pl.ready.some(r => r.chat);
    if (!pl.ready.length || (onlyIds && !pl.ready.some(r => onlyIds.includes(r.id)))) return note(onlyIds ? "Nothing to retry: those frames are no longer ready." : "No frame is ready to approve right now.");
    const key = newKey();      // one key per confirmation; a second tap with the same dialog can never start things again
    const ids = onlyIds || null, shown = ids ? pl.ready.filter(r => ids.includes(r.id)) : pl.ready;
    const cost = shown.reduce((a, r) => a + r.cost, 0), noKey = isPhoneApp() && typeof window.API_KEY !== "undefined" && !window.API_KEY && shown.some(r => !r.chat);
    sheet((box, close) => {
      const go = h("button", { class: "pri", onclick: async () => {
        if (go.disabled) return; go.disabled = true; go.textContent = "Starting…";
        try { const rec = await execute(ctx, key, pl, ids); close(); if (rec.replayed) note("Already sent earlier: nothing was started twice."); ctx.redraw && ctx.redraw(); startWatch(ctx); }
        catch (e) { go.disabled = false; go.textContent = "Try again (safe to repeat)"; note(String(e.message || e), "bad"); }
      } }, `Approve ${shown.length} & start videos`);
      box.append(h("h3", {}, ids ? "Retry these frames?" : "Approve all valid frames?"),
        h("p", {}, h("b", {}, `${shown.length} frame${shown.length > 1 ? "s" : ""}`), " passed every automatic check. Approving starts their videos on the GPU now."),
        h("div", {}, shown.map(r => h("span", { class: "bk-pill" }, "Scene " + r.n))),
        h("p", {}, h("b", {}, "Estimated GPU cost: " + money(cost)), h("span", { class: "bk-mut" }, ` (about ${money(shown[0].cost)} per video; RunPod bills the real seconds as each renders).${APPX() && APPX().budgetNote ? APPX().budgetNote(cost) : ""}${chatReady && shown.some(r => r.chat) ? " Chat-movie frames are only approved here: nothing is spent on them. Each chat video is started on its own (Scene details > Generate video, with its price) and needs the Production Hold to be off." : ""}${APPX() && APPX().gpu && APPX().gpu.state === "asleep" ? " The GPU is asleep and needs about 5 minutes to wake." : ""}`)),
        shown.some(r => r.unchecked) ? h("p", { class: "bk-mut", style: "font-size:13px" }, "Frames made in this app have no face check on this device; look at them first if you are unsure.") : null,
        noKey ? h("p", { class: "bk-bad" }, "There is no RunPod key on this device: add it in Settings first.") : null,
        !ids && pl.review.length ? h("div", {}, h("p", { class: "bk-warn", style: "margin-bottom:0" }, h("b", {}, `Not approved, needs your review (${pl.review.length}):`)), list(pl.review)) : null,
        !ids && pl.notReady.length ? h("div", {}, h("p", { class: "bk-mut", style: "margin-bottom:0" }, h("b", {}, `Not ready (${pl.notReady.length}):`)), list(pl.notReady)) : null,
        !ids && pl.approved.length ? h("p", { class: "bk-mut" }, "Already approved: " + pl.approved.map(r => r.n).join(", ")) : null,
        h("div", { class: "bk-row" }, h("button", { onclick: close }, "Cancel"), noKey ? null : go));
    });
  }

  // keep the progress panel fresh while a batch is running (chat batches are polled; local scenes change through the app's own refresh)
  const timers = new Map();
  function startWatch(ctx) {
    const pid = ctx.project.id; if (timers.has(pid)) clearInterval(timers.get(pid));
    let n = 0;
    timers.set(pid, setInterval(async () => {
      const rec = lastRec(pid); if (!rec || ++n > 300) { clearInterval(timers.get(pid)); timers.delete(pid); return; }
      await pollChat(ctx, rec);
      try { APPX() && APPX().syncNow && rec.chat && !rec.chat.applied ? await APPX().syncNow() : null; } catch {}
      try { ctx.refresh && await ctx.refresh(); } catch {}
      const el = document.getElementById("bk-prog"); if (el) el.replaceWith(panel(ctx, lastRec(pid)));
    }, 4000));
  }

  // ------------------------------------------------------------------ the bar above the gallery
  function bar(ctx) {
    css();
    const pl = plan(ctx.project, ctx.scenes), n = pl.ready.length, rec = lastRec(ctx.project.id);
    const disabled = !n;
    const why = !ctx.scenes.length ? "No scenes yet." : n ? "" : pl.review.length || pl.notReady.length ? "No frame is ready and valid right now." : "Every frame is already approved.";
    const wrap = h("div", { class: "bk-wrap" });
    wrap.append(h("div", { class: "bk", id: "bk-bar" },
      h("div", { class: "bk-row" },
        h("button", { class: "bk-go", id: "bk-go", disabled, onclick: () => run(ctx) }, "Approve all frames", h("span", { class: "bk-n" }, `${n} ready`)),
        h("button", { class: "bk-stop", id: "bk-stop", onclick: () => cancelEverything(ctx) }, "⛔ Cancel everything")),
      h("div", { class: "bk-sum" }, h("span", { class: "bk-ok" }, `${n} ready for approval`), " · ", h("span", { class: pl.review.length ? "bk-warn" : "bk-mut" }, `${pl.review.length} need your review`), " · ", h("span", { class: "bk-mut" }, `${pl.notReady.length} not ready · ${pl.approved.length} already approved`)),
      why ? h("div", { class: "bk-mut", style: "font-size:13px" }, why) : null,
      pl.review.length ? h("details", {}, h("summary", { class: "bk-warn" }, "Review these by hand (never auto-approved)"), list(pl.review)) : null,
      pl.notReady.length ? h("details", {}, h("summary", { class: "bk-mut" }, `Not ready yet (${pl.notReady.length})`), list(pl.notReady)) : null));
    if (rec) { wrap.append(panel(ctx, rec)); if (rec.chat && !rec.chat.applied && rec.chat.state !== "failed") startWatch(ctx); }
    return wrap;
  }

  // ------------------------------------------------------------------ Cancel everything
  async function cancelPreview(ctx) {
    const out = { local: 0, queued: 0, running: 0, requests: [], details: [], chat: null, director: 0, error: "" };
    if (isPhoneApp()) {
      try { const r = await window.runpod("GET", "requests"); out.requests = (r.requests || []).filter(x => ["IN_QUEUE", "IN_PROGRESS"].includes(x.status)); out.queued = out.requests.filter(x => x.status === "IN_QUEUE").length; out.running = out.requests.length - out.queued;
        out.details = (await Promise.all(out.requests.filter(x => x.status === "IN_PROGRESS").slice(0, 6).map(async x => { try { const s = await window.runpod("GET", "status/" + x.id), p = (s.output && s.output.ai_progress) || {}; return { id: x.id, node: p.node_type || "", nodes: p.nodes_total ? p.nodes_done + "/" + p.nodes_total : "", elapsed: Math.round(p.elapsed || 0), almost: !!(p.nodes_total && p.nodes_done / p.nodes_total >= 0.7) }; } catch { return null; } }))).filter(Boolean); } catch (e) { out.error = String(e.message || e); }
      try { out.local = ((await window.StudioJobs.queue()).running || []).length; } catch {}
      try { const all = await window.SDB.all("kv"); out.director = all.filter(r => String(r.key).startsWith("director:") && r.value && !r.value.paused && !["DRAFT", "DONE", "CANCELLED"].includes(r.value.state)).length; } catch {}
      if (actLink()) { try { out.chat = await actPost("cancel_all_preview", {}); } catch (e) { out.chat = { error: String(e.message || e) }; } }
    } else {
      try { const r = await (await fetch("/api/cancel_all")).json(); if (r.error) throw new Error(r.error); out.queued = r.queued; out.running = r.running; out.requests = new Array(r.queued + r.running); } catch (e) { out.error = String(e.message || e); }
    }
    return out;
  }
  async function cancelRun(ctx, pv, keepRunning) {
    const res = { cancelled: 0, failed: 0, purged: null, director: 0, chat: null, kept: 0 };
    if (isPhoneApp()) {
      try { const all = await window.SDB.all("kv"); for (const r of all) if (String(r.key).startsWith("director:") && r.value && !r.value.paused) { r.value.paused = true; await window.SDB.put("kv", r); res.director++; } } catch {}
      for (const q of pv.requests) { if (keepRunning && q.status === "IN_PROGRESS") { res.kept++; continue; } try { await window.runpod("POST", "cancel/" + q.id); res.cancelled++; } catch (e) { if (/404/.test(String(e.message))) res.cancelled++; else res.failed++; } }
      try { res.purged = await window.runpod("POST", "purge-queue"); } catch (e) { res.purged = { error: String(e.message || e).slice(0, 120) }; }
      if (actLink() && !keepRunning) { try { res.chat = await actPost("cancel_all", { confirm: true }); } catch (e) { res.chat = { error: String(e.message || e).slice(0, 120) }; } }
    } else {
      const r = await (await fetch("/api/cancel_all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) })).json();
      if (r.error) throw new Error(r.error);
      res.cancelled = r.cancelled; res.failed = r.failed; res.purged = r.purged || null;
    }
    try { APPX() && APPX().refreshGpu && APPX().refreshGpu(true); } catch {}
    try { APPX() && APPX().changed && APPX().changed("scenes"); } catch {}
    return res;
  }
  async function cancelEverything(ctx) {
    const s = sheet(box => box.append(h("h3", {}, "Stop GPU spending?"), h("p", { class: "bk-mut" }, "Checking what is running…")));
    let pv; try { pv = await cancelPreview(ctx); } catch (e) { pv = { error: String(e.message || e), requests: [], details: [] }; }
    const mm = sec => Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
    const almost = (pv.details || []).filter(d => d.almost).length;
    const finish = async (keepRunning, btns) => {
      btns.forEach(x => { x.disabled = true; }); const label = keepRunning ? "Cancelling waiting jobs…" : "Cancelling…";
      try {
        const r = await cancelRun(ctx, pv, keepRunning), q = r.purged || {};
        s.box.replaceChildren(h("h3", { class: "bk-ok" }, "Done."), h("ul", { style: "font-size:15px" },
          h("li", {}, `${r.cancelled} RunPod job(s) cancelled` + (r.failed ? `, ${r.failed} could not be cancelled` : "")),
          r.kept ? h("li", { class: "bk-ok" }, `${r.kept} running job(s) were left running to finish`) : null,
          h("li", {}, q.error ? h("span", { class: "bk-bad" }, "Queue: " + q.error) : "RunPod waiting queue cleared"),
          r.director ? h("li", {}, `${r.director} AI Director production(s) paused`) : null,
          r.chat && !r.chat.error ? h("li", {}, `Chat connector: ${(r.chat.movies_stopped || []).length} movie(s) stopped, ${r.chat.jobs_cancelled || 0} job(s) cancelled`) : null,
          r.chat && r.chat.error ? h("li", { class: "bk-warn" }, "Chat connector: " + r.chat.error) : null),
          h("div", { class: "bk-row" }, h("button", { class: "pri", onclick: s.close }, "Close")));
        ctx.refresh && ctx.refresh();
      } catch (e) { btns.forEach(x => { x.disabled = false; }); note(String(e.message || e), "bad"); }
    };
    const keep = h("button", { id: "bk-cancel-waiting", disabled: !pv.queued, style: "flex:1.5" }, `Cancel waiting only (${pv.queued || 0})`);
    const all = h("button", { class: "dng", id: "bk-cancel-all-go", disabled: !!pv.error && !pv.requests.length && !actLink() }, "Cancel everything");
    keep.onclick = () => finish(true, [keep, all]); all.onclick = () => finish(false, [keep, all]);
    s.box.replaceChildren(h("h3", {}, "Stop GPU spending?"),
      h("ul", { style: "font-size:15px" },
        h("li", {}, pv.error ? h("span", { class: "bk-bad" }, "Could not read RunPod: " + pv.error) : [h("b", {}, `${pv.queued} waiting`), ` and `, h("b", {}, `${pv.running} running`), " RunPod job(s), whoever started them."]),
        (pv.details || []).map(d => h("li", { class: d.almost ? "bk-warn" : "bk-mut", style: "font-size:14px" }, `A running job: ${d.node || "starting"}${d.nodes ? " (" + d.nodes + " steps)" : ""}, running ${mm(d.elapsed)}` + (d.almost ? " — ALMOST DONE" : ""))),
        pv.local ? h("li", {}, `${pv.local} job(s) started on this device are among them.`) : null,
        pv.director ? h("li", {}, `${pv.director} AI Director production(s) will be paused.`) : null,
        pv.chat && !pv.chat.error ? h("li", {}, `Chat connector: ${(pv.chat.active_movies || []).length} running movie(s) and ${(pv.chat.tracked_jobs || []).length} tracked job(s) will be stopped.`) : null,
        pv.chat && pv.chat.error ? h("li", { class: "bk-warn" }, "Chat connector not reached: " + pv.chat.error) : null),
      almost ? h("p", { class: "bk-warn", style: "font-size:14px" }, `${almost} running job(s) are nearly finished. Cancelling them throws away the GPU time already paid (a cold GPU takes up to ~25 minutes to start). Consider "Cancel waiting only".`) : null,
      h("p", { class: "bk-mut", style: "font-size:13px" }, "Frames, approvals, videos already made, projects and character references are not touched. GPU time already used is not refunded."),
      h("div", { class: "bk-row" }, h("button", { onclick: s.close }, "Keep going"), keep, all));
  }


  // ------------------------------------------------------------------ Delete projects (several at once, or all): the same RECOVERABLE soft delete as the single "Delete project" (Recently deleted -> Restore)
  async function deleteProjects(opts = {}) {
    css();
    const s = sheet(box => box.append(h("h3", {}, "Delete projects"), h("p", { class: "bk-mut" }, "Loading your projects…")));
    let projects = [], busy = {};
    try {
      projects = ((await api("projects")).items || []);
      for (const p of projects) { try { busy[p.id] = ((await api("scenes?project=" + p.id)).items || []).filter(x => ["keyframe_generating", "generating", "queued"].includes(x.status)).length; } catch { busy[p.id] = 0; } }
    } catch (e) { s.box.replaceChildren(h("h3", {}, "Delete projects"), h("p", { class: "bk-bad" }, String(e.message || e)), h("div", { class: "bk-row" }, h("button", { onclick: s.close }, "Close"))); return; }
    if (!projects.length) { s.box.replaceChildren(h("h3", {}, "Delete projects"), h("p", { class: "bk-mut" }, "There are no projects to delete."), h("div", { class: "bk-row" }, h("button", { onclick: s.close }, "Close"))); return; }
    const picked = new Set(), boxes = new Map();
    const count = h("span", { class: "bk-mut", id: "bk-del-count" }), go = h("button", { class: "dng", id: "bk-del-go", disabled: true }, "Delete");
    const sync = () => { count.textContent = `${picked.size} of ${projects.length} selected`; go.disabled = !picked.size; go.textContent = picked.size ? `Delete ${picked.size} project${picked.size > 1 ? "s" : ""}…` : "Delete"; boxes.forEach((cb, id) => { cb.checked = picked.has(id); }); };
    const rows = projects.map(p => { const cb = h("input", { type: "checkbox", "aria-label": "Select " + esc(p.name), style: "width:22px;height:22px;flex:none" }); cb.onchange = () => { cb.checked ? picked.add(p.id) : picked.delete(p.id); sync(); }; boxes.set(p.id, cb);
      return h("label", { style: "display:flex;gap:12px;align-items:center;padding:10px 4px;border-bottom:1px solid rgba(127,127,127,.25);min-height:46px;cursor:pointer" }, cb, h("span", { style: "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, esc(p.name) || "Untitled"), busy[p.id] ? h("span", { class: "bk-warn", style: "font-size:12px" }, `${busy[p.id]} running`) : null); });
    const step1 = () => { s.box.replaceChildren(h("h3", {}, "Delete projects"),
      h("p", { class: "bk-mut", style: "font-size:14px" }, "Pick the projects to delete. They go to “Recently deleted” and can be restored. Pictures, videos and characters in the Library are not touched."),
      h("div", { class: "bk-row", style: "margin:8px 0;align-items:center" }, h("button", { id: "bk-del-all", style: "flex:none", onclick: () => { projects.forEach(p => picked.add(p.id)); sync(); } }, "Select all"), h("button", { style: "flex:none", onclick: () => { picked.clear(); sync(); } }, "Select none"), count),
      h("div", { style: "max-height:46vh;overflow:auto" }, rows), h("div", { class: "bk-row" }, h("button", { onclick: s.close }, "Cancel"), go)); sync(); };
    go.onclick = () => {
      const chosen = projects.filter(p => picked.has(p.id)), running = chosen.reduce((a, p) => a + (busy[p.id] || 0), 0), all = chosen.length === projects.length;
      const yes = h("button", { class: "dng", id: "bk-del-yes" }, `Yes, delete ${chosen.length}`);
      yes.onclick = async () => {
        if (yes.disabled) return; yes.disabled = true; yes.textContent = "Deleting…";
        let ok = 0; const bad = [];
        for (const p of chosen) { try { await api("projects/" + p.id + "/delete", {}); ok++; } catch (e) { bad.push(esc(p.name) + ": " + String(e.message || e).slice(0, 80)); } }
        try { APPX() && APPX().changed && APPX().changed("all"); } catch {}
        s.box.replaceChildren(h("h3", { class: bad.length ? "bk-warn" : "bk-ok" }, bad.length ? "Some projects could not be deleted" : "Done."),
          h("p", {}, `${ok} project${ok === 1 ? "" : "s"} deleted. You can restore ${ok === 1 ? "it" : "them"} from Recently deleted.`), bad.length ? h("ul", { class: "bk-bad" }, bad.map(b => h("li", {}, b))) : null,
          h("div", { class: "bk-row" }, h("button", { class: "pri", onclick: s.close }, "Close")));
        try { opts.onDone && opts.onDone(); } catch {}
      };
      s.box.replaceChildren(h("h3", {}, all ? `Delete ALL ${chosen.length} projects?` : `Delete ${chosen.length} project${chosen.length > 1 ? "s" : ""}?`),
        h("ul", { style: "font-size:14px" }, chosen.slice(0, 12).map(p => h("li", {}, esc(p.name) || "Untitled")), chosen.length > 12 ? h("li", { class: "bk-mut" }, `…and ${chosen.length - 12} more`) : null),
        h("p", {}, "They move to Recently deleted, where you can restore them. Pictures, videos and characters stay in the Library."),
        running ? h("p", { class: "bk-warn" }, `${running} scene${running > 1 ? "s are" : " is"} still being made on the GPU. Deleting a project does NOT stop the GPU (and its cost). Use Cancel everything first if you want that.`) : null,
        h("div", { class: "bk-row" }, h("button", { onclick: step1 }, "Back"), yes));
    };
    step1();
  }

  window.BULK = { bar, plan, classify, execute, cancelEverything, cancelPreview, cancelRun, deleteProjects, lastRec, loadRec, version };
})();
