// ChatGPT Storyboard Import (studio/import.js) regression test. Runs INSIDE the page. Nothing is generated: runpod(), SP.sb.video and the connector's fetch are replaced by recorders,
// and every throw-away project / asset the test makes is removed again.
//   1. serve the folder:   python -m http.server 8800 --bind 127.0.0.1        (in ai-studio-mobile/)
//   2. open http://localhost:8800/index.html?ui=v2 (localStorage.apikey = JSON.stringify("x")), resize to the width to test
//   3. in the console:     eval(await (await fetch('/tests/import_check.js')).text()); await __importCheck({ width: 390 })
// Result: { width, failures: [...], passed: n, gpu_calls: n }. Empty failures + gpu_calls 0 = pass.
"use strict";
window.__importCheck = async function (opts = {}) {
  const fails = [], wait = ms => new Promise(r => setTimeout(r, ms)); let passed = 0;
  const ok = (c, msg) => { if (c) passed++; else fails.push(msg); return !!c; };
  const W = innerWidth;
  if (opts.width && Math.abs(W - opts.width) > 1) return { width: W, failures: [`viewport is ${W}px, expected ${opts.width}px`], passed: 0 };
  const A = window.APP, SP = window.SP, I = window.IMP;
  if (!I) return { width: W, failures: ["window.IMP missing (import.js not loaded)"], passed: 0 };
  const calls = { runpod: [], video: [], fetch: [] };
  const orig = { runpod: window.runpod, video: SP.sb && SP.sb.video, fetch: window.fetch, act: localStorage.getItem("connector_act") };
  window.runpod = async (m, p) => { if (!(m === "GET" && p === "health")) calls.runpod.push(m + " " + p); return {}; };   // the app's own read-only GPU status check is not a job
  if (SP.sb) SP.sb.video = async id => { calls.video.push(id); };
  const pids = [];
  const mk = (w, h, color = "#b04030", type = "image/png", name = "x.png") => new Promise(res => { const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d"); const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, color); gr.addColorStop(1, "#202830"); g.fillStyle = gr; g.fillRect(0, 0, w, h); const rg = g.createRadialGradient(w / 2, h / 3, 5, w / 2, h / 3, w / 3); rg.addColorStop(0, "rgba(255,230,200,.9)"); rg.addColorStop(1, "rgba(255,230,200,0)"); g.fillStyle = rg; g.fillRect(0, 0, w, h); c.toBlob(b => res(new File([b], name, { type })), type); });
  const sheets = () => [...document.querySelectorAll(".ds-sheet")], top = () => sheets().slice(-1)[0];
  const btn = (root, re) => [...(root || document).querySelectorAll("button")].find(b => re.test(b.textContent) && !b.disabled);
  const setFiles = (input, files) => { const dt = new DataTransfer(); files.forEach(f => dt.items.add(f)); input.files = dt.files; input.dispatchEvent(new Event("change")); };
  const mkProject = async (source, n) => {
    const p = await A.saveProject({}, { name: "Import check " + Date.now(), aspect: "9:16", resolution: "768x1344", duration: 30, characters: [], story: "", description: "", data: source ? { image_source: source } : {} }); pids.push(p.id);
    const sc = []; for (let i = 0; i < n; i++) sc.push(await A.api("scenes", { project_id: p.id, title: "Scene " + (i + 1), action: "SCENE-" + (i + 1) + " Hessa walks", characters: [] }));
    return { p, sc };
  };
  const fresh = async (p) => (await A.api("scenes?project=" + p.id)).items;
  try {
    // ---- pure helpers + file checks
    ok(I.mode({ data: {} }) === "ai" && I.mode({ data: { image_source: "chatgpt" } }) === "chatgpt" && I.mode({ data: { connector_import_mode: "hybrid" } }) === "hybrid", "mode() must default to ai and read image_source / connector_import_mode");
    ok(I.gpuFramesBlocked({ data: { image_source: "chatgpt" } }) && !I.gpuFramesBlocked({ data: { image_source: "hybrid" } }) && !I.gpuFramesBlocked({ data: {} }), "only the ChatGPT import mode blocks GPU frames");
    const G = I._t.guessScene; ok(G("scene-3.png", 12) === 3 && G("S07_hessa.jpg", 12) === 7 && G("03.png", 12) === 3 && G("frame 12.webp", 12) === 12 && G("holiday.png", 12) === 0 && G("scene-20.png", 12) === 0, "file name to scene number mapping");
    const P = { aspect: "9:16" };
    const good = await I._t.inspect(await mk(768, 1344), P); ok(good.ok && !good.warnings.length && good.w === 768, "a 768x1344 PNG must pass cleanly");
    const small = await I._t.inspect(await mk(300, 540), P); ok(!small.ok && /At least 384/.test(small.errors[0]), "a tiny picture must be refused");
    const wide = await I._t.inspect(await mk(1344, 768), P); ok(!wide.ok && /Wrong shape/.test(wide.errors.join(" ")), "a landscape picture in a 9:16 project must be refused");
    const soft = await I._t.inspect(await mk(600, 1066), P); ok(soft.ok && /small/i.test(soft.warnings.join(" ")), "a smallish picture passes with a sharpness warning");
    const fit = await I._t.inspect(await mk(1000, 1500), P); ok(fit.ok && /fitted/.test(fit.warnings.join(" ")), "a slightly different shape is accepted and fitted, never stretched");
    const jpg = await I._t.inspect(await mk(768, 1344, "#3050b0", "image/jpeg", "a.jpg"), P); ok(jpg.ok && jpg.ext === "jpg", "JPG accepted");
    const webp = await I._t.inspect(await mk(768, 1344, "#30b050", "image/webp", "a.webp"), P); ok(webp.ok && webp.ext === "webp", "WebP accepted");
    const txt = await I._t.inspect(new File(["hello"], "notes.txt", { type: "text/plain" }), P); ok(!txt.ok && /PNG, JPG or WebP/.test(txt.errors[0]), "a text file must be refused");
    const empty = await I._t.inspect(new File([], "e.png", { type: "image/png" }), P); ok(!empty.ok, "an empty file must be refused");
    const huge = await I._t.inspect(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), new Uint8Array(16e6)], "h.png", { type: "image/png" }), P); ok(!huge.ok && /15 MB/.test(huge.errors[0]), "a file over 15 MB must be refused");

    // ---- local project: import, same file, replace, restore, the original is kept, no GPU
    const { p, sc } = await mkProject("chatgpt", 3);
    const f1 = await mk(768, 1344, "#b04030", "image/png", "scene-1.png"), f2 = await mk(768, 1344, "#2040c0", "image/png", "scene-1-v2.png");
    const i1 = await I._t.inspect(f1, p), i2 = await I._t.inspect(f2, p);
    let r = await I._t.importOne(p, sc[0], i1, { source: "chatgpt", number: 1 });
    let s0 = (await fresh(p))[0];
    ok(r.status === "imported" && s0.start_asset && s0.settings.frame_source === "chatgpt" && s0.settings.review === "pending" && s0.settings.frame_history.length === 1, "import must set the frame, source chatgpt, review pending and a history entry: " + JSON.stringify(r));
    const asset1 = (await A.api("assets")).items.find(a => a.id === s0.start_asset); ok(asset1 && asset1.size === f1.size, "the stored asset must be the ORIGINAL file (same byte size)");
    r = await I._t.importOne(p, s0, i1, { source: "chatgpt", number: 1 }); ok(r.status === "unchanged", "the same picture again changes nothing");
    r = await I._t.importOne(p, s0, i2, { source: "chatgpt", number: 1 }); ok(r.status === "blocked", "replacing without confirmation must be blocked");
    await A.api("scenes", { ...s0, video_asset: s0.start_asset, id: s0.id });                // pretend a finished video exists
    s0 = (await fresh(p))[0];
    r = await I._t.importOne(p, s0, i2, { source: "chatgpt", replace: true, number: 1 }); let s0b = (await fresh(p))[0];
    ok(r.status === "imported" && s0b.start_asset !== s0.start_asset && s0b.settings.frame_history.length === 2 && s0b.settings.clip_stale === true && !!s0b.video_asset, "replace: new frame, 2 versions, the video is kept and flagged outdated");
    r = await I._t.restoreOne(p, s0b, s0b.settings.frame_history[0]); const s0c = (await fresh(p))[0];
    ok(r.status === "imported" && s0c.start_asset === s0.start_asset && s0c.settings.frame_history.length === 3 && s0c.settings.review === "pending", "restoring an old version makes it current as a NEW version, nothing deleted");

    // ---- GPU guard
    let threw = ""; try { await SP.sb.use(p.id); await SP.sb.frame(sc[1].id); } catch (e) { threw = String(e.message || e); }
    ok(/never made on the GPU/.test(threw), "SP.sb.frame must refuse in a ChatGPT-import project: " + threw);
    threw = ""; try { await SP.sb.keyframes(); } catch (e) { threw = String(e.message || e); } ok(/never made on the GPU/.test(threw), "SP.sb.keyframes must refuse while scenes still wait for pictures");

    // ---- the single-picture sheet (pick, preview, replace confirmation)
    I.sheet(p, (await fresh(p))[1], { number: 2, scenes: await fresh(p) }); await wait(150);
    let sh = top(), go = [...sh.querySelectorAll("button")].find(b => /^Import frame$/.test(b.textContent)); ok(sh && /Import start frame · Scene 2/.test(sh.textContent) && /never uses the GPU/.test(sh.textContent), "the sheet must explain that no GPU is used");
    ok(go && go.disabled === true, "Import must be disabled until a valid picture is chosen");
    ok(!!sh.querySelector(".im-drop") && !!sh.querySelector('input[type=file]') && /png/.test(sh.querySelector('input[type=file]').accept), "drop zone + file input for PNG/JPG/WebP");
    ok(document.documentElement.scrollWidth <= innerWidth + 1, "the sheet must not overflow the screen width");
    setFiles(sh.querySelector('input[type=file]'), [await mk(1344, 768, "#111", "image/png", "wide.png")]); await wait(500);
    ok(/Wrong shape/.test(sh.textContent) && btn(sh, /^Import frame$/) === undefined, "a wrong-shape picture must show the reason and keep Import disabled");
    setFiles(sh.querySelector('input[type=file]'), [await mk(768, 1344, "#40a060", "image/png", "scene-2.png")]); await wait(500);
    ok(!!sh.querySelector(".im-prev img") && btn(sh, /^Import frame$/), "a good picture must show a preview and enable Import");
    btn(sh, /^Import frame$/).click(); await wait(700);
    let list = await fresh(p); ok(list[1].start_asset && list[1].settings.frame_source === "chatgpt" && !sheets().includes(sh), "importing from the sheet must set the frame and close it");
    // drag and drop
    I.sheet(p, list[2], { number: 3, scenes: list }); await wait(150); sh = top();
    const dt = new DataTransfer(); dt.items.add(await mk(768, 1344, "#a0a030", "image/png", "scene-3.png"));
    sh.querySelector(".im-drop").dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true })); await wait(500);
    ok(!!sh.querySelector(".im-prev img") && !!btn(sh, /^Import frame$/), "drag and drop must work like the file picker");
    sh.querySelector("button.ghost").click(); await wait(100);

    // ---- bulk: names decide, the rest in order, one bad file is reported, retry-safe, no GPU
    const b = await mkProject("chatgpt", 4); const bs = await fresh(b.p);
    I.bulk(b.p, bs, { refresh() {} }); await wait(150); sh = top();
    setFiles(sh.querySelector('input[type=file]'), [await mk(768, 1344, "#c03030", "image/png", "scene-2.png"), await mk(768, 1344, "#30c030", "image/png", "scene-1.png"), await mk(768, 1344, "#3030c0", "image/png", "03.png"), new File(["x"], "notes.txt", { type: "text/plain" })]); await wait(900);
    const sels = [...sh.querySelectorAll("select.im-sel")].map(x => x.value); ok(sels.join() === "2,1,3,0", "bulk mapping by file name: " + sels.join());
    ok(/1 need attention/.test(sh.textContent), "the bad file must be counted as needing attention");
    const gob = btn(sh, /^Import 3 pictures$/); ok(!!gob, "the button must say how many pictures will be imported"); gob.click(); await wait(2500);
    list = await fresh(b.p); ok(list.filter(s => s.start_asset).length === 3 && !list[3].start_asset && /3 imported/.test(document.body.textContent + sh.textContent), "bulk import must import the 3 good pictures and leave scene 4 empty");
    [...sh.querySelectorAll("button")].find(x => /^Close$/.test(x.textContent)).click();

    // ---- 12 scenes, 12 images: no GPU, no video started
    const t = await mkProject("chatgpt", 12); const ts = await fresh(t.p);
    I.bulk(t.p, ts, { refresh() {} }); await wait(150); sh = top();
    const files = []; for (let i = 1; i <= 12; i++) files.push(await mk(768, 1344, `hsl(${i * 28},60%,45%)`, "image/png", `scene-${String(i).padStart(2, "0")}.png`));
    setFiles(sh.querySelector('input[type=file]'), files.reverse()); await wait(2500);
    ok([...sh.querySelectorAll("select.im-sel")].map(x => +x.value).join() === "12,11,10,9,8,7,6,5,4,3,2,1", "12 files must map to 12 scenes by name regardless of the order picked");
    btn(sh, /^Import 12 pictures$/).click(); await wait(7000);
    list = await fresh(t.p); ok(list.every(s => s.start_asset && s.settings.review === "pending" && s.settings.frame_source === "chatgpt"), "all 12 scenes must hold an imported frame waiting for approval");
    ok(calls.runpod.length === 0 && calls.video.length === 0, "no RunPod call and no video start during imports: " + JSON.stringify(calls));
    [...sh.querySelectorAll("button")].find(x => /^Close$/.test(x.textContent)).click();

    // ---- the workflow card in the storyboard
    A.go("/projects/" + t.p.id); await wait(2000);
    const card = document.querySelector("#ws-root details.ws-sec"); ok(card && /ChatGPT Storyboard Import · 12\/12 frames/.test(card.textContent), "the workflow card must show the source and the frame count");
    ok(/Characters/.test(card.textContent) && /Import frames/.test(card.textContent) && /Approve/.test(card.textContent) && /Assemble/.test(card.textContent), "the card must show the workflow steps");
    ok(card.querySelectorAll(".im-sc").length === 12 && /ChatGPT import/.test(card.textContent) && /Video ≈/.test(card.textContent) && /\$0\.00 \(imported\)/.test(card.textContent), "one row per scene with source, video estimate and $0.00 frame cost");
    ok(document.documentElement.scrollWidth <= innerWidth + 1, "the storyboard with the card must not overflow");
    const small44 = [...card.querySelectorAll(".im-btns button")].every(x => x.getBoundingClientRect().height >= 43); ok(small44, "card buttons must be at least 44 px tall");

    // ---- a chat scene: the picture goes to the connector's import_frame route (stubbed), never to RunPod
    localStorage.setItem("connector_act", "http://fake-act.test/act/tok");
    window.fetch = async function (u, o) { if (String(u).startsWith("http://fake-act.test")) { calls.fetch.push([String(u), o && o.method, o && o.body && o.body.constructor.name, o && o.headers && o.headers["Content-Type"]]); return new Response(JSON.stringify({ ok: true, status: "imported", version: 1, gpu_used: false, message: "Scene 1 imported" }), { status: 200 }); } return orig.fetch.apply(this, arguments); };
    const chatScene = { ...(await fresh(b.p))[3], settings: { cm: "20261022-000000-aaaaa", cn: 1 } };
    const rc = await I._t.importOne(b.p, chatScene, await I._t.inspect(await mk(768, 1344, "#999", "image/png", "c.png"), b.p), { source: "chatgpt", number: 1 });
    ok(rc.status === "imported" && calls.fetch.length === 1 && /\/import_frame\?/.test(calls.fetch[0][0]) && calls.fetch[0][1] === "POST" && calls.fetch[0][2] === "File" && /movie_id=20261022-000000-aaaaa/.test(calls.fetch[0][0]) && /key=imp-/.test(calls.fetch[0][0]), "a chat scene must POST the raw file to /import_frame with an idempotency key: " + JSON.stringify(calls.fetch));
    localStorage.removeItem("connector_act");
    const rn = await I._t.importOne(b.p, chatScene, await I._t.inspect(await mk(768, 1344, "#888", "image/png", "d.png"), b.p), { source: "chatgpt" });
    ok(rn.status === "needs_link" && calls.fetch.length === 1, "without the actions link nothing is sent");
    ok(calls.runpod.length === 0 && calls.video.length === 0, "still no GPU activity");
  } catch (e) { fails.push("exception: " + (e && e.stack || e)); }
  finally {
    window.fetch = orig.fetch; window.runpod = orig.runpod; if (SP.sb) SP.sb.video = orig.video; if (orig.act === null) localStorage.removeItem("connector_act"); else localStorage.setItem("connector_act", orig.act);
    sheets().forEach(e => e.remove());
    for (const id of pids) { try { await A.api("projects/" + id + "/delete", {}); } catch {} }
    try { for (const a of (await A.api("assets")).items || []) if ((a.tags || []).some(t => t === "imported") && /^(scene-|c\.png|d\.png|x\.png|a\.|wide)/.test(a.filename)) await A.api("assets/" + a.id + "/delete", {}); } catch {}
    A.changed("all");
  }
  return { width: W, failures: fails, passed, gpu_calls: calls.runpod.length + calls.video.length };
};
