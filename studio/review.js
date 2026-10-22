// Start-frame review: the real generated frame at its exact shape, zoom/fullscreen, previous versions, side-by-side compare, automatic checks
// (aspect ratio, collage / split-screen detection, identity results from the connector) and explicit approve / reject / regenerate.
// Nothing here approves or generates by itself: every action is a button press (paid ones ask for confirmation first).
"use strict";
(() => {
  if (!window.AppShell || !window.AppShell.v2) return;
  const wait = setInterval(() => { if (window.APP && APP.go) { clearInterval(wait); init(); } }, 80);
  function init() {
    const { h, icon, txt, api } = APP;

    // ------------------------------------------------------------------ automatic checks done in the browser, on the picture that is shown
    // Same idea as the connector's validator: a row/column where (almost) the whole picture changes abruptly = panel seam. Equal-split single seams or 2+ seams = collage.
    APP.collageScan = img => {
      const w0 = img.naturalWidth, h0 = img.naturalHeight; if (!w0 || !h0) return null;
      const s = Math.min(1, 800 / Math.max(w0, h0)), W = Math.max(8, Math.round(w0 * s)), H = Math.max(8, Math.round(h0 * s));
      const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, W, H);
      let d; try { d = g.getImageData(0, 0, W, H).data; } catch { return null; }
      const gray = new Float32Array(W * H); for (let i = 0; i < W * H; i++) gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
      const seams = (len, across, at) => {   // len = number of lines to test, across = length of each line, at(i, j) gray value at line i position j
        const mean = new Float32Array(len - 1), coh = new Float32Array(len - 1);
        for (let i = 0; i < len - 1; i++) { let m = 0, k = 0; for (let j = 0; j < across; j++) { const dv = Math.abs(at(i + 1, j) - at(i, j)); m += dv; if (dv > 18) k++; } mean[i] = m / across; coh[i] = k / across; }
        const out = [];
        for (let i = Math.round(0.06 * len); i < Math.round(0.94 * len); i++) {
          const near = [0.25, 1 / 3, 0.5, 2 / 3, 0.75].some(f => Math.abs(i / len - f) <= 0.025), [mt, ct, rt] = near ? [6, 0.4, 3.5] : [14, 0.55, 5];
          const around = []; for (let k = Math.max(0, i - 10); k < Math.min(len - 1, i + 10); k++) if (Math.abs(k - i) > 1) around.push(mean[k]); around.sort((a, b) => a - b);
          const base = around.length ? around[Math.floor(around.length / 2)] : 0;
          if (mean[i] > mt && coh[i] > ct && mean[i] > rt * (base + 1)) { const p = i / len; if (out.length && p - out[out.length - 1] < 0.02) continue; out.push(p); }
        }
        return out;
      };
      let hs = seams(H, W, (i, j) => gray[i * W + j]), vs = seams(W, H, (i, j) => gray[j * W + i]);
      const bands = (len, across, at) => {   // thin DARK separator lines between panels of a dark picture: a line much darker than the rows around it
        const m = new Float32Array(len); for (let i = 0; i < len; i++) { let t = 0; for (let j = 0; j < across; j += 2) t += at(i, j); m[i] = t / Math.ceil(across / 2); }
        const out = [];
        for (let i = Math.round(0.08 * len); i < Math.round(0.92 * len); i++) {
          const dip = Math.min(m[i], m[Math.min(len - 1, i + 1)], m[Math.max(0, i - 1)]), nb = []; for (const k of [-14, -11, -8, 8, 11, 14]) if (m[i + k] != null) nb.push(m[i + k]); nb.sort((a, b) => a - b);
          const med = nb.length ? nb[nb.length >> 1] : 0;
          const near = [0.25, 1 / 3, 0.5, 2 / 3, 0.75].some(f => Math.abs(i / len - f) <= 0.03); if (near ? (dip < 14 && med > 4 && dip < 0.65 * med) : (dip < 14 && med > 9 && dip < 0.4 * med)) { const p = i / len; if (!out.length || p - out[out.length - 1] > 0.03) out.push(p); }
        }
        return out;
      };
      if (H >= W) for (const p of bands(H, W, (i, j) => gray[i * W + j])) if (!hs.some(q => Math.abs(q - p) < 0.025)) hs.push(p);
      if (W > H) for (const p of bands(W, H, (i, j) => gray[j * W + i])) if (!vs.some(q => Math.abs(q - p) < 0.025)) vs.push(p);
      hs.sort((a, b) => a - b); vs.sort((a, b) => a - b);
      if (hs.length + vs.length === 1) { const p = (hs[0] ?? vs[0]); if (![0.25, 1 / 3, 0.5, 2 / 3, 0.75].some(f => Math.abs(p - f) <= 0.04)) { hs = []; vs = []; } }
      let panels = (hs.length + 1) * (vs.length + 1), repeat = null;
      {   // the same picture repeated in equal parts (halves, thirds, quarters): neighbouring parts have almost the same edge structure
        const E = new Float32Array(W * H);
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x, gx = (gray[i - W + 1] + 2 * gray[i + 1] + gray[i + W + 1]) - (gray[i - W - 1] + 2 * gray[i - 1] + gray[i + W - 1]), gy = (gray[i + W - 1] + 2 * gray[i + W] + gray[i + W + 1]) - (gray[i - W - 1] + 2 * gray[i - W] + gray[i - W + 1]); E[i] = Math.hypot(gx, gy); }
        const pool = (x0, y0, x1, y1) => { const out = new Float32Array(48 * 48); for (let j = 0; j < 48; j++) for (let i = 0; i < 48; i++) { const ya = y0 + Math.floor((y1 - y0) * j / 48), yb = Math.max(ya + 1, y0 + Math.floor((y1 - y0) * (j + 1) / 48)), xa = x0 + Math.floor((x1 - x0) * i / 48), xb = Math.max(xa + 1, x0 + Math.floor((x1 - x0) * (i + 1) / 48)); let sum = 0, k = 0; for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) { sum += E[y * W + x]; k++; } out[j * 48 + i] = k ? sum / k : 0; } return out; };
        const stats = a => { let m = 0; for (const v of a) m += v; m /= a.length; let sd = 0; for (const v of a) sd += (v - m) * (v - m); return [m, Math.sqrt(sd / a.length)]; };
        const corr = (a, b) => { const [ma, sa] = stats(a), [mb, sb] = stats(b); let c = 0; for (let i = 0; i < a.length; i++) c += (a[i] - ma) * (b[i] - mb); return c / a.length / (sa * sb || 1); };
        outer: for (const axis of [0, 1]) for (const n of [3, 2, 4]) {
          const segs = []; for (let i = 0; i < n; i++) segs.push(axis === 0 ? pool(0, Math.floor(H * i / n), W, Math.floor(H * (i + 1) / n)) : pool(Math.floor(W * i / n), 0, Math.floor(W * (i + 1) / n), H));
          const st = segs.map(stats); if (st.some(([m, sd]) => m < 6 || sd < 3)) continue;
          const cs = []; for (let i = 0; i < n - 1; i++) cs.push(corr(segs[i], segs[i + 1]));
          if (Math.min(...cs) > 0.9) { repeat = { axis: axis === 0 ? "horizontal" : "vertical", n, corr: Math.min(...cs) }; break outer; }
        }
      }
      if (repeat) panels = Math.max(panels, repeat.n);
      return { horizontal: hs, vertical: vs, panels, repeat };
    };
    const loadImg = url => new Promise(res => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });

    // ------------------------------------------------------------------ the review screen
    APP.openReview = async (sc, project, ctx, startAsset) => {
      const st = sc.settings || {};
      const versions = [];   // oldest first: {label, url, current}
      for (const x of (st.frame_history || [])) if (x.asset !== sc.start_asset) versions.push({ label: "v" + x.v, url: "/media/" + x.asset, id: x.asset });
      for (const x of (st.cversions || [])) if (!versions.some(v => v.label === "v" + x.v) && x.v !== st.kv) versions.push({ label: "v" + x.v, url: x.url, remote: true });
      versions.sort((a, b) => parseInt(a.label.slice(1)) - parseInt(b.label.slice(1)));
      if (sc.start_asset_url) versions.push({ label: "v" + (st.kv || (st.frame_history || []).length || versions.length + 1), url: sc.start_asset_url, id: sc.start_asset, current: true });
      if (!versions.length) { APP.toast("This scene has no start frame to review yet."); return; }
      let sel = Math.max(0, versions.findIndex(v => startAsset ? v.id === startAsset : v.current)), cmp = -1, tf = { s: 1, x: 0, y: 0 };
      const info = () => APP.sceneInfo(sc, project);
      const root = h("div", { class: "rv", role: "dialog", "aria-modal": "true", "aria-label": "Start frame review" });
      const close = () => { root.remove(); document.removeEventListener("keydown", key); document.body.style.overflow = ""; };
      const key = e => { if (e.key === "Escape") close(); else if (e.key === "ArrowLeft") { sel = Math.max(0, sel - 1); paint(); } else if (e.key === "ArrowRight") { sel = Math.min(versions.length - 1, sel + 1); paint(); } else if (e.key === "+") zoom(1.3); else if (e.key === "-") zoom(1 / 1.3); else if (e.key === "0") { tf = { s: 1, x: 0, y: 0 }; apply(); } };
      document.addEventListener("keydown", key); document.body.style.overflow = "hidden"; document.body.append(root);
      let stage, img, handle, imgB, checks, natural = null;
      function apply() { if (img) img.style.transform = `translate(${tf.x}px, ${tf.y}px) scale(${tf.s})`; if (imgB) imgB.style.transform = img.style.transform; }
      function zoom(f, cx = 0, cy = 0) { const ns = Math.min(8, Math.max(1, tf.s * f)); tf.x = (tf.x - cx) * (ns / tf.s) + cx; tf.y = (tf.y - cy) * (ns / tf.s) + cy; tf.s = ns; if (ns === 1) { tf.x = 0; tf.y = 0; } apply(); }
      function gestures(el) {
        const pts = new Map(); let last = 0, d0 = 0, tap = 0;
        el.addEventListener("wheel", e => { e.preventDefault(); const r = el.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2); }, { passive: false });
        el.addEventListener("pointerdown", e => { if (e.target === handle) return; el.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) { const [a, b] = [...pts.values()]; d0 = Math.hypot(a.x - b.x, a.y - b.y); }
          const now = Date.now(); if (pts.size === 1 && now - tap < 280) { tf.s > 1 ? (tf = { s: 1, x: 0, y: 0 }) : (tf.s = 2.5); apply(); } tap = now; });
        el.addEventListener("pointermove", e => { const p = pts.get(e.pointerId); if (!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
          if (pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (d0) zoom(d / d0); d0 = d; } else if (tf.s > 1) { tf.x += dx; tf.y += dy; apply(); } });
        const up = e => { pts.delete(e.pointerId); d0 = 0; }; el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
      }
      async function runChecks() {
        const v = versions[sel], box = checks; if (!box) return; box.replaceChildren(h("div", { class: "ds-skel", style: "height:70px" }));
        const im = await loadImg(v.url); const rows = [];
        const row = (tone, label, text, extra) => h("div", { class: "ck" }, h("span", { class: "ds-pill " + tone }, label), h("div", {}, text, extra ? h("span", {}, extra) : null));
        if (!im) rows.push(row("bad", "Image", "This frame could not be loaded.", "Check your connection and try again. The original is never replaced by a placeholder."));
        else {
          natural = { w: im.naturalWidth, h: im.naturalHeight };
          const want = project.aspect.split(":").map(Number), ratio = want[0] / want[1], got = im.naturalWidth / im.naturalHeight, ok = Math.abs(got - ratio) / ratio < 0.02;
          rows.push(row(ok ? "ok" : "bad", ok ? "Shape" : "Wrong shape", `${im.naturalWidth}×${im.naturalHeight} · project is ${project.aspect}`, ok ? "Exactly the project's aspect ratio." : "This frame is not " + project.aspect + ". It will be fitted without stretching when the video is made."));
          const sc2 = APP.collageScan(im);
          if (sc2) rows.push(sc2.panels > 1 ? row("bad", "Collage?", `Looks like ${sc2.panels} panels / split screen`, (sc2.horizontal.length + sc2.vertical.length ? "Seams found at " + [...sc2.horizontal.map(p => Math.round(p * 100) + "% down"), ...sc2.vertical.map(p => Math.round(p * 100) + "% across")].join(", ") + ". " : "") + (sc2.repeat ? `The same picture seems to be repeated ${sc2.repeat.n} times. ` : "") + "Reject and regenerate.") : row("ok", "One image", "No panel seams or split screen found", "Automatic check on this picture."));
        }
        if (st.cidentity) { for (const [n, c] of Object.entries(st.cidentity.chars || {})) rows.push(row({ match: "ok", uncertain: "warn" }[c.verdict] || "bad", n, c.score != null ? "Face match " + Number(c.score).toFixed(2) : APP.txt(c.verdict, "not found"), ({ match: "Same person as the references.", uncertain: "Uncertain: please look closely." }[c.verdict]) || "Does not clearly match the references.")); }
        else rows.push(row("", "Identity", "Not checked on this device", "Face checks run on the connector (chat) or the PC app. Compare with the character references below."));
        for (const f of (st.cflags || [])) rows.push(row("bad", "Flagged", APP.txt(f), "Detected automatically when the frame was made."));
        if (st.cwarn) rows.push(row("warn", "Note", APP.txt(st.cwarn)));
        if ((st.cattempts || []).length) rows.push(row("", "History", `${st.cattempts.length} generation attempt${st.cattempts.length === 1 ? "" : "s"}`, st.cattempts.map(a => `#${a.n} ${a.method || ""}: ${a.verdict}${(a.reasons || []).length ? " (" + a.reasons[0].slice(0, 60) + ")" : ""}`).join(" · ")));
        box.replaceChildren(...rows);
      }
      function paint() {
        const v = versions[sel], i = info(), n = project && ((ctx.scenes || []).findIndex(x => x.id === sc.id) + 1);
        tf = { s: 1, x: 0, y: 0 };
        const close_ = h("button", { class: "ds-btn icon sm", "aria-label": "Close", onclick: close }, icon("x"));
        const top = h("div", { class: "rv-top" }, close_, h("div", { class: "ds-grow" }, h("div", { class: "ds-h2" }, `Scene ${n || ""} · review`), h("div", { class: "ds-small" }, `${/^scene \d+$/i.test(txt(sc.title).trim()) ? "" : txt(sc.title) + " · "}${project.aspect} · ${v.label}${v.current ? " (current)" : ""}`)),
          h("span", { class: "ds-pill " + i.tone }, i.label), h("button", { class: "ds-btn icon sm", "aria-label": "Zoom in", onclick: () => zoom(1.4) }, icon("zoom")), h("button", { class: "ds-btn icon sm", "aria-label": "Compare versions", title: "Compare with another version", disabled: versions.length < 2, onclick: () => { cmp = cmp >= 0 ? -1 : (sel > 0 ? sel - 1 : 1); paint(); } }, icon("cmp")),
          h("button", { class: "ds-btn icon sm", "aria-label": "Fullscreen", onclick: () => { const el = root; if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen().catch(() => {}); } }, icon("full")));
        stage = h("div", { class: "rv-stage" }); img = h("img", { src: v.url, alt: "Generated start frame", draggable: false, onerror: () => APP.toast("The frame could not be loaded.", "bad") }); imgB = null; handle = null;
        if (cmp >= 0 && versions[cmp]) {
          imgB = h("img", { src: versions[cmp].url, alt: "Previous version", draggable: false }); const wrap = h("div", { class: "rv-cmp" }, imgB, img); stage.append(wrap);
          img.style.clipPath = "inset(0 0 0 50%)"; handle = h("div", { class: "rv-handle", style: "left:50%" }); stage.append(handle);
          const mv = e => { const r = stage.getBoundingClientRect(), p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); handle.style.left = p * 100 + "%"; img.style.clipPath = `inset(0 0 0 ${p * 100}%)`; };
          handle.onpointerdown = e => { handle.setPointerCapture(e.pointerId); handle.onpointermove = mv; }; handle.onpointerup = () => { handle.onpointermove = null; };
          stage.append(h("div", { class: "ds-pill", style: "position:absolute;left:10px;top:10px" }, versions[cmp].label), h("div", { class: "ds-pill run", style: "position:absolute;right:10px;top:10px" }, v.label));
        } else stage.append(img);
        gestures(stage);
        const vers = h("div", { class: "rv-vers" }, versions.map((x, k) => h("div", { class: "rv-ver" + (k === sel ? " on" : ""), onclick: () => { if (cmp >= 0 && k === sel) return; if (cmp >= 0) { cmp = sel; } sel = k; paint(); }, role: "button", tabindex: 0, title: x.label }, h("img", { src: x.url, alt: x.label, loading: "lazy" }), h("b", {}, x.label))));
        checks = h("div", { class: "ds-stack", style: "gap:8px" });
        const prompt = h("details", { class: "ws-sec" }, h("summary", {}, "Scene description"), h("div", { class: "in" }, h("div", { class: "ds-sub" }, txt(sc.action, "No description"))));
        const refs = (ctx.chars || []).length ? null : null;
        const side = h("div", { class: "rv-side" }, h("div", { class: "ds-h2" }, "Automatic checks"), checks, prompt, h("div", { class: "ds-small" }, v.current ? "This is the version the video would start from." : "An older version. Restoring it makes it the current frame."), !v.current && v.id ? h("button", { class: "ds-btn sm", onclick: async () => { if (!(await APP.confirm("Restore " + v.label + "?", "It becomes the start frame again (the current one stays in the versions).", "Restore"))) return; try { const hist = ((sc.settings || {}).frame_history || []).slice(); const cur = sc.start_asset; if (cur && !hist.some(x => x.asset === cur)) hist.push({ v: hist.length + 1, asset: cur, at: Date.now() / 1000 }); await APP.saveScene(sc, { start_asset: v.id, settings: { ...(sc.settings || {}), frame_history: hist, review: "" } }); close(); ctx.refresh && ctx.refresh(); APP.toast("Restored " + v.label + ".", "ok"); } catch (e) { APP.fail(e); } } }, "Restore this version") : null);
        const a = ctx.actions || APP.wsActions, closeThen = fn => async () => { try { await fn(sc); } finally { close(); } };   // the action (and its confirmation) comes first, so nothing is hidden behind this screen
        const acts = h("div", { class: "rv-actions" }, i.busy ? h("button", { class: "ds-btn", disabled: true }, "Generating…") : [
          h("button", { class: "ds-btn bad", onclick: closeThen(a.reject) }, "Reject"), h("button", { class: "ds-btn", onclick: closeThen(a.frame) }, icon("refresh"), "Regenerate"),
          i.approved && !i.hasVideo ? h("button", { class: "ds-btn pri", onclick: closeThen(a.video) }, icon("play"), "Generate video") : h("button", { class: "ds-btn ok", disabled: !v.current, onclick: closeThen(a.approve) }, icon("check"), i.approved ? "Approved" : "Approve")]);
        root.replaceChildren(top, h("div", { class: "rv-main" }, stage, side), vers, acts);
        runChecks();
      }
      paint();
    };

    // ------------------------------------------------------------------ approvals for frames made through the chat connector (needs the actions link)
    APP.chatAct = async (op, sc, project) => {
      const act = APP.LS.get("connector_act", ""), st = sc.settings || {};
      const needLink = () => APP.sheet((box, close) => box.append(h("h2", { class: "ds-h2", style: "font-size:17px;margin-bottom:8px" }, "Approve in the chat, or enable actions"), h("p", { class: "ds-sub" }, "This frame was made by the chat connector, so it is approved there. To approve, reject and regenerate from this app, ask your chat: “open in studio app with actions”, then open the link on this device."), h("button", { class: "ds-btn pri", style: "width:100%", onclick: close }, "OK")));
      if (!act) return needLink();
      const costly = op === "regenerate" || op === "approve";
      const label = { approve: "Approve this frame?", reject: "Reject this frame?", regenerate: "Make a new start frame?" }[op];
      const body = { approve: `This tells the connector to make the video for scene ${st.cn}. It uses the GPU (about ${APP.money(APP.estimate(sc, "clip"))}).`, reject: "The frame is rejected and a new one is generated (about " + APP.money(APP.estimate(sc, "frame")) + ").", regenerate: `A new start frame uses the GPU (about ${APP.money(APP.estimate(sc, "frame"))}). The old one is kept as a version.` }[op];
      if (!(await APP.confirm(label, body, { approve: "Approve + generate video", reject: "Reject", regenerate: "Regenerate" }[op], op === "reject"))) return;
      await APP.once("act:" + sc.id, async () => {
        try { const r = await fetch(`${act}/${op}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ movie_id: st.cm, scene_number: st.cn }) }); const j = await r.json().catch(() => ({})); if (!r.ok || j.ok === false) throw new Error(j.error || "The connector answered " + r.status); APP.toast(APP.txt(j.message, "Done."), "ok"); }
        catch (e) { APP.fail(e, "Connector"); }
        if (window.APP.syncNow) await window.APP.syncNow(); APP.changed("scenes");
      });
    };
  }
})();
