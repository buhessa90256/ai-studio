// Studio Pro jobs in the browser: the same contract as the PC app's server (/api/generate, /api/status/<id>, /api/cancel, /api/queue ...),
// implemented with the Pages app's own pieces (runpod(), TOOLS from workflows.js, fetchBig, unb64). Jobs and results live in IndexedDB,
// so a finished job is still collected after a reload. Nothing here keeps the GPU awake on its own: a job only starts when the user starts it.
"use strict";
(() => {
  const D = window.SDB, B = window.StudioBackend;
  const now = () => Date.now() / 1000;
  const PRICE_PER_SEC = 1.75 / 3600;      // measured 2026-10-23 (RunPod currentSpendPerHr of the real worker); job seconds only, start-up/idle time is billed on top
  const flights = new Map();  // job id -> promise: one poll at a time per job, so a result is never saved twice

  const stripData = p => Object.fromEntries(Object.entries(p || {}).filter(([, v]) => !(typeof v === "string" && v.startsWith("data:"))));
  const typical = job => { try { return typicalSecs(job); } catch { return 120; } };

  async function generate(tool, params) {
    if (!TOOLS[tool] || tool === "fetch_result" || tool === "wake_up") throw B.bad(`unknown tool ${tool}`);
    if (!String(params?.prompt ?? "").trim()) throw B.bad("Please write a prompt.");
    let wf, uploads;
    try { [wf, uploads] = TOOLS[tool](params); } catch (e) { throw B.bad(e.message || String(e)); }
    const input = { workflow: wf, ai_tool: tool }; if (uploads.length) input.images = uploads;
    if (JSON.stringify(input).length > 9.5e6) throw B.bad("These files are too big to send (RunPod accepts about 10 MB). Use a shorter or smaller file.");
    const res = await runpod("POST", "run", { input });
    const job = { id: res.id, tool, params: stripData(params), started: now(), result: null, key: (() => { try { return jobKey(tool, params); } catch { return tool; } })() };
    await D.put("jobs", job);
    ensureWatcher();
    return { id: job.id };
  }

  // Keep a finished job's files in the "outputs" store; the Studio screens then copy what they want into the library (register).
  async function storeOutputs(job, st) {
    const out = st.output || {}, files = [], stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
    const add = (filename, bytes) => {
      const ext = (String(filename).match(/\.[a-z0-9]+$/i)?.[0] || ".png").toLowerCase();
      const type = { ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4", ".webm": "video/webm", ".flac": "audio/flac", ".wav": "audio/wav", ".mp3": "audio/mpeg" }[ext];
      if (!type) return;  // 3D models / json are not library files here
      files.push({ name: `${stamp}_${job.tool}_${job.id.slice(0, 6)}_${files.length}${ext}`, blob: new Blob([bytes], { type }) });
    };
    const big = (out.images || []).filter(x => x.type === "ai_saved");
    const listing = (out.images || []).find(x => x.type === "base64" && /listing\.json$/.test(x.filename || ""));
    if (big.length || listing) {
      const entries = big.length ? big : JSON.parse(new TextDecoder().decode(unb64(listing.data)));
      for (const f of await fetchBig(job.original || job.id, entries, () => {})) add(f.filename, f.bytes);
    }
    for (const it of out.images || []) {
      if (it.type !== "base64" || (it.filename || "").startsWith("input_") || /listing\.json$/.test(it.filename || "")) continue;
      add(it.filename || "", unb64(it.data));
    }
    for (const f of files) await D.put("outputs", { name: f.name, blob: f.blob, job: job.id, created: now() });
    return files.map(f => "/outputs/" + f.name);
  }
  async function finish(job, result) {
    job.result = result; await D.put("jobs", job);
    if (!job.recovered_from) await D.put("joblog", { id: job.id, tool: job.tool, status: result.status || (result.error ? "FAILED" : "?"), started: job.started, finished: now(), gpu_seconds: result.gpu_seconds || 0,
      cost: result.cost || 0, prompt: String(job.params?.prompt || "").slice(0, 300), error: String(result.error || "").slice(0, 300), files: result.files || [], params: job.params || {}, recovered_from: null });
  }

  async function pollOnce(id) {
    let job = await D.get("jobs", id);
    if (job?.result) return job.result;
    if (job?.alias) {  // the result is being fetched again from the worker's saved copy
      const r = await poll(job.alias);
      if (r.files || r.error) { await finish(job, r); }
      return r;
    }
    let st;
    try { st = await runpod("GET", `status/${id}`); } catch (e) {
      if (!/error 404/.test(e.message || "") || !job) throw e;
      // RunPod forgets a result 30 min after the job ends. The worker keeps a copy for 3 days: ask for it with a small job.
      const [wf] = TOOLS.fetch_result({ job_id: id });
      const res = await runpod("POST", "run", { input: { workflow: wf, ai_tool: "fetch_result" } });
      await D.put("jobs", { ...job, id: res.id, tool: job.tool, result: null, recovered_from: id, original: id, started: now(), params: job.params });
      job.alias = res.id; await D.put("jobs", job);
      return { status: "IN_QUEUE", elapsed: Math.round(now() - job.started), recovering: true };
    }
    const status = st.status, out = { status, elapsed: job ? Math.round(now() - job.started) : null };
    if (job) out.typical = typical(job);
    if (status === "IN_PROGRESS") out.progress = st.output?.ai_progress || { elapsed: Math.round(now() - (job?.started || now())), value: 0, max: 0, node_elapsed: 0, estimated: true };
    if (status === "COMPLETED" && job && !job.recovered_from && !(st.output?.images || []).length) {  // an older worker returned nothing: get the saved copy
      const [wf] = TOOLS.fetch_result({ job_id: id });
      const res = await runpod("POST", "run", { input: { workflow: wf, ai_tool: "fetch_result" } });
      await D.put("jobs", { ...job, id: res.id, result: null, recovered_from: id, original: id, started: now() });
      job.alias = res.id; await D.put("jobs", job);
      return { status: "IN_QUEUE", elapsed: Math.round(now() - job.started), recovering: true };
    }
    if (status === "COMPLETED" && job) {
      const files = await storeOutputs(job, st), secs = (st.executionTime || 0) / 1000;
      if (!job.recovered_from) { try { learnSecs(job, secs); } catch {} }
      Object.assign(out, { files, gpu_seconds: Math.round(secs), cost: +(secs * PRICE_PER_SEC).toFixed(3) });
      if (!files.length) out.error = st.output?.error || "The job finished but returned no files.";
    } else if (["FAILED", "CANCELLED", "TIMED_OUT"].includes(status) || (!status && st.error)) out.error = String(st.error || status);
    if (job && (["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(status) || out.error)) await finish(job, out);
    return out;
  }
  function poll(id) {
    if (!flights.has(id)) flights.set(id, pollOnce(id).finally(() => flights.delete(id)));
    return flights.get(id);
  }

  // A scene is waiting for a start frame or video: when its job has finished, attach the result even if the Storyboard screen is closed
  // (on a phone the page is often in the background). The Storyboard screen does the same; doing it twice is harmless.
  async function reconcileScenes() {
    for (const s of await D.all("scenes")) {
      if (!s.job_id || !["keyframe_generating", "generating"].includes(s.status)) continue;
      const job = await D.get("jobs", s.job_id);
      const r = job?.result;
      if (!r) continue;
      const video = s.status === "generating";
      const file = (r.files || []).find(f => video ? /\.(mp4|webm)$/i.test(f) : /\.(png|jpe?g|webp)$/i.test(f));
      try {
        if (file) {
          const asset = await B.route("POST", ["register"], {}, { file });
          await B.route("POST", ["scenes"], {}, { ...s, ...(video ? { video_asset: asset.id, status: "done" } : { start_asset: asset.id, status: "keyframe_ready" }), error: "" });
        } else if (r.error || r.status) await B.route("POST", ["scenes"], {}, { ...s, status: /cancel/i.test(r.status || r.error || "") ? "cancelled" : "failed", error: String(r.error || r.status).slice(0, 300) });
      } catch {}
    }
  }

  let watcherOn = false;
  function ensureWatcher() {
    if (watcherOn) return; watcherOn = true;
    setInterval(async () => {
      if (typeof API_KEY !== "undefined" && !API_KEY) return;
      for (const j of await D.all("jobs")) if (!j.result && !j.recovered_from) poll(j.id).catch(() => {});
      reconcileScenes().catch(() => {});
    }, 10000);
    reconcileScenes().catch(() => {});
  }

  async function queue() {
    const jobs = await D.all("jobs"), log = await D.all("joblog");
    const scenes = {}, projects = Object.fromEntries((await D.all("projects")).map(p => [p.id, p.name]));
    for (const s of await D.all("scenes")) if (s.job_id) scenes[s.job_id] = `${projects[s.project_id] || ""} / ${s.title || "scene"}`;
    const running = jobs.filter(j => !j.result && !j.recovered_from).map(j => ({ id: j.id, tool: j.tool, started: j.started, elapsed: Math.round(now() - j.started), typical: typical(j), prompt: String(j.params?.prompt || "").slice(0, 200), scene: scenes[j.id] || "" }));
    const recent = log.filter(r => !r.recovered_from).sort((a, b) => b.finished - a.finished).slice(0, 100).map(r => ({ ...r, params: undefined, scene: scenes[r.id] || "" }));
    return { running, recent, cost_recent: +recent.reduce((a, r) => a + (r.cost || 0), 0).toFixed(2) };
  }
  async function retry(id) {
    const rec = (await D.all("joblog")).find(r => r.id === id);
    if (!rec || !TOOLS[rec.tool]) throw B.bad("That job is not in the log.", 404);
    if (!rec.params || !Object.keys(rec.params).length) throw B.bad("The settings of this older job were not kept. Run it again from the page where you made it.");
    try { return await generate(rec.tool, { ...rec.params }); } catch (e) { throw B.bad("This job used files (photos, voices) that are not kept. Run it again from the page where you made it."); }
  }
  async function purgeOldOutputs() {
    const cut = now() - 2 * 86400;
    for (const o of await D.all("outputs")) if (o.created < cut) await D.del("outputs", o.name);
  }

  window.StudioJobs = { reconcileScenes, generate, poll, queue, retry, ensureWatcher, purgeOldOutputs,
    cancel: id => runpod("POST", `cancel/${id}`),
    health: async () => ({ has_key: true, endpoint_id: ENDPOINT(), runpod: await runpod("GET", "health") }),
    jobsList: async () => ({ jobs: (await D.all("jobs")).filter(j => !j.recovered_from && now() - j.started < 86400).map(j => ({ id: j.id, tool: j.tool, started: j.started, done: !!j.result })) }) };
  setTimeout(() => ensureWatcher(), 1500);
})();
