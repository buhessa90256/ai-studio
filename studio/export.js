// Movie export inside the browser (no server, no FFmpeg): frames are drawn on a canvas and encoded with the browser's WebCodecs video encoder,
// the sound is mixed with an OfflineAudioContext and encoded with the audio encoder, and mp4-muxer packs both into an .mp4 file.
// Same timeline as the PC app: trim, order, crossfades, fades, extra audio tracks (start / trim / volume / fades), text and subtitles.
"use strict";
(() => {
  const B = window.StudioBackend;
  const SIZES = { "16:9": [1344, 768], "9:16": [768, 1344], "1:1": [1024, 1024], "4:3": [1152, 864], "21:9": [1536, 656] };
  const HD = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "4:3": [1440, 1080], "21:9": [2560, 1080] };
  const FPS = 24, SR = 48000;
  const COLORS = { white: "#fff", yellow: "#ffe600", black: "#000", red: "#ff3b30", cyan: "#00e5ff" };
  const jobs = new Map();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const even = n => n - (n % 2);

  const supported = () => typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined" && typeof VideoFrame !== "undefined" && typeof AudioData !== "undefined" && typeof Mp4Muxer !== "undefined";

  async function pickVideoCodec(W, H, bitrate) {
    for (const [codec, muxName] of [["avc1.64002A", "avc"], ["avc1.640032", "avc"], ["avc1.4D002A", "avc"], ["vp09.00.40.08", "vp9"]]) {
      const cfg = { codec, width: W, height: H, bitrate, framerate: FPS };
      try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return { cfg, muxName }; } catch {}
    }
    throw B.bad("This browser can't encode video (it has no H.264 or VP9 encoder). Use Chrome on Android/desktop, or the PC version.");
  }
  async function pickAudioCodec() {
    for (const [codec, muxName] of [["mp4a.40.2", "aac"], ["opus", "opus"]]) {
      const cfg = { codec, sampleRate: SR, numberOfChannels: 2, bitrate: 192000 };
      try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) return { cfg, muxName }; } catch {}
    }
    return null;  // no audio encoder: the movie is exported without sound (reported to the user)
  }

  // when each clip starts on the movie time line (crossfades overlap the next clip)
  function layout(clips) {
    const L = []; let t = 0;
    clips.forEach((c, i) => {
      const d = c.out - c.in, next = clips[i + 1];
      const tr = next ? Math.max(0, Math.min(c.transition || 0, (next.out - next.in) - 0.1, d - 0.1)) : 0;
      L.push({ c, start: t, dur: d, tr });
      t += d - tr;
    });
    const last = L[L.length - 1];
    return { L, total: last.start + last.dur };
  }

  async function loadVideo(asset) {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.crossOrigin = "anonymous";
    const url = URL.createObjectURL(await B.getBlob(asset.id));
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(B.bad(`Could not read '${asset.filename}'.`)); v.src = url; });
    return { v, url };
  }
  const seek = (v, t) => new Promise(res => {
    if (Math.abs(v.currentTime - t) < 0.001 && v.readyState >= 2) return res();
    const done = () => { v.removeEventListener("seeked", done); clearTimeout(to); res(); };
    const to = setTimeout(done, 3000);
    v.addEventListener("seeked", done); v.currentTime = Math.min(t, Math.max(0, (v.duration || t) - 0.001));
  });

  async function mixAudio(layoutInfo, tl, onProgress) {
    const { L, total } = layoutInfo;
    const ctx = new OfflineAudioContext(2, Math.ceil(total * SR), SR);
    const place = async (asset, { start, from, to, volume, fadeIn, fadeOut, extraIn = 0, extraOut = 0 }) => {
      const blob = await B.getBlob(asset.id);
      if (!blob) return false;
      let buf;
      try { buf = await ctx.decodeAudioData(await blob.arrayBuffer()); } catch { return false; }  // no sound track: stays silent
      const d = Math.max(0.05, to - from), src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buf; src.connect(g); g.connect(ctx.destination);
      const fi = Math.max(fadeIn || 0, extraIn), fo = Math.max(fadeOut || 0, extraOut);
      g.gain.setValueAtTime(fi > 0 ? 0 : volume, start);
      if (fi > 0) g.gain.linearRampToValueAtTime(volume, start + Math.min(fi, d));
      if (fo > 0) { g.gain.setValueAtTime(volume, Math.max(start, start + d - fo)); g.gain.linearRampToValueAtTime(0, start + d); }
      src.start(start, from, d);
      return true;
    };
    let heard = 0;
    for (const [i, x] of L.entries()) {
      const a = await B.getAsset(x.c.asset_id), prevTr = i ? L[i - 1].tr : 0;
      if (a && await place(a, { start: x.start, from: x.c.in, to: x.c.out, volume: x.c.volume ?? 1, fadeIn: x.c.fade_in, fadeOut: x.c.fade_out, extraIn: prevTr, extraOut: x.tr })) heard++;
      onProgress?.((i + 1) / (L.length + tl.audio.length));
    }
    for (const [i, t] of tl.audio.entries()) {
      const a = await B.getAsset(t.asset_id);
      if (a && await place(a, { start: t.start, from: t.in, to: t.out, volume: t.volume, fadeIn: t.fade_in, fadeOut: t.fade_out })) heard++;
      onProgress?.((L.length + i + 1) / (L.length + tl.audio.length));
    }
    return { buffer: await ctx.startRendering(), heard };
  }

  function drawText(g, W, H, t) {
    g.save();
    g.font = `${t.size}px sans-serif`; g.textAlign = "center"; g.textBaseline = "top";
    const maxW = W * 0.9, lines = [];
    for (const raw of String(t.text).split("\n")) {  // wrap long lines at word boundaries
      let line = "";
      for (const word of raw.split(/\s+/)) {
        const test = line ? line + " " + word : word;
        if (g.measureText(test).width > maxW && line) { lines.push(line); line = word; } else line = test;
      }
      lines.push(line);
    }
    const lh = t.size * 1.25, boxH = lines.length * lh, widest = Math.min(maxW, Math.max(...lines.map(l => g.measureText(l).width)));
    const y0 = t.pos === "top" ? H * 0.08 : t.pos === "center" ? (H - boxH) / 2 : H - boxH - H * 0.08;
    g.fillStyle = "rgba(0,0,0,.45)"; g.fillRect(W / 2 - widest / 2 - 12, y0 - 10, widest + 24, boxH + 20);
    g.fillStyle = COLORS[t.color] || "#fff";
    lines.forEach((l, i) => g.fillText(l, W / 2, y0 + i * lh + (lh - t.size) / 2));
    g.restore();
  }

  async function run(job) {
    const project = await B.getProject(job.project);
    const tl = await B.getTimeline(job.project);
    if (!tl.clips.length) throw B.bad("The timeline has no video clips. Add clips first.");
    const [W0, H0] = (job.hd ? HD : SIZES)[project.aspect] || (job.hd ? [1920, 1080] : [1344, 768]), W = even(W0), H = even(H0);
    const info = layout(tl.clips); job.total = info.total;
    const N = Math.ceil(info.total * FPS);
    job.status = "rendering"; job.step = "sound";

    // 1) sound
    const aCodec = await pickAudioCodec();
    const { buffer: mixed, heard } = aCodec ? await mixAudio(info, tl, p => { job.progress = p * 0.1; }) : { buffer: null, heard: 0 };

    // 2) packing + encoders
    const vc = await pickVideoCodec(W, H, job.hd ? 12e6 : 8e6);
    const muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), fastStart: "in-memory",
      video: { codec: vc.muxName, width: W, height: H, frameRate: FPS }, ...(aCodec ? { audio: { codec: aCodec.muxName, numberOfChannels: 2, sampleRate: SR } } : {}) });
    let encErr = null;
    const vEnc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => { encErr = e; } });
    vEnc.configure(vc.cfg);

    // 3) pictures
    job.step = "pictures";
    const videos = [];
    for (const x of info.L) { const a = await B.getAsset(x.c.asset_id); if (!a) throw B.bad("A clip's file is missing from this device."); videos.push(await loadVideo(a)); }
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const g = cv.getContext("2d"), tmp = document.createElement("canvas"); tmp.width = W; tmp.height = H; const tg = tmp.getContext("2d");
    try {
      for (let k = 0; k < N; k++) {
        if (encErr) throw encErr;
        const t = k / FPS;
        g.globalAlpha = 1; g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
        for (const [i, x] of info.L.entries()) {
          if (t < x.start || t >= x.start + x.dur + 1e-6) continue;
          const v = videos[i].v, local = Math.min(t - x.start, x.dur - 1e-3);
          await seek(v, x.c.in + local);
          tg.fillStyle = "#000"; tg.fillRect(0, 0, W, H);
          const s = Math.min(W / v.videoWidth, H / v.videoHeight), dw = v.videoWidth * s, dh = v.videoHeight * s;
          tg.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh);
          let dark = 1;  // fade to black at the start / end of the clip
          if (x.c.fade_in > 0) dark = Math.min(dark, local / x.c.fade_in);
          if (x.c.fade_out > 0) dark = Math.min(dark, (x.dur - local) / x.c.fade_out);
          if (dark < 1) { tg.fillStyle = `rgba(0,0,0,${1 - Math.max(0, dark)})`; tg.fillRect(0, 0, W, H); }
          const prevTr = i ? info.L[i - 1].tr : 0;  // crossfade in over the previous clip
          g.globalAlpha = prevTr > 0 && local < prevTr ? Math.min(1, local / prevTr) : 1;
          g.drawImage(tmp, 0, 0);
        }
        g.globalAlpha = 1;
        for (const tx of tl.texts) if (t >= tx.start && t <= tx.start + tx.dur) drawText(g, W, H, tx);
        const frame = new VideoFrame(cv, { timestamp: Math.round(k * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
        vEnc.encode(frame, { keyFrame: k % (FPS * 2) === 0 }); frame.close();
        while (vEnc.encodeQueueSize > 6) await sleep(4);
        job.progress = 0.1 + 0.8 * (k + 1) / N;
        if (k % 6 === 0) await sleep(0);  // let the page breathe
      }
      await vEnc.flush(); if (encErr) throw encErr;
    } finally { for (const x of videos) URL.revokeObjectURL(x.url); }

    // 4) sound into the file
    if (aCodec && mixed) {
      job.step = "packing";
      const aEnc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: e => { encErr = e; } });
      aEnc.configure(aCodec.cfg);
      const L = mixed.getChannelData(0), R = mixed.numberOfChannels > 1 ? mixed.getChannelData(1) : L, block = 4096;
      for (let pos = 0; pos < mixed.length; pos += block) {
        const n = Math.min(block, mixed.length - pos), data = new Float32Array(n * 2);
        data.set(L.subarray(pos, pos + n), 0); data.set(R.subarray(pos, pos + n), n);
        const ad = new AudioData({ format: "f32-planar", sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(pos / SR * 1e6), data });
        aEnc.encode(ad); ad.close();
        while (aEnc.encodeQueueSize > 12) await sleep(2);
      }
      await aEnc.flush(); if (encErr) throw encErr;
    }
    muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
    const name = (project.name || "movie").replace(/[^\w\- ]+/gu, "").trim().replace(/\s+/g, "_") + "_export.mp4";
    job.asset = await B.addAsset(name, blob, { type: "export", tags: ["export"] });
    job.note = !aCodec ? "This browser has no audio encoder: exported without sound." : heard ? "" : "No sound track was found in the clips.";
    job.progress = 1; job.status = "done";
  }

  window.StudioExport = {
    supported,
    start(projectId, hd) {
      if (!supported()) throw B.bad("This browser can't export video (it needs WebCodecs: use a recent Chrome on Android or desktop, or the PC version).");
      if ([...jobs.values()].some(j => j.status === "queued" || j.status === "rendering")) throw B.bad("Another export is already running.");
      const job = { id: Math.random().toString(36).slice(2, 12), project: projectId, hd: !!hd, status: "queued", progress: 0, started: Date.now() / 1000 };
      jobs.set(job.id, job);
      run(job).catch(e => { job.status = "failed"; job.error = (e && e.message || String(e)).slice(0, 400); });
      return job;
    },
    status(id) { const j = jobs.get(id); if (!j) throw B.bad("Unknown export."); return j; },
  };
})();
