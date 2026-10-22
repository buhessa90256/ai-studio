// Live progress (studio/live.js) regression test. Runs INSIDE the page. Nothing is generated: the connector's fetch is replaced by a recorder that serves fake dashboards.
//   1. serve the folder:   python -m http.server 8800 --bind 127.0.0.1        (in ai-studio-mobile/)
//   2. open http://localhost:8800/index.html?ui=v2 with localStorage.apikey = JSON.stringify("x")
//   3. in the console:     eval(await (await fetch('/tests/live_check.js')).text()); await __liveCheck()
// Result: { failures: [...], passed: n }. Empty failures = pass.
"use strict";
window.__liveCheck = async function () {
  const fails = [], wait = ms => new Promise(r => setTimeout(r, ms)); let passed = 0;
  const ok = (c, msg) => { if (c) passed++; else fails.push(msg); return !!c; };
  const L = window.APP && APP.live; if (!L) return { failures: ["APP.live missing (live.js not loaded)"], passed: 0 };
  const T = L._t, S = T.state, FAKE = "http://fake-connector.test/ro/tok";
  const saved = { url: localStorage.getItem("connector_url"), fetch: window.fetch, watched: new Set(S.watched), found: new Set(S.found), fails: S.fails, last: S.last, status: S.status };
  const seen = []; let mode = "ok", frame = 1, running = true;
  const dash = () => ({ status: running ? "running" : "completed", phase: "generating_frames", scenes: [{ scene: 1, frame_version: frame, frame_done: frame > 1, clip_done: false, state: frame > 1 ? "frame_awaiting_approval" : "frame_generating", lifecycle: { stage: frame > 1 ? "ready_for_review" : "generating", step: frame > 1 ? 6 : 4, label: "x" }, gpu: null }], counts: {}, cost: {}, gpu: {} });
  try {
    if (/^#\/projects/.test(location.hash)) { location.hash = "#/home"; await wait(2500); }   // the project screen keeps re-watching its own movie; leave it so only this test feeds the poller
    // ---- pure helpers
    ok(T.delay(0, true) === 5000, "active polling must be 5 s");
    ok(T.delay(0, false) === 30000, "idle polling must be 30 s");
    ok(T.delay(1, true) === 5000 && T.delay(2, true) === 10000 && T.delay(3, true) === 20000 && T.delay(9, true) === 60000, "backoff must be 5, 10, 20 ... capped at 60 s");
    ok(T.assetKey(dash()) !== (frame++, T.assetKey(dash())), "a new frame version must change the asset key (it triggers the picture sync)");
    frame = 1;
    ok(T.isActive(dash()) && !T.isActive({ status: "completed", scenes: [{ lifecycle: { stage: "idle" } }] }), "isActive must follow the movie state");
    // ---- network behaviour against the recorder
    localStorage.setItem("connector_url", FAKE); S.watched.clear(); S.found.clear();
    window.fetch = function (u, o) {
      const s = String(u); if (!s.startsWith(FAKE)) return saved.fetch.apply(this, arguments);
      seen.push({ url: s, method: (o && o.method) || "GET", cache: o && o.cache, cred: o && o.credentials });
      if (mode === "down") return Promise.reject(new TypeError("Failed to fetch"));
      return Promise.resolve(new Response(JSON.stringify(s.includes("/movies") ? { movies: [] } : dash()), { status: 200, headers: { "Content-Type": "application/json" } }));
    };
    S.watched.add("m-test"); S.fails = 0;
    await T.tick(true);
    ok(S.status === "connected" && S.fails === 0, "a good poll must read Connected");
    ok(seen.length >= 1 && seen.every(r => r.method === "GET"), "polling must be GET only");
    ok(seen.every(r => r.cache === "no-store" && r.cred === "omit"), "polling must use cache:no-store and no credentials");
    ok(seen.every(r => !/\/act\//.test(r.url) && /\/ro\//.test(r.url)), "polling must only touch the read-only /ro/ routes");
    ok(seen.every(r => /[?&]_=\d+/.test(r.url)), "polling must add a cache-busting parameter");
    ok(!!L.get("m-test") && L.get("m-test").scenes[0].frame_version === 1, "the dashboard must be kept for the card");
    // a backend change shows up on the next poll
    let live = null; const off = APP.on("live", e => { live = e; }); frame = 2; await T.tick(true); off && off();
    ok(live && live.d.scenes[0].lifecycle.stage === "ready_for_review", "a state change must reach the app on the next poll");
    // one timer only
    const mine = () => seen.filter(r => r.url.includes("/dashboard?id=m-test")).length; let n0 = mine(); L.watch("m-test"); await wait(50); ok(mine() === n0, "watch() of an already watched movie must not poll");
    // failure + backoff + recovery
    mode = "down"; S.fails = 0; await T.tick(true); ok(S.status === "reconnecting" && S.fails === 1, "a failed poll must read Reconnecting");
    await T.tick(true); ok(S.fails === 2 && T.delay(S.fails, true) === 10000, "the second failure must double the wait");
    mode = "ok"; await T.tick(true); ok(S.status === "connected" && S.fails === 0, "recovery must read Connected again and reset the backoff");
    // hidden: no timer
    while (S.busy) await wait(50);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange"));
    ok(S.timer === null, "a hidden page must have no poll timer");
    await wait(100); n0 = seen.length; await wait(300); ok(seen.length === n0, "a hidden page must not poll");
    delete document.visibilityState; document.dispatchEvent(new Event("visibilitychange")); await wait(400);
    ok(seen.length > n0, "becoming visible must poll at once");
    // pill
    const pill = document.getElementById("live"); ok(!!pill && /Live/.test(pill.textContent), "the header must show a Live pill");
  } catch (e) { fails.push("exception: " + (e && e.stack || e)); }
  finally {
    window.fetch = saved.fetch; try { delete document.visibilityState; } catch {}
    if (saved.url === null) localStorage.removeItem("connector_url"); else localStorage.setItem("connector_url", saved.url);
    S.watched = saved.watched; S.found = saved.found; S.fails = saved.fails; S.last = saved.last; S.status = saved.status; delete S.movies["m-test"]; delete S.assets["m-test"];
    clearTimeout(S.timer); S.timer = null; document.dispatchEvent(new Event("visibilitychange"));
  }
  return { failures: fails, passed };
};
