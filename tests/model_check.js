// Video-model selector regression test (MiniMax H3 / Wan 2.2 Fast / Wan 2.2 Full Quality). Runs INSIDE the page. Nothing is generated: runpod() and every connector request are replaced by recorders,
// throw-away projects/characters are removed again.
//   1. serve:   python -m http.server 8800 --bind 127.0.0.1        (in ai-studio-mobile/)
//   2. open http://localhost:8800/index.html?ui=v2 (localStorage.apikey = JSON.stringify("x")), resize to the width to test
//   3. console: eval(await (await fetch('/tests/model_check.js')).text()); await __modelCheck({ width: 390 })
// Result: { width, failures: [...], passed: n, gpu_calls: n }
"use strict";
window.__modelCheck = async function (opts = {}) {
  const fails = [], wait = ms => new Promise(r => setTimeout(r, ms)); let passed = 0;
  const ok = (c, msg) => { if (c) passed++; else fails.push(msg); return !!c; };
  const W = innerWidth;
  if (opts.width && Math.abs(W - opts.width) > 1) return { width: W, failures: [`viewport is ${W}px, expected ${opts.width}px`], passed: 0 };
  const A = window.APP, SP = window.SP, I = window.IMP;
  if (!I || !I.scene) return { width: W, failures: ["IMP.scene missing (import.js not loaded)"], passed: 0 };
  const jobs = [], fake = [];
  const orig = { runpod: window.runpod, fetch: window.fetch, act: localStorage.getItem("connector_act") };
  window.runpod = async (m, p, body) => { if (m === "GET" && p === "health") return {}; if (m === "GET") return { status: "IN_QUEUE" }; jobs.push({ m, p, tool: body && body.input && body.input.ai_tool }); return { id: "fake-" + jobs.length }; };   // a submit is recorded and never finishes: the test does not wait for results
  const pids = [], cids = [];
  const sheets = () => [...document.querySelectorAll(".ds-sheet")], top = () => sheets().slice(-1)[0];
  const btn = (root, re) => [...(root || document).querySelectorAll("button, a.ds-btn")].find(b => re.test(b.textContent) && !b.disabled);
  const selOf = (root, re) => [...(root || document).querySelectorAll("select")].find(s => re.test((s.parentElement || {}).textContent || ""));
  const act = "http://fake-act.test/act/tok";
  const png = () => new Promise(res => { const cv = document.createElement("canvas"); cv.width = 768; cv.height = 1344; const g = cv.getContext("2d"); g.fillStyle = "#806040"; g.fillRect(0, 0, 768, 1344); cv.toBlob(b => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }); });
  try {
    const c = await A.api("characters", { name: "ZZmodel Amer", description: "model check" }); cids.push(c.id);
    const p = await A.saveProject({}, { name: "Model check " + Date.now(), aspect: "9:16", resolution: "768x1344", duration: 30, characters: [c.id], story: "", description: "", data: {} }); pids.push(p.id);
    const start = await A.api("assets", { filename: "model-start.png", data: await png(), type: "image", tags: ["model-check"] });
    let sc = await A.api("scenes", { project_id: p.id, title: "Ghutra", action: "Amer gently adjusts his white ghutra and smiles. Dialogue: Welcome. Sound effects: soft chime.", characters: [c.id], start_asset: start.id, status: "keyframe_ready", settings: { review: "approved" } });
    // ---- local scene details: the selector is there, defaults follow the movie, a choice is saved on the scene
    I.scene(p, sc, { actions: { video: async () => {} }, chars: [c], scenes: [sc], refresh() {} }); await wait(600);
    let sh = top(); const sel = selOf(sh, /Video model for this scene/);
    ok(!!sel, "the scene details page has a 'Video model for this scene' selector");
    const opts_ = sel ? [...sel.options].map(o => o.textContent) : [];
    ok(opts_.length === 4 && /Follow the movie: MiniMax H3/.test(opts_[0]) && opts_.some(t => /Wan 2\.2 — Video Only \(Fast\)/.test(t)) && opts_.some(t => /Full Quality/.test(t)), "options: follow the movie (MiniMax H3 default), MiniMax, Wan Fast, Wan Full: " + JSON.stringify(opts_));
    ok(sel && sel.value === "", "MiniMax H3 stays the default (no explicit choice saved)");
    if (sel) { sel.value = "wan22_i2v:fast"; sel.dispatchEvent(new Event("change")); await wait(900); }
    sc = (await A.api("scenes?project=" + p.id)).items[0];
    ok((sc.settings || {}).video_model === "wan22_i2v:fast" && (sc.settings || {}).review === "approved", "the choice is saved with the scene and other settings are kept: " + JSON.stringify(sc.settings));
    sheets().forEach(e => e.remove());
    // ---- routing: the app's own video job goes to the chosen model; Wan is silent, has no end frame and no dialogue / sound lines
    await SP.sb.use(p.id);
    SP.sb.video(sc.id).catch(() => {}); await wait(1500);
    ok(jobs.some(j => j.tool === "wan_i2v"), "a scene set to Wan Fast is sent to wan_i2v: " + JSON.stringify(jobs.map(j => j.tool)));
    jobs.length = 0;
    await A.api("scenes", { ...(await A.api("scenes?project=" + p.id)).items[0], settings: { review: "approved", video_model: "wan22_i2v:full" }, status: "keyframe_ready", job_id: "" }); await SP.sb.use(p.id);
    SP.sb.video(sc.id).catch(() => {}); await wait(1500);
    ok(jobs.some(j => j.tool === "wan_i2v_full"), "Wan Full Quality is sent to wan_i2v_full: " + JSON.stringify(jobs.map(j => j.tool)));
    jobs.length = 0;
    await A.api("scenes", { ...(await A.api("scenes?project=" + p.id)).items[0], settings: { review: "approved" }, status: "keyframe_ready", job_id: "" }); await SP.sb.use(p.id);
    SP.sb.video(sc.id).catch(() => {}); await wait(1500);
    ok(jobs.some(j => j.tool === "minimax_h3") && !jobs.some(j => /wan/.test(j.tool || "")), "with no choice the scene still goes to minimax_h3 (backward compatible): " + JSON.stringify(jobs.map(j => j.tool)));
    // ---- a project default applies to scenes without their own choice
    await A.saveProject(p, { data: { ...(p.data || {}), video_model: "wan22_i2v:fast" } });
    jobs.length = 0; await SP.sb.use(p.id);
    await A.api("scenes", { ...(await A.api("scenes?project=" + p.id)).items[0], status: "keyframe_ready", job_id: "" }); await SP.sb.use(p.id);
    SP.sb.video(sc.id).catch(() => {}); await wait(1500);
    ok(jobs.some(j => j.tool === "wan_i2v"), "the project's video model is used when the scene has none: " + JSON.stringify(jobs.map(j => j.tool)));
    // ---- a chat scene: the choice goes to the connector (set_video_model) and the Compare button is offered for an approved frame
    localStorage.setItem("connector_act", act);
    window.fetch = async function (u, o) {
      if (!String(u).startsWith("http://fake-act.test")) return orig.fetch.apply(this, arguments);
      const op = String(u).split("/").pop(), body = JSON.parse(o.body); fake.push([op, body]);
      if (op === "set_video_model") return new Response(JSON.stringify({ ok: true, message: "Scene 3 will use Wan 2.2 — Video Only (Wan 2.2 Fast (4-step LightX2V))." }), { status: 200 });
      return new Response("{}", { status: 404 });
    };
    const cur = (await A.api("scenes?project=" + p.id)).items[0];
    await A.api("scenes", { ...cur, status: "video_waiting", settings: { cm: "20261024-165036-7dac4", cn: 3, cstate: "frame_done", review: "approved", cmeta: { sha256: "ab".repeat(32), version: 1 }, cvm: "minimax_h3:high", cvmo: false, cvmd: "minimax_h3:high" } });
    const chatSc = (await A.api("scenes?project=" + p.id)).items[0];
    I.scene(p, chatSc, { actions: {}, chars: [c], scenes: [chatSc], refresh() {} }); await wait(600);
    sh = top(); const csel = selOf(sh, /Video model for this scene/);
    ok(!!csel && /Follow the movie: MiniMax H3/.test(csel.options[0].textContent), "a chat scene shows the connector's movie default");
    ok(!!btn(sh, /Compare video models/), "an approved chat scene offers 'Compare video models…'");
    if (csel) { csel.value = "wan22_i2v:full"; csel.dispatchEvent(new Event("change")); await wait(800); }
    const sm = fake.find(x => x[0] === "set_video_model");
    ok(sm && sm[1].movie_id === "20261024-165036-7dac4" && sm[1].model === "wan22_i2v" && sm[1].preset === "full" && sm[1].scene_number === 3, "set_video_model is sent to the connector with movie, scene, model and preset: " + JSON.stringify(fake));
    ok(document.documentElement.scrollWidth <= innerWidth + 1, "no horizontal overflow");
    sheets().forEach(e => e.remove());
  } catch (e) { fails.push("exception: " + (e && e.stack || e)); }
  finally {
    window.runpod = orig.runpod; window.fetch = orig.fetch; if (orig.act == null) localStorage.removeItem("connector_act"); else localStorage.setItem("connector_act", orig.act);
    for (const pid of pids) { try { await A.api("projects/" + pid + "/delete", {}); } catch {} }
    for (const id of cids) { try { await A.api("characters/" + id + "/delete", {}); } catch {} }
    document.querySelectorAll(".ds-sheet").forEach(e => e.remove());
  }
  return { width: W, failures: fails, passed, gpu_calls: jobs.filter(j => j.m === "POST").length };
};
