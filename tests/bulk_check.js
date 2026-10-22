// Approve All Frames + Cancel Everything regression test. Runs INSIDE the page. Nothing is generated and RunPod is never contacted:
// the app's video starter (SP.sb.video), runpod() and the connector's fetch are replaced by recorders for the duration of the test, and a throw-away project is removed again.
//   1. serve the folder:   python -m http.server 8800 --bind 127.0.0.1        (in ai-studio-mobile/)
//   2. open http://localhost:8800/index.html?ui=v2 (set localStorage.apikey = JSON.stringify("x") first so the setup screen does not show), resize to the width to test
//   3. in the console:     eval(await (await fetch('/tests/bulk_check.js')).text()); await __bulkCheck({ width: 390 })
// Result: { width, failures: [...], passed: n }. Empty failures = pass.
"use strict";
window.__bulkCheck = async function (opts = {}) {
  const fails = [], wait = ms => new Promise(r => setTimeout(r, ms)); let passed = 0;
  const ok = (c, msg) => { if (c) passed++; else fails.push(msg); return !!c; };
  const W = innerWidth;
  if (opts.width && Math.abs(W - opts.width) > 1) return { width: W, failures: [`viewport is ${W}px, expected ${opts.width}px`], passed: false };
  const SP = window.SP, B = window.BULK, APPX = window.APP, SDB = window.SDB;
  if (!B) return { width: W, failures: ["window.BULK missing (bulk.js not loaded)"], passed: false };
  // ---- recorders (restored in finally)
  const calls = { video: [], use: [], runpod: [], act: [] };
  const orig = { video: SP.sb.video, use: SP.sb.use, runpod: window.runpod, fetch: window.fetch, jobsQueue: window.StudioJobs && StudioJobs.queue, act: localStorage.getItem("connector_act") };
  let failVideoFor = null, requests = [];
  SP.sb.video = async id => { calls.video.push(id); if (failVideoFor === id) throw new Error("no RunPod key"); };
  SP.sb.use = async pid => { calls.use.push(pid); };
  window.runpod = async (method, path) => { calls.runpod.push(method + " " + path); if (path === "requests") return { requests }; if (String(path).startsWith("status/")) return { id: String(path).slice(7), status: "IN_QUEUE", output: { ai_progress: { tool: "minimax_h3" } } }; if (path === "health") return { jobs: {}, workers: {} }; return {}; };
  if (window.StudioJobs) StudioJobs.queue = async () => ({ running: [{ id: "local-job-1" }], recent: [] });
  const ACT = "https://connector.test/act/AAAAAAAAAAAAAAAAAAAAAAAA";
  const actState = { applied: false };
  window.fetch = async (url, o) => {
    if (String(url).startsWith(ACT)) {
      const op = String(url).slice(ACT.length + 1), body = JSON.parse(o.body); calls.act.push({ op, body });
      const mk = r => ({ ok: true, status: 200, json: async () => r });
      if (op === "approve_all") return mk({ ok: true, state: "sent", applied: false, scenes: Object.fromEntries(body.scenes.map(n => [n, { status: "queued", reason: "approval sent" }])) });
      if (op === "approve_all_status") return mk({ ok: true, applied: true, state: "sent", scenes: Object.fromEntries((body.scenesWanted || calls.act.find(c => c.op === "approve_all").body.scenes).map(n => [n, { status: "approved", reason: "approved" }])) });
      if (op === "cancel_all_preview") return mk({ ok: true, active_movies: [{ id: "m1" }], tracked_jobs: [{ movie: "m1", task: "clip0" }] });
      if (op === "cancel_all") return mk({ ok: true, movies_stopped: ["m1"], jobs_cancelled: 1 });
    }
    return orig.fetch.call(window, url, o);
  };
  const png = (() => { const c = document.createElement("canvas"); c.width = 9; c.height = 16; const x = c.getContext("2d"); x.fillStyle = "#c33"; x.fillRect(0, 0, 9, 16); return c.toDataURL("image/png"); })();
  const pids = [], scrub = () => { for (const k of Object.keys(localStorage)) if (/^bulk:(pc|p):|^bulk_last:(pc|p)$|^bulk_claim:(c|l)/.test(k)) localStorage.removeItem(k); }; scrub();
  try {
    // ============ 1. classification (pure) ============
    const mkScene = (id, o = {}) => ({ id, title: "T" + id, status: "keyframe_ready", start_asset: "a" + id, start_asset_url: "u" + id, duration: 6, settings: {}, ...o });
    const chatSet = (n, idv, extra = {}) => mkScene("c" + n, { settings: { cm: "mv1", cn: n, kv: 1, cstate: "frame_awaiting_approval", review: "pending", cidentity: idv, ...extra } });
    const PASS = { overall: "pass", chars: { Hessa: { score: .9, verdict: "match" } } }, WARN = { overall: "warn", chars: { Hessa: { score: .36, verdict: "uncertain" } } }, FAIL = { overall: "fail", chars: { Zoey: { score: .1, verdict: "different" } } };
    localStorage.setItem("connector_act", ACT);
    const cs = [chatSet(1, PASS), chatSet(2, WARN), chatSet(3, FAIL), chatSet(4, null), chatSet(5, PASS, { cflags: ["collage: 2 panels"] }), chatSet(6, PASS, { review: "rejected", cstate: "frame_rejected" }),
      mkScene("l1"), mkScene("l2", { settings: { review: "approved" } }), mkScene("l3", { status: "keyframe_generating" }), mkScene("l4", { start_asset_url: "", start_asset: "" }), mkScene("l5", { settings: { cflags: ["wrong shape"] } }), mkScene("l6", { video_asset_url: "v" })];
    const pl = B.plan({ id: "p", aspect: "9:16" }, cs), by = c => pl.rows.filter(r => r.code === c).map(r => r.id);
    ok(pl.ready.map(r => r.id).join() === "c1,l1", "ready must be exactly the passing chat frame and the unflagged local frame, got " + pl.ready.map(r => r.id));
    ok(by("identity_uncertain").join() === "c2", "warn identity must need review"); ok(by("identity_failed").join() === "c3", "failed identity must need review"); ok(by("identity_unchecked").join() === "c4", "missing identity must need review");
    ok(by("flagged").join() === "c5,l5", "flagged frames must need review"); ok(by("rejected").join() === "c6", "rejected frames must need review");
    ok(by("busy").join() === "l3" && by("no_frame").join() === "l4", "busy / no-frame scenes are not ready"); ok(by("already_approved").join() === "l2,l6", "approved / with video are already approved");
    ok(Math.abs(pl.estimated - 0.4) < 1e-9, "estimate must be 2 x $0.20, got " + pl.estimated);
    localStorage.removeItem("connector_act");

    // ============ 2. real project in the real app (local scenes, real start frames) ============
    const asset = await APPX.api("assets", { filename: "bulkcheck.png", data: png, type: "image", tags: ["bulk-check"] });
    const mkProject = async name => { const p = await APPX.saveProject({}, { name, aspect: "9:16", resolution: "768x1344", duration: 60, characters: [], story: "", description: "", data: {} }); pids.push(p.id); return p; };
    const mkScenes = async (p, spec) => { for (let i = 0; i < spec.length; i++) { const s = spec[i], st = {}; if (s === "approved") st.review = "approved"; if (s === "rejected") st.review = "rejected"; if (s === "flagged") st.cflags = ["collage: 2 panels"];
      await APPX.api("scenes", { project_id: p.id, title: "Scene " + (i + 1), action: "Hessa waves " + (i + 1), characters: [], start_asset: s === "none" ? undefined : asset.id, settings: st }); } APPX.changed("scenes"); };
    const P = await mkProject("Bulk check " + Date.now());
    await mkScenes(P, ["approved", "approved", "approved", "rejected", "none", "flagged", "ready", "ready", "ready", "ready", "ready", "ready"]);
    location.hash = "#/projects/" + P.id + "/storyboard"; await wait(2200);
    const bar = document.getElementById("bk-bar"), go = document.getElementById("bk-go"), gl = document.querySelector(".gl-bar");
    if (ok(bar && go, "the Approve-all bar must exist in the Manual Editor")) {
      ok(bar.compareDocumentPosition(gl) & Node.DOCUMENT_POSITION_FOLLOWING, "the bar must sit ABOVE the gallery filter / grid");
      ok(/6 ready/.test(go.textContent) && !go.disabled, "the button must show the number of frames ready (6): " + go.textContent);
      ok(/6 ready for approval · 2 need your review · 1 not ready · 3 already approved/.test(bar.textContent), "summary text wrong: " + bar.textContent.slice(0, 160));
      ok(document.documentElement.scrollWidth <= innerWidth + 1, "page scrolls sideways with the bar");
      ok(go.getBoundingClientRect().height >= 44 && document.getElementById("bk-stop").getBoundingClientRect().height >= 44, "buttons must be at least 44px tall");
      ok(bar.getBoundingClientRect().right <= innerWidth + 1, "the bar is wider than the screen");
      go.click(); await wait(500);
      const sh = document.querySelector(".bk-sheet");
      if (ok(sh, "tapping the button must open the confirmation")) {
        const tx = sh.innerText;
        ok(/Estimated GPU cost: \$1\.20/.test(tx), "dialog must show the estimated cost $1.20: " + tx.slice(0, 220)); ok(/Scene 4/.test(tx) && /Scene 6/.test(tx) && /rejected/.test(tx) && /flagged/.test(tx), "review scenes must be listed with reasons");
        ok(/Scene 5/.test(tx) && /not made yet/.test(tx), "not-ready scene 5 must be listed"); ok(/Already approved: 1, 2, 3/.test(tx), "already approved scenes must be listed");
        const okb = [...sh.querySelectorAll("button")].find(b => /Approve 6/.test(b.textContent));
        if (ok(okb, "confirm button 'Approve 6 & start videos' missing")) { ok(okb.getBoundingClientRect().height >= 44, "confirm button under 44px"); ok(sh.querySelector(".bk-box").getBoundingClientRect().right <= innerWidth + 1, "dialog wider than the screen");
          okb.click(); okb.click(); await wait(6500); }
      }
      ok(calls.video.length === 6 && new Set(calls.video).size === 6, "every approved scene must start exactly ONE video (got " + calls.video.length + ")");
      const scs = (await APPX.api("scenes?project=" + P.id)).items;
      ok(scs.filter(s => (s.settings || {}).review === "approved").length === 9, "approved scenes must be 3 + 6 = 9");
      ok(scs[3].settings.review === "rejected" && !(scs[5].settings || {}).review, "rejected / flagged scenes must stay untouched");
      ok(scs.every(s => s.start_asset === (s.title === "Scene 5" ? undefined : asset.id) || s.title === "Scene 5"), "start frames must be unchanged");
      const prog = document.getElementById("bk-prog");
      ok(prog && /Scene 7/.test(prog.innerText), "the progress panel must show per-scene results"); ok(/0 ready/.test(document.getElementById("bk-go").textContent) && document.getElementById("bk-go").disabled, "after approving, the button shows 0 ready and is disabled");
      // replay with the SAME key: nothing starts again
      const rec = B.lastRec(P.id), before = calls.video.length, again = await B.execute({ project: P, scenes: scs, refresh() {} }, rec.key, B.plan(P, scs), null);
      ok(again.replayed && calls.video.length === before, "the same key must replay without starting anything");
      // a different key: nothing is ready any more, nothing starts
      const none = await B.execute({ project: P, scenes: scs, refresh() {} }, "bk-other-key-0001", B.plan(P, scs), null);
      ok(calls.video.length === before && !Object.values(none.rows).some(r => r.status === "queued"), "a new key must not start anything for already-approved scenes");
    }

    // ============ 3. partial failure + retry only the unsuccessful scene; stale frame; concurrency ============
    const P2 = await mkProject("Bulk check 2 " + Date.now()); await mkScenes(P2, ["ready", "ready", "ready"]);
    let sc2 = (await APPX.api("scenes?project=" + P2.id)).items; calls.video.length = 0; failVideoFor = sc2[1].id;
    const ctx2 = () => ({ project: P2, scenes: sc2, refresh() {} });
    const r1 = await B.execute(ctx2(), "bk-fail-test-0001", B.plan(P2, sc2), null); await wait(500);
    const rec1 = B.lastRec(P2.id), st1 = Object.values(rec1.rows).map(r => r.status).join();
    ok(Object.values(rec1.rows).filter(r => r.status === "failed").length === 1, "exactly one scene must be marked failed: " + st1);
    sc2 = (await APPX.api("scenes?project=" + P2.id)).items; failVideoFor = null; calls.video.length = 0;
    const pl2 = B.plan(P2, sc2); ok(pl2.ready.length === 0, "approved scenes are not ready again (retry must not re-approve them)");
    const failedId = Object.entries(rec1.rows).find(([, r]) => r.status === "failed")[0];
    // retry path: the failed scene is already approved but its video never started -> only its video is (re)started, under a new key
    const retryPlan = B.plan(P2, sc2, [failedId]); ok(retryPlan.ready.length === 1 && retryPlan.ready[0].restart && retryPlan.ready[0].id === failedId, "a retry must offer exactly the approved scene whose video did not start");
    const rr = await B.execute(ctx2(), "bk-retry-test-0001", retryPlan, [failedId]); await wait(900);
    ok(calls.video.length === 1 && calls.video[0] === failedId, "retry must start only the unsuccessful scene: " + JSON.stringify(calls.video));
    // stale frame: the frame is replaced after the plan was made
    const P3 = await mkProject("Bulk check 3 " + Date.now()); await mkScenes(P3, ["ready", "ready"]); let sc3 = (await APPX.api("scenes?project=" + P3.id)).items; const plan3 = B.plan(P3, sc3);
    const asset2 = await APPX.api("assets", { filename: "bulkcheck2.png", data: png.replace("AAAA", "AAAB"), type: "image", tags: ["bulk-check"] });
    await APPX.api("scenes", { ...sc3[0], start_asset: asset2.id }); calls.video.length = 0;
    const r3 = await B.execute({ project: P3, scenes: sc3, refresh() {} }, "bk-stale-test-0001", plan3, null); await wait(1500);
    const rows3 = Object.values(r3.rows);
    ok(rows3.some(r => r.code === "frame_changed") && calls.video.length === 1, "a frame replaced after the plan must be skipped (frame_changed) and only the other scene starts: " + JSON.stringify(rows3.map(r => r.status)) + " calls " + calls.video.length);
    // concurrency: two different keys at the same time on fresh scenes
    const P4 = await mkProject("Bulk check 4 " + Date.now()); await mkScenes(P4, ["ready", "ready", "ready"]); const sc4 = (await APPX.api("scenes?project=" + P4.id)).items; calls.video.length = 0;
    const c4 = () => ({ project: P4, scenes: sc4, refresh() {} });
    await Promise.all([B.execute(c4(), "bk-race-aaaa-0001", B.plan(P4, sc4), null), B.execute(c4(), "bk-race-bbbb-0002", B.plan(P4, sc4), null)]); await wait(2500);
    ok(calls.video.length === 3 && new Set(calls.video).size === 3, "two simultaneous confirmations must start each video once, got " + calls.video.length);

    // ============ 4. chat movie: one idempotent batch through the connector's action link ============
    localStorage.setItem("connector_act", ACT); calls.act.length = 0;
    const chatScenes = [chatSet(1, PASS), chatSet(2, PASS), chatSet(3, FAIL)];
    const cp = B.plan({ id: "pc", aspect: "9:16" }, chatScenes);
    const cr = await B.execute({ project: { id: "pc", aspect: "9:16" }, scenes: chatScenes, refresh() {} }, "bk-chat-test-0001", cp, null);
    const ab = calls.act.filter(c => c.op === "approve_all");
    ok(ab.length === 1 && ab[0].body.scenes.join() === "1,2" && ab[0].body.idempotency_key === "bk-chat-test-0001" && ab[0].body.confirm === true && ab[0].body.movie_id === "mv1" && ab[0].body.expected_versions["1"] === 1, "chat scenes must go in ONE batch with key, confirm and versions: " + JSON.stringify(ab));
    ok(cr.rows.c3.status === "needs_review", "the failed-identity chat scene must stay for manual review");
    const cr2 = await B.execute({ project: { id: "pc", aspect: "9:16" }, scenes: chatScenes, refresh() {} }, "bk-chat-test-0001", cp, null);
    ok(cr2.replayed && calls.act.filter(c => c.op === "approve_all").length === 1, "the same key must not call the connector again");
    localStorage.removeItem("connector_act");

    // ============ 6. delete projects: multi-select, two-step confirmation, recoverable (never selects anything but its own throw-away projects) ============
    const stamp = Date.now(), DA = await mkProject("Delete test A " + stamp), DB = await mkProject("Delete test B " + stamp), DC = await mkProject("Delete test C " + stamp);
    await APPX.api("scenes", { project_id: DC.id, title: "Busy scene", action: "x", characters: [], status: "generating" }); APPX.changed("all");
    location.hash = "#/projects"; await wait(2000);
    const opener = document.getElementById("bk-del-open");
    ok(document.documentElement.scrollWidth <= innerWidth + 1 && [...document.querySelectorAll(".hm-hero button")].every(b => b.getBoundingClientRect().right <= innerWidth + 1), "the Projects list header must fit the screen with the new button (page is " + document.documentElement.scrollWidth + "px wide)");
    if (ok(opener, "the Projects list must have a 'Delete projects…' button")) {
      ok(opener.getBoundingClientRect().height >= 44, "Delete projects button under 44px");
      opener.click(); await wait(2500);
      const dsh = document.querySelector(".bk-sheet"), goBtn = () => document.getElementById("bk-del-go"), tick = p => [...document.querySelectorAll(".bk-sheet input[type=checkbox]")].find(c => c.getAttribute("aria-label") === "Select " + p.name);
      if (ok(dsh && tick(DA) && tick(DB) && tick(DC), "the delete sheet must list every project with a checkbox")) {
        ok(goBtn().disabled, "nothing is selected at first: the delete button must be disabled"); ok(/0 of \d+ selected/.test(dsh.innerText), "counter must start at 0");
        ok(document.querySelector(".bk-sheet").getBoundingClientRect().right <= innerWidth + 1, "sheet wider than the screen");
        tick(DA).click(); tick(DB).click(); await wait(200);
        ok(/2 of \d+ selected/.test(dsh.innerText) && !goBtn().disabled, "ticking two projects must enable the button and count 2");
        goBtn().click(); await wait(300);
        ok(/Delete 2 projects\?/.test(dsh.innerText) && /Recently deleted/.test(dsh.innerText) && /restore/.test(dsh.innerText), "second confirmation must name the count and say they can be restored: " + dsh.innerText.slice(0, 200));
        [...dsh.querySelectorAll("button")].find(b => b.textContent === "Back").click(); await wait(200);
        ok(/2 of \d+ selected/.test(dsh.innerText), "Back must keep the selection"); goBtn().click(); await wait(200);
        const before = (await APPX.api("projects")).items.length;
        document.getElementById("bk-del-yes").click(); document.getElementById("bk-del-yes")?.click(); await wait(2000);
        ok(/2 projects deleted/.test(document.querySelector(".bk-sheet").innerText), "result must say 2 projects deleted");
        const left = (await APPX.api("projects")).items.map(p => p.id), gone = (await APPX.api("projects?deleted=1")).items.map(p => p.id);
        ok(!left.includes(DA.id) && !left.includes(DB.id) && left.includes(DC.id) && left.length === before - 2, "exactly the two ticked projects must be gone from the list");
        ok(gone.includes(DA.id) && gone.includes(DB.id), "deleted projects must be in Recently deleted (recoverable)");
        await APPX.api("projects/" + DA.id + "/restore", {}); APPX.changed("all");
        ok((await APPX.api("projects")).items.some(p => p.id === DA.id), "a deleted project must be restorable");
        document.querySelectorAll(".bk-sheet").forEach(e => e.remove());
      }
      // busy warning + 'Select all' wording, without confirming anything
      opener.isConnected || (location.hash = "#/projects", await wait(1500));
      document.getElementById("bk-del-open").click(); await wait(2500);
      const sh6 = document.querySelector(".bk-sheet"), cbC = [...document.querySelectorAll(".bk-sheet input[type=checkbox]")].find(c => c.getAttribute("aria-label") === "Select " + DC.name);
      if (ok(sh6 && cbC, "the delete sheet must open again")) {
        ok(/1 running/.test(sh6.innerText), "a project with a running scene must be marked '1 running'");
        cbC.click(); await wait(200); document.getElementById("bk-del-go").click(); await wait(300);
        ok(/does NOT stop the GPU/.test(sh6.innerText), "deleting a project with a running scene must warn that the GPU keeps running");
        [...sh6.querySelectorAll("button")].find(b => b.textContent === "Back").click(); await wait(200);
        const others = (await APPX.api("projects")).items.filter(p => !/^(Delete test|Bulk check|UI check)/.test(p.name));
        if (!others.length) { document.getElementById("bk-del-all").click(); await wait(200); document.getElementById("bk-del-go").click(); await wait(300); ok(/Delete ALL \d+ projects\?/.test(sh6.innerText), "selecting everything must say 'Delete ALL n projects?'"); }
      }
      document.querySelectorAll(".bk-sheet").forEach(e => e.remove());     // (nothing above ever confirmed a deletion of anything but the two test projects)
    }

    // ============ 5. cancel everything ============
    requests = [{ id: "r1", status: "IN_QUEUE" }, { id: "r2", status: "IN_QUEUE" }, { id: "r3", status: "IN_PROGRESS" }, { id: "r4", status: "FAILED" }, { id: "r5", status: "COMPLETED" }];
    if (SDB) await SDB.put("kv", { key: "director:" + P.id, value: { state: "FRAMES", paused: false } });
    localStorage.setItem("connector_act", ACT); calls.runpod.length = 0; calls.act.length = 0;
    location.hash = "#/projects/" + P.id + "/storyboard"; await wait(1500);
    document.getElementById("bk-stop").click(); await wait(1500);
    const sh2 = document.querySelector(".bk-sheet");
    if (ok(sh2, "Cancel everything must open a confirmation")) {
      ok(/2 waiting/.test(sh2.innerText) && /1 running/.test(sh2.innerText), "dialog must count 2 waiting + 1 running (finished jobs are not counted): " + sh2.innerText.slice(0, 260));
      ok(/Chat connector/.test(sh2.innerText), "dialog must mention the chat connector when the actions link exists");
      ok(calls.runpod.filter(c => c.startsWith("POST")).length === 0, "nothing may be cancelled before the confirmation");
      [...sh2.querySelectorAll("button")].find(b => /^Cancel everything/.test(b.textContent)).click(); await wait(1500);
      const cancelled = calls.runpod.filter(c => c.startsWith("POST cancel/")).sort().join();
      ok(cancelled === "POST cancel/r1,POST cancel/r2,POST cancel/r3", "must cancel exactly the 3 queued/running jobs: " + cancelled);
      ok(calls.runpod.filter(c => c === "POST purge-queue").length === 1, "must purge the queue once");
      ok(calls.act.some(c => c.op === "cancel_all" && c.body.confirm === true), "must tell the connector to stop everything, with confirm");
      if (SDB) { const d = await SDB.get("kv", "director:" + P.id); ok(d && d.value.paused === true, "the AI Director must be paused"); }
      ok(/Done\./.test(document.querySelector(".bk-sheet").innerText), "a result summary must be shown");
      document.querySelector(".bk-sheet [class*=pri], .bk-sheet button")?.click();
    }
    document.querySelectorAll(".bk-sheet").forEach(e => e.remove()); localStorage.removeItem("connector_act");
    // settings entry point
    location.hash = "#/settings/gpu"; await wait(2200);
    ok(!!document.getElementById("st-cancel-all"), "Settings -> GPU workers must have a Cancel everything button");
    ok(document.documentElement.scrollWidth <= innerWidth + 1, "settings page scrolls sideways");
    const cardTxt = (document.getElementById("st-cancel-all")?.closest("section,.card,.st-card,details,div[class*=card]") || document.body).innerText;   // (the Diagnostics card legitimately prints JSON nulls)
    ok(!/\b(null|undefined|\[object)/.test(cardTxt.split("Diagnostics")[0]), "raw null/undefined text next to the Cancel everything button");
  } catch (e) { fails.push("exception: " + (e && e.stack || e)); }
  finally {
    SP.sb.video = orig.video; SP.sb.use = orig.use; window.runpod = orig.runpod; window.fetch = orig.fetch; if (window.StudioJobs && orig.jobsQueue) StudioJobs.queue = orig.jobsQueue;
    if (orig.act === null) localStorage.removeItem("connector_act"); else localStorage.setItem("connector_act", orig.act);
    document.querySelectorAll(".bk-sheet").forEach(e => e.remove()); scrub();
    for (const id of pids) { try { await APPX.api("projects/" + id + "/delete", {}); if (SDB) await SDB.del("kv", "director:" + id); for (const k of Object.keys(localStorage)) if (k.startsWith("bulk:" + id) || k === "bulk_last:" + id) localStorage.removeItem(k); } catch {} }
    try { for (const a of (await APPX.api("assets")).items || []) if ((a.tags || []).includes("bulk-check")) await APPX.api("assets/" + a.id + "/delete", {}); } catch {}
    APPX.changed("all");
  }
  return { width: W, failures: fails, passed };
};
