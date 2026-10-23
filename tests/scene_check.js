// Scene Details page + hidden-chat-movie recovery regression test. Runs INSIDE the page. Nothing is generated: runpod(), SP.sb.video and every connector request are replaced by recorders
// for the duration of the test; throw-away projects and characters are removed again.
//   1. serve the folder:   python -m http.server 8800 --bind 127.0.0.1        (in ai-studio-mobile/)
//   2. open http://localhost:8800/index.html?ui=v2 (localStorage.apikey = JSON.stringify("x")), resize to the width to test
//   3. in the console:     eval(await (await fetch('/tests/scene_check.js')).text()); await __sceneCheck({ width: 390 })
// Result: { width, failures: [...], passed: n, gpu_calls: n }.
"use strict";
window.__sceneCheck = async function (opts = {}) {
  const fails = [], wait = ms => new Promise(r => setTimeout(r, ms)); let passed = 0;
  const ok = (c, msg) => { if (c) passed++; else fails.push(msg); return !!c; };
  const W = innerWidth;
  if (opts.width && Math.abs(W - opts.width) > 1) return { width: W, failures: [`viewport is ${W}px, expected ${opts.width}px`], passed: 0 };
  const A = window.APP, SP = window.SP, I = window.IMP;
  if (!I || !I.scene) return { width: W, failures: ["IMP.scene missing (import.js not loaded)"], passed: 0 };
  const calls = { runpod: [], video: [], fake: [], conn: [] };
  const orig = { runpod: window.runpod, video: SP.sb && SP.sb.video, fetch: window.fetch, act: localStorage.getItem("connector_act"), url: localStorage.getItem("connector_url") };
  window.runpod = async (m, p) => { if (!(m === "GET" && p === "health")) calls.runpod.push(m + " " + p); return {}; };
  if (SP.sb) SP.sb.video = async id => { calls.video.push(id); };
  const pids = [], cids = [];
  const mk = (c = "#b04030", name = "scene-11.png") => new Promise(res => { const cv = document.createElement("canvas"); cv.width = 768; cv.height = 1344; const g = cv.getContext("2d"); const gr = g.createLinearGradient(0, 0, 768, 1344); gr.addColorStop(0, c); gr.addColorStop(1, "#202830"); g.fillStyle = gr; g.fillRect(0, 0, 768, 1344); cv.toBlob(b => res(new File([b], name, { type: "image/png" })), "image/png"); });
  const sheets = () => [...document.querySelectorAll(".ds-sheet")], top = () => sheets().slice(-1)[0];
  const btn = (root, re) => [...(root || document).querySelectorAll("button, a.ds-btn")].find(b => re.test(b.textContent) && !b.disabled);
  const act = "http://fake-act.test/act/tok";
  try {
    // throw-away characters + project + scene with an imported frame
    const names = ["ZZcheck Hessa", "ZZcheck Rumi", "ZZcheck Mira", "ZZcheck Zoey"], chars = [];
    for (const n of names) { const c = await A.api("characters", { name: n, description: "scene check" }); cids.push(c.id); chars.push(c); }
    const p = await A.saveProject({}, { name: "Scene check " + Date.now(), aspect: "9:16", resolution: "768x1344", duration: 30, characters: chars.map(c => c.id), story: "", description: "", data: { image_source: "chatgpt" } }); pids.push(p.id);
    let sc = await A.api("scenes", { project_id: p.id, title: "The portal at sunrise", action: "SCENE-11 the four walk toward the glowing portal", characters: chars.map(c => c.id) });
    const ins = await I._t.inspect(await mk(), p), r0 = await I._t.importOne(p, sc, ins, { source: "chatgpt", number: 11 }); ok(r0.status === "imported", "setup import: " + JSON.stringify(r0));
    sc = (await A.api("scenes?project=" + p.id)).items[0];
    const recorded = []; const actions = { video: async s => { recorded.push(s.id); } };
    // ---- local scene: every control, approve, generate (through the app's own action), play, download, retry
    I.scene(p, sc, { actions, chars, scenes: [sc], refresh() {} }); await wait(500);
    let sh = top();
    ok(sh && /Scene 1/.test(sh.textContent) && /The portal at sunrise/.test(sh.textContent), "scene number and title");
    ok(names.every(n => sh.textContent.includes(n)), "all four assigned characters are listed");
    ok(!!sh.querySelector("img[alt*='start frame']") && /ChatGPT import/.test(sh.textContent), "start-frame preview and its source");
    ok(!!btn(sh, /Replace image/) && !!btn(sh, /Approve frame/), "Replace image and Approve frame are offered");
    ok(!btn(sh, /Generate video/), "no video button before the frame is approved");
    ok(document.documentElement.scrollWidth <= innerWidth + 1, "the scene page must not overflow the screen");
    ok([...sh.querySelectorAll("button, a.ds-btn")].filter(b => b.offsetParent).every(b => b.getBoundingClientRect().height >= 43), "all controls at least 44 px tall");
    btn(sh, /Approve frame/).click(); await wait(900);
    ok((await A.api("scenes?project=" + p.id)).items[0].settings.review === "approved" && !!btn(top(), /Generate video/), "approving switches the page to Generate video");
    btn(top(), /Generate video/).click(); await wait(400);
    ok(recorded.length === 1 && calls.video.length === 0, "Generate video calls the app's video action once (stubbed): " + recorded.length);
    // fake finished video => player + download + regenerate
    const vid = (await A.api("assets", { filename: "scene-11.mp4", data: "data:video/mp4;base64,AAAA", type: "video", tags: ["scene-check"] }));
    await A.api("scenes", { ...(await A.api("scenes?project=" + p.id)).items[0], video_asset: vid.id, status: "done" }); A.changed("scenes"); await wait(1200);
    sh = top(); ok(!!sh.querySelector("video[controls][playsinline]") && !!sh.querySelector("a[download]"), "a finished video shows a player and a download link");
    ok(!!btn(sh, /Regenerate video/), "regenerate is offered for a finished video");
    await A.api("scenes", { ...(await A.api("scenes?project=" + p.id)).items[0], video_asset: "", status: "failed", error: "RunPod job failed" }); A.changed("scenes"); await wait(1200);
    ok(!!btn(top(), /Retry failed video/), "a failed video shows Retry failed video");
    sheets().forEach(e => e.remove());

    // ---- a chat scene: preview -> price confirmation -> one generate request with checksum + cast; blocked answers are shown, not swallowed
    localStorage.setItem("connector_act", act);
    const sha = "ab".repeat(32);
    window.fetch = async function (u, o) {
      if (!String(u).startsWith("http://fake-act.test")) return orig.fetch.apply(this, arguments);
      const op = String(u).split("/").pop(), body = JSON.parse(o.body); calls.fake.push([op, body]);
      if (op === "video_preview") return new Response(JSON.stringify(window.__previewAnswer), { status: 200 });
      if (op === "generate_video") return new Response(JSON.stringify({ ok: true, status: "submitted", gpu_used: true, runpod_job_id: "rp-job-123", message: "Scene 11: its video starts now. RunPod job rp-job-123." }), { status: 200 });
      return new Response("{}", { status: 404 });
    };
    const cs = { ...(await A.api("scenes?project=" + p.id)).items[0] };
    await A.api("scenes", { ...cs, video_asset: "", status: "keyframe_ready", error: "", settings: { ...cs.settings, cm: "20261022-171859-3c0f8", cn: 11, review: "pending", cmeta: { sha256: sha, version: 1 }, csource: "chatgpt" } });
    const chatSc = (await A.api("scenes?project=" + p.id)).items[0];
    window.__previewAnswer = { ok: false, status: "blocked", message: "Not started: scene_characters_in_library: Zoey unknown. Nothing was submitted and nothing was charged.", checks: [] };
    I.scene(p, chatSc, { actions, chars, scenes: [chatSc], refresh() {} }); await wait(500);
    ok(!!btn(top(), /Approve frame & generate video/) && !btn(top(), /^Approve frame$/), "a chat scene offers ONE combined button (approving starts only this scene's video)");
    btn(top(), /Approve frame & generate video/).click(); await wait(800);
    ok(/Zoey unknown/.test(top().textContent) && calls.fake.length === 1 && calls.fake[0][0] === "video_preview", "a blocked preview shows the reason and starts nothing: " + JSON.stringify(calls.fake.map(x => x[0])));
    window.__previewAnswer = { ok: true, status: "needs_confirmation", estimated_cost_usd: 0.2, message: "Ready." };
    btn(top(), /Approve frame & generate video/).click(); await wait(800);
    const conf = top(); ok(/Make scene 11's video/.test(conf.textContent) && /\$0\.20/.test(conf.textContent) && /only/i.test(conf.textContent), "the price and the 'only this scene' promise are shown before anything is sent");
    ok(!calls.fake.some(x => x[0] === "generate_video"), "nothing is generated before the confirmation");
    btn(conf, /^Approve & generate$/).click(); await wait(1200);
    const g = calls.fake.filter(x => x[0] === "generate_video"); ok(g.length === 1, "exactly one generate request");
    const b = g[0] && g[0][1]; ok(b && b.confirm === true && b.approve_frame === true && b.expected_sha256 === sha && b.movie_id === "20261022-171859-3c0f8" && b.scene_number === 11 && b.expected_characters.length === 4 && /^app-/.test(b.idempotency_key), "the request carries the checksum, the four characters and an idempotency key: " + JSON.stringify(b));
    ok(/rp-job-123/.test(document.body.textContent), "the RunPod job id is shown");
    sheets().forEach(e => e.remove());
    localStorage.removeItem("connector_act");
    I.scene(p, chatSc, { actions, chars, scenes: [chatSc], refresh() {} }); await wait(400);
    btn(top(), /Approve frame & generate video/).click(); await wait(600);
    ok(/actions/.test(top().textContent) && /ask your chat/i.test(top().textContent), "without the actions link the page says how to get it");
    sheets().forEach(e => e.remove());
    ok(calls.runpod.length === 0 && calls.video.length === 0, "no RunPod activity: " + JSON.stringify(calls.runpod));

    // ---- a chat movie deleted on this phone is reported and can be restored (nothing recreated, nothing lost)
    const mid = "20261022-171859-3c0f8", hp = await A.saveProject({}, { name: "Chat: Hessa hidden check", aspect: "9:16", resolution: "768x1344", duration: 30, characters: [], story: "", description: "", data: { connector_id: mid }, folder: "From chat" }); pids.push(hp.id);
    await A.api("scenes", { project_id: hp.id, title: "Scene 1", action: "kept scene", characters: [] });
    await A.api("projects/" + hp.id + "/delete", {});
    localStorage.setItem("connector_url", "http://fake-conn.test/ro/" + "a".repeat(40));
    window.fetch = async function (u, o) {
      const s = String(u); if (!s.startsWith("http://fake-conn.test")) return orig.fetch.apply(this, arguments); calls.conn.push(s.replace(/_=\d+/, ""));
      const J = x => new Response(JSON.stringify(x), { status: 200 });
      if (s.includes("/characters")) return J({ characters: [] });
      if (s.includes("/movies")) return J({ movies: [{ id: mid, title: "Hessa & K-Pop Demon Hunters", status: "paused", scenes: 1 }] });
      if (s.includes("/movie?")) return J({ movie_id: mid, title: "Hessa & K-Pop Demon Hunters", status: "paused", aspect: "9:16", import_mode: null, scenes: [{ scene_number: 1, action: "kept scene", state: "frame_awaiting_approval", characters: [], versions: { frame: 1, clip: 1 } }] });
      return J({});
    };
    for (let i = 0; i < 12 && !(A.hiddenChat || []).some(m => m.id === mid); i++) { await window.__connectorSync(); await wait(600); }
    ok((A.hiddenChat || []).some(m => m.id === mid), "a chat movie deleted on this phone must be reported as hidden: " + JSON.stringify(A.hiddenChat));
    const live = (await A.api("projects")).items.filter(x => x.data && x.data.connector_id === mid); ok(live.length === 0, "the sync must not recreate it behind the user's back");
    const banner = I.hiddenBanner(); ok(banner && /hidden on this phone/.test(banner.textContent) && /nothing was lost/.test(banner.textContent), "the banner explains what happened");
    document.body.append(banner); btn(banner, /Restore/).click(); await wait(2500); banner.remove();
    const after = (await A.api("projects")).items.filter(x => x.data && x.data.connector_id === mid);
    ok(after.length === 1 && after[0].id === hp.id, "restore brings back the SAME project (no duplicate): " + after.length);
    ok(((await A.api("scenes?project=" + hp.id)).items || []).some(s => s.action === "kept scene") && !(A.hiddenChat || []).length, "its scenes are intact and the hidden list is empty");
    ok(calls.conn.every(c => !/\/act\//.test(c)) && calls.runpod.length === 0, "recovery only read from the connector");
  } catch (e) { fails.push("exception: " + (e && e.stack || e)); }
  finally {
    window.fetch = orig.fetch; window.runpod = orig.runpod; if (SP.sb) SP.sb.video = orig.video;
    if (orig.act === null) localStorage.removeItem("connector_act"); else localStorage.setItem("connector_act", orig.act);
    if (orig.url === null) localStorage.removeItem("connector_url"); else localStorage.setItem("connector_url", orig.url);
    sheets().forEach(e => e.remove()); delete window.__previewAnswer;
    for (const id of pids) { try { await A.api("projects/" + id + "/delete", {}); } catch {} }
    for (const id of cids) { try { await A.api("characters/" + id + "/delete", {}); } catch {} }
    try { for (const a of (await A.api("assets")).items || []) if ((a.tags || []).some(t => t === "imported" || t === "scene-check") && /^(scene-11)/.test(a.filename)) await A.api("assets/" + a.id + "/delete", {}); } catch {}
    A.changed("all");
  }
  return { width: W, failures: fails, passed, gpu_calls: calls.runpod.length + calls.video.length };
};
