// Speech to subtitles inside the browser (Whisper through transformers.js, vendored in studio/vendor/transformers/).
// The audio never leaves the device; only the speech model is downloaded once from huggingface.co and cached by the browser.
"use strict";
(() => {
  const B = window.StudioBackend;
  const BASE = new URL("vendor/transformers/", document.currentScript.src).href;
  const MODELS = { tiny: "Xenova/whisper-tiny", base: "Xenova/whisper-base", small: "Xenova/whisper-small" };
  const jobs = new Map(), pipes = {};
  let lib;

  async function loadLib() {
    if (!lib) {
      lib = await import(BASE + "transformers.min.js");
      lib.env.allowLocalModels = false;
      lib.env.backends.onnx.wasm.wasmPaths = BASE;  // the runtime comes from this site, not from a CDN
      lib.env.backends.onnx.wasm.numThreads = 1;    // GitHub Pages cannot send the headers multi-threading needs
    }
    return lib;
  }
  async function getPipe(size, job) {
    if (pipes[size]) return pipes[size];
    const { pipeline } = await loadLib();
    const progress_callback = p => { if (p.status === "progress" && p.total) job.status = `downloading the speech model ${Math.round(p.loaded / p.total * 100)}% (first time only)`; };
    // wasm + quantized weights: slower than WebGPU but works on every phone; the model is cached after the first use
    pipes[size] = await pipeline("automatic-speech-recognition", MODELS[size], { device: "wasm", dtype: "q8", progress_callback });
    return pipes[size];
  }
  async function mono16k(blob) {  // decode any audio/video file to 16 kHz mono samples
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    try {
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer()), out = new Float32Array(buf.length);
      for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < out.length; i++) out[i] += d[i] / buf.numberOfChannels; }
      return out;
    } catch { throw B.bad("This file has no sound the browser can read."); } finally { ctx.close?.(); }
  }

  async function run(job, assetId, language, size) {
    try {
      const blob = await B.getBlob(assetId);
      if (!blob) throw B.bad("Asset not found.");
      job.status = "loading";
      const asr = await getPipe(size, job);
      job.status = "listening";
      const audio = await mono16k(blob);
      const opts = { task: "transcribe", return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 };
      if (language) opts.language = language;
      const res = await asr(audio, opts);
      const segments = [];
      for (const c of res.chunks || []) {
        const text = String(c.text || "").trim(), [s, e] = c.timestamp || [0, null];
        if (text) segments.push({ start: +(+s || 0).toFixed(2), end: +((e ?? (+s + 2)) || 0).toFixed(2), text });
      }
      Object.assign(job, { status: "done", language: language || "auto", segments });
    } catch (e) { Object.assign(job, { status: "failed", error: (e && e.message || String(e)).slice(0, 400) }); }
    job.finished = Date.now() / 1000;
  }

  window.StudioSubtitles = {
    start({ asset_id, language, size }) {
      const sz = MODELS[size] ? size : "base";
      const job = { id: Math.random().toString(36).slice(2, 12), status: "starting", started: Date.now() / 1000 };
      jobs.set(job.id, job);
      run(job, asset_id, String(language || "").slice(0, 12).toLowerCase() === "auto" ? "" : String(language || "").slice(0, 12), sz);
      return job;
    },
    status(id) { const j = jobs.get(id); if (!j) throw B.bad("Unknown job."); return j; },
  };
})();
