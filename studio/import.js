// ChatGPT Storyboard Import (phone app): put your own start frames into a project WITHOUT using the GPU.
//   IMP.sheet(project, scene, {refresh})     one picture for one scene: pick / drop, preview, checks, replace confirmation
//   IMP.bulk(project, scenes, {refresh})     many pictures at once, matched to scenes by file name or order, each one checked and reported
//   IMP.versions(project, scene, {refresh})  every frame version of a scene; make an old one current again (no GPU)
//   IMP.card(project, scenes, ctx)           the workflow card: Characters > Storyboard > Import > Review > Approve > Videos > Assemble, one row per scene
//   IMP.gpuFramesBlocked(project)            true when the project is "ChatGPT Storyboard Import": frames are never made on the GPU there
// Two kinds of scenes: LOCAL scenes (stored in this device's IndexedDB: the picture becomes an asset) and CHAT scenes (made by the chat connector: the picture is sent to the connector's
// import_frame route with the actions link, the connector keeps the original + every version). Nothing here ever submits a GPU job.
"use strict";
(() => {
  if (!window.AppShell || !window.AppShell.v2) return;
  const wait = setInterval(() => { if (window.APP && APP.sheet && APP.sceneInfo && APP.chars && APP.lazyThumb) { clearInterval(wait); init(); } }, 80);
  function init() {
    const { h, icon, txt, api } = APP;
    const LIM = { MAX: 15e6, MIN: 384, WARN: 768, REJ: 0.25, FIT: 0.04 };          // the same limits the connector enforces (storyboard_import.py)
    const SIZE = { "9:16": [768, 1344], "16:9": [1344, 768], "1:1": [1024, 1024] };
    const SOURCES = [["ai", "AI Studio GPU", "AI Studio makes every start frame on the GPU (costs credit)."],
      ["chatgpt", "ChatGPT Storyboard Import", "You import the pictures ChatGPT made. Start frames never use the GPU."],
      ["hybrid", "Hybrid", "Import a picture for some scenes; let the GPU make the others when you press the button."]];
    const SRC_LABEL = { chatgpt: "ChatGPT import", upload: "Uploaded", restored: "Restored", ai: "AI Studio GPU", ai_studio: "AI Studio GPU", "": "" };
    const mode = p => { const d = (p && p.data) || {}; return d.image_source || d.connector_import_mode || "ai"; };
    const stOf = sc => sc.settings || {};
    const isChat = sc => !!stOf(sc).cm;
    const actLink = () => APP.LS.get("connector_act", "");
    const srcOf = sc => stOf(sc).frame_source || stOf(sc).csource || (sc.start_asset ? "ai" : "");
    const isImported = sc => ["chatgpt", "upload", "restored"].includes(srcOf(sc));
    const names = (sc, chars) => (sc.characters || []).map(id => ((chars || []).find(c => c.id === id) || {}).name).filter(Boolean);
    const kb = n => n > 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";

    // ------------------------------------------------------------------ styles
    const css = `
.im-drop{border:2px dashed var(--line,#555);border-radius:14px;padding:18px 12px;text-align:center;cursor:pointer;min-height:96px;display:flex;flex-direction:column;gap:8px;align-items:center;justify-content:center}
.im-drop.over{border-color:var(--acc,#7c6cf0);background:rgba(124,108,240,.12)}
.im-prev{display:flex;gap:12px;align-items:flex-start}.im-prev img{width:96px;max-height:170px;object-fit:contain;border-radius:10px;background:#0006;flex:none}
.im-row{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-top:1px solid rgba(127,127,127,.2)}.im-row img{width:56px;height:72px;object-fit:cover;border-radius:8px;flex:none;background:#0006}
.im-ok{color:#3fbf7f}.im-warn{color:#e0a84a}.im-bad{color:#e5594b}.im-mut{opacity:.72;font-size:13px}.im-grow{flex:1;min-width:0}
.im-steps{display:flex;gap:4px;flex-wrap:wrap;margin:6px 0}.im-steps span{font-size:12px;padding:4px 8px;border-radius:999px;border:1px solid rgba(127,127,127,.35)}.im-steps span.on{background:var(--acc,#7c6cf0);color:#fff;border-color:transparent}.im-steps span.now{border-color:var(--acc,#7c6cf0)}
.im-sc{padding:10px 0;border-top:1px solid rgba(127,127,127,.2)}.im-sc .ds-row{align-items:center}
.im-sc img{width:52px;height:72px;object-fit:cover;border-radius:8px;flex:none;background:#0006}.im-sc .ph{width:52px;height:72px;border-radius:8px;border:1px dashed rgba(127,127,127,.5);display:flex;align-items:center;justify-content:center;flex:none;font-size:11px;opacity:.7;text-align:center}
.im-btns{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.im-btns button{min-height:44px}
.im-hid{border:1px solid #e0a84a;border-radius:14px;padding:12px;margin:0 0 12px;background:rgba(224,168,74,.1)}.im-sel{font:inherit;color:inherit;background:transparent;border:1px solid rgba(127,127,127,.4);border-radius:8px;padding:8px;min-height:44px;max-width:100%}`;
    let styled = false; const style = () => { if (!styled) { styled = true; document.head.append(h("style", {}, css)); } };

    // ------------------------------------------------------------------ checks (before anything is sent)
    const sniff = b => (b.length > 11 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) ? "png" : (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ? "jpg"
      : (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) ? "webp" : null;
    async function inspect(file, project) {
      const r = { file, name: file.name || "picture", bytes: file.size, errors: [], warnings: [], w: 0, h: 0, ext: null, url: "", ok: false };
      if (!file.size) { r.errors.push("The file is empty."); return r; }
      if (file.size > LIM.MAX) r.errors.push(`The file is ${(file.size / 1e6).toFixed(1)} MB; the limit is 15 MB.`);
      r.ext = sniff(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
      if (!r.ext) { r.errors.push("This is not a PNG, JPG or WebP picture."); return r; }
      r.url = URL.createObjectURL(file);
      let im; try { im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("decode")); i.src = r.url; }); }
      catch { r.errors.push("The picture is damaged or cannot be opened."); return r; }
      r.w = im.naturalWidth; r.h = im.naturalHeight;
      const [W, H] = SIZE[(project || {}).aspect] || SIZE["9:16"], short = Math.min(r.w, r.h), diff = Math.abs(r.w / r.h - W / H) / (W / H);
      if (short < LIM.MIN) r.errors.push(`Only ${r.w}×${r.h}. At least ${LIM.MIN} px on the short side is needed (${W}×${H} is ideal).`);
      else if (short < LIM.WARN) r.warnings.push(`Small (${r.w}×${r.h}). A sharper ${W}×${H} frame gives a sharper video.`);
      if (diff > LIM.REJ) r.errors.push(`Wrong shape: ${r.w}×${r.h} is ${r.w > r.h ? "landscape" : "portrait"}, but this project is ${project.aspect}.`);
      else if (diff > LIM.FIT) r.warnings.push(`${r.w}×${r.h} is not exactly ${project.aspect}: it is fitted without stretching (cropped or extended).`);
      if (APP.collageScan) { try { const c = APP.collageScan(im); if (c && c.panels > 1) r.warnings.push(`Looks like ${c.panels} panels / a split screen. One single picture per scene works best.`); } catch {} }
      r.ok = !r.errors.length; return r;
    }
    const sha = async f => { try { const d = await crypto.subtle.digest("SHA-256", await f.arrayBuffer()); return [...new Uint8Array(d)].slice(0, 12).map(x => x.toString(16).padStart(2, "0")).join(""); } catch { return String(f.size) + "-" + (f.lastModified || 0); } };
    const dataUrl = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
    const verdict = r => r.errors.length ? ["bad", r.errors[0]] : r.warnings.length ? ["warn", r.warnings[0]] : ["ok", `${r.w}×${r.h} · ${kb(r.bytes)} · ${r.ext.toUpperCase()}`];

    // ------------------------------------------------------------------ the import itself (one picture, one scene): no GPU, ever
    async function importOne(project, sc, ins, o = {}) {
      const source = o.source || "chatgpt", replace = !!o.replace, notes = String(o.notes || "").slice(0, 300);
      if (!ins.ok) return { status: "rejected", message: ins.errors[0] || "This picture cannot be used." };
      if (isChat(sc)) {
        const act = actLink();
        if (!act) return { status: "needs_link", message: "Importing into a chat movie needs the actions link. In your chat ask: “open in studio app with actions allowed”, then open that link on this device." };
        const st = stOf(sc), key = "imp-" + st.cm + "-" + st.cn + "-" + (await sha(ins.file));
        const q = new URLSearchParams({ movie_id: st.cm, scene: String(st.cn), source, key, replace: replace ? "1" : "0", notes });
        let r, j;
        try { r = await fetch(`${act}/import_frame?${q}`, { method: "POST", headers: { "Content-Type": ins.file.type || "application/octet-stream" }, body: ins.file, cache: "no-store", credentials: "omit" }); j = await r.json().catch(() => ({})); }
        catch (e) { return { status: "failed", message: "Could not reach the connector. Nothing was changed. " + (e && e.message || "") }; }
        if (r.status === 413) return { status: "rejected", message: "The picture is too big for the connector (15 MB limit)." };
        const res = { status: j.status || (r.ok && j.ok !== false ? "imported" : "failed"), message: txt(j.message || j.error, r.ok ? "Imported." : "The connector answered " + r.status), version: j.version, replayed: !!j.replayed };
        if (res.status === "imported" || res.status === "unchanged") { if (APP.live && APP.live.refresh) APP.live.refresh(); }
        return res;
      }
      const buf = await dataUrl(ins.file);
      const a = await api("assets", { filename: ins.name, data: buf, type: "image", tags: ["imported", source] });
      if (a.id === sc.start_asset) return { status: "unchanged", message: "This is the same picture the scene already has. Nothing changed." };
      if (sc.start_asset && !replace) return { status: "blocked", message: "This scene already has a start frame. Confirm the replacement to import." };
      const st = { ...stOf(sc) }, hist = (st.frame_history || []).slice();
      if (sc.start_asset && !hist.some(x => x.asset === sc.start_asset)) hist.push({ v: hist.length + 1, asset: sc.start_asset, at: Date.now() / 1000, source: st.frame_source || "ai" });
      const v = (hist.reduce((m, x) => Math.max(m, x.v || 0), 0)) + 1;
      hist.push({ v, asset: a.id, at: Date.now() / 1000, source, imported: true });
      Object.assign(st, { frame_history: hist.slice(-30), frame_source: source, frame_meta: { source, width: ins.w, height: ins.h, bytes: ins.bytes, original_name: ins.name, notes, warnings: ins.warnings, at: Date.now() / 1000 }, review: "pending", cflags: [], cidentity: null, cwarn: "" });
      if (sc.video_asset) st.clip_stale = true;
      await APP.saveScene(sc, { start_asset: a.id, status: "keyframe_ready", error: "", settings: st });
      return { status: "imported", version: v, message: `Scene ${o.number || ""} start frame imported (version ${v}). It waits for your approval. No GPU was used.${sc.video_asset ? " The existing video is kept but marked outdated." : ""}` };
    }
    async function restoreOne(project, sc, ver) {
      if (isChat(sc)) {
        const act = actLink(); if (!act) return { status: "needs_link", message: "Restoring a chat frame needs the actions link (ask your chat to open the studio app with actions allowed)." };
        try { const r = await fetch(`${act}/restore_frame`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ movie_id: stOf(sc).cm, scene_number: stOf(sc).cn, version: ver.v }), cache: "no-store", credentials: "omit" }); const j = await r.json().catch(() => ({}));
          if (APP.live && APP.live.refresh) APP.live.refresh(); return { status: j.status || (r.ok ? "imported" : "failed"), message: txt(j.message || j.error, "Done.") };
        } catch (e) { return { status: "failed", message: "Could not reach the connector. Nothing was changed." }; }
      }
      const st = { ...stOf(sc) }, hist = (st.frame_history || []).slice();
      if (ver.asset === sc.start_asset) return { status: "unchanged", message: "That is already the current frame." };
      const v = hist.reduce((m, x) => Math.max(m, x.v || 0), 0) + 1;
      hist.push({ v, asset: ver.asset, at: Date.now() / 1000, source: "restored", restored_from: ver.v });
      Object.assign(st, { frame_history: hist.slice(-30), frame_source: "restored", review: "pending", cflags: [], cidentity: null });
      if (sc.video_asset) st.clip_stale = true;
      await APP.saveScene(sc, { start_asset: ver.asset, status: "keyframe_ready", settings: st });
      return { status: "imported", message: `Version ${ver.v} is the current frame again (as version ${v}). It waits for your approval. No GPU was used.` };
    }
    const report = (res, n) => APP.toast(txt(res.message, "Done."), res.status === "imported" ? "ok" : res.status === "unchanged" ? "" : "bad", res.status === "imported" ? 4200 : 7000);

    // ------------------------------------------------------------------ pick / drop helper
    function picker(onFiles, multiple) {
      style();
      const inp = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp", style: "display:none" }); if (multiple) inp.multiple = true;
      const zone = h("div", { class: "im-drop", role: "button", tabindex: "0", "aria-label": multiple ? "Choose pictures" : "Choose a picture", onclick: () => inp.click(), onkeydown: e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inp.click(); } } },
        icon("img"), h("b", {}, multiple ? "Choose pictures" : "Choose a picture"), h("span", { class: "im-mut" }, "PNG, JPG or WebP · from your photos, files or drag and drop"));
      inp.onchange = () => { const fs = [...inp.files]; inp.value = ""; if (fs.length) onFiles(fs); };
      zone.ondragover = e => { e.preventDefault(); zone.classList.add("over"); }; zone.ondragleave = () => zone.classList.remove("over");
      zone.ondrop = e => { e.preventDefault(); zone.classList.remove("over"); const fs = [...(e.dataTransfer && e.dataTransfer.files || [])].filter(f => /^image\//.test(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name)); if (fs.length) onFiles(multiple ? fs : fs.slice(0, 1)); else APP.toast("Those are not pictures."); };
      return h("div", {}, zone, inp);
    }

    // ------------------------------------------------------------------ single picture
    function sheet(project, sc, o = {}) {
      style();
      const st = stOf(sc), num = isChat(sc) ? st.cn : (o.number || ((o.scenes || []).findIndex(x => x.id === sc.id) + 1) || "");
      APP.sheet((box, close) => {
        let ins = null, source = "chatgpt", replace = false;
        const prev = h("div"), notes = h("input", { class: "ds-input", placeholder: "Notes (optional)", maxlength: 300 }), go = h("button", { class: "ds-btn pri", style: "flex:1", disabled: true }, "Import frame");
        const srcSeg = h("div", { class: "ds-seg" }, [["chatgpt", "From ChatGPT"], ["upload", "My own picture"]].map(([k, l]) => h("button", { type: "button", class: k === source ? "on" : "", onclick: e => { source = k; [...srcSeg.children].forEach(b => b.classList.remove("on")); e.currentTarget.classList.add("on"); } }, l)));
        const hasFrame = !!sc.start_asset_url, rep = h("input", { type: "checkbox", id: "im-rep", onchange: () => { replace = rep.checked; upd(); } });
        const repRow = hasFrame ? h("label", { class: "ds-row", style: "gap:8px;align-items:flex-start" }, rep, h("span", {}, "Replace the current frame. It stays in Versions and can be restored."
          + (sc.video_asset_url || st.cv ? " The existing video is kept but marked outdated." : ""))) : null;
        const upd = () => { go.disabled = !(ins && ins.ok && (!hasFrame || replace)) || (isChat(sc) && !actLink()); };
        const show = async f => {
          prev.replaceChildren(h("div", { class: "ds-small" }, "Checking the picture…")); ins = await inspect(f, project);
          const [tone, line] = verdict(ins);
          prev.replaceChildren(h("div", { class: "im-prev" }, ins.url ? h("img", { src: ins.url, alt: "Chosen picture" }) : null, h("div", { class: "im-grow" },
            h("b", {}, ins.name), h("div", { class: "im-" + tone }, (tone === "ok" ? "✓ " : tone === "warn" ? "⚠ " : "✕ ") + line),
            ...ins.errors.slice(1).map(e => h("div", { class: "im-bad" }, "✕ " + e)), ...(tone === "ok" ? [] : ins.warnings.slice(tone === "warn" ? 1 : 0).map(w => h("div", { class: "im-warn" }, "⚠ " + w))),
            isChat(sc) ? h("div", { class: "im-mut" }, "The connector also checks the faces against your saved characters.") : h("div", { class: "im-mut" }, "Face matching is not available on this device: compare with the character pictures in Review."))));
          upd();
        };
        go.onclick = () => APP.once("imp:" + sc.id, async () => {
          if (!ins || !ins.ok) return; go.disabled = true;
          try {
            if (hasFrame && !(await APP.confirm("Replace the current start frame?", "The old frame is kept in Versions and can be restored. The new one has to be approved again." + (sc.video_asset_url ? "\nThe existing video is kept but marked outdated." : ""), "Replace"))) { upd(); return; }
            const res = await importOne(project, sc, ins, { source, replace, notes: notes.value, number: num });
            report(res, num); if (res.status === "imported" || res.status === "unchanged") { close(); o.refresh && o.refresh(); } else upd();
          } catch (e) { APP.fail(e, "Import"); upd(); }
        });
        box.append(h("h2", { class: "ds-h2", style: "font-size:18px;margin-bottom:4px" }, `Import start frame · Scene ${num}`),
          h("p", { class: "ds-sub", style: "margin:0 0 10px" }, txt(sc.action, "").slice(0, 160)),
          hasFrame ? h("div", { class: "im-prev", style: "margin-bottom:10px" }, h("img", { src: sc.start_asset_url, alt: "Current frame" }), h("div", {}, h("b", {}, "Current frame"), h("div", { class: "im-mut" }, SRC_LABEL[srcOf(sc)] || "AI Studio GPU"))) : null,
          isChat(sc) && !actLink() ? h("div", { class: "im-warn", style: "margin-bottom:8px" }, "This is a chat movie: to import from here, ask your chat to open the studio app with actions allowed, then open that link on this device.") : null,
          picker(fs => show(fs[0]), false), prev, h("div", { class: "ds-field", style: "margin-top:10px" }, h("label", {}, "Where is it from?"), srcSeg), h("div", { class: "ds-field" }, notes), repRow,
          h("p", { class: "ds-small", style: "margin:10px 0" }, "Importing never uses the GPU and costs $0.00. The original picture is kept untouched."),
          h("div", { class: "ds-row" }, h("button", { class: "ds-btn ghost", style: "flex:1", onclick: close }, "Cancel"), go));
      });
    }

    // ------------------------------------------------------------------ several pictures
    const guessScene = (name, n) => { const s = String(name || "").replace(/\.[a-z0-9]+$/i, ""); const m = s.match(/(?:scene|shot|frame|sc|s)[\s_.#-]*0*(\d{1,3})/i) || s.match(/(?:^|[^0-9])0*(\d{1,3})(?:[^0-9]|$)/); const k = m ? parseInt(m[1], 10) : 0; return k >= 1 && k <= n ? k : 0; };
    const natural = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true });
    function bulk(project, scenes, o = {}) {
      style();
      if (!scenes.length) return APP.toast("Add the scenes first.");
      APP.sheet((box, close) => {
        let rows = [], replace = false, busy = false, source = "chatgpt";
        const list = h("div"), sum = h("div", { class: "ds-small", style: "margin:6px 0" }), go = h("button", { class: "ds-btn pri", style: "flex:1", disabled: true }, "Import");
        const target = r => scenes[r.scene - 1];
        const assign = () => {   // names first (scene-3, s03, 03_...), then the rest in file order into the free scenes
          const taken = new Set(); rows.forEach(r => { if (!r.manual) r.scene = 0; });
          rows.forEach(r => { if (!r.ins.ok) return; const k = guessScene(r.ins.name, scenes.length); if (k && !taken.has(k) && !r.manual) { r.scene = k; taken.add(k); } else if (r.manual && r.scene) taken.add(r.scene); });
          rows.filter(r => r.ins.ok && !r.scene && !r.manual).sort((a, b) => natural(a.ins, b.ins)).forEach(r => { for (let k = 1; k <= scenes.length; k++) { const s = scenes[k - 1]; if (!taken.has(k) && !s.start_asset_url) { r.scene = k; taken.add(k); break; } } });
        };
        const state = () => {
          const dup = {}; rows.forEach(r => { if (r.scene) dup[r.scene] = (dup[r.scene] || 0) + 1; });
          rows.forEach(r => { r.problem = !r.ins.ok ? r.ins.errors[0] : !r.scene ? "Choose a scene or remove this picture." : dup[r.scene] > 1 ? "Two pictures for the same scene." : (target(r).start_asset_url && !replace && !r.done) ? "Scene already has a frame: tick “Replace existing frames”." : ""; });
          const ready = rows.filter(r => !r.problem && !r.done);
          sum.textContent = `${rows.length} picture${rows.length === 1 ? "" : "s"} · ${ready.length} ready · ${rows.filter(r => r.done).length} imported · ${rows.filter(r => r.problem).length} need attention. No GPU, $0.00.`;
          go.textContent = ready.length ? `Import ${ready.length} picture${ready.length === 1 ? "" : "s"}` : "Nothing to import"; go.disabled = busy || !ready.length || (scenes.some(isChat) && !actLink());
        };
        const draw = () => {
          state();
          list.replaceChildren(...rows.map((r, idx) => {
            const [tone, line] = verdict(r.ins), sel = h("select", { class: "im-sel", "aria-label": "Scene for " + r.ins.name, disabled: busy || r.done, onchange: () => { r.scene = parseInt(sel.value, 10) || 0; r.manual = true; draw(); } },
              h("option", { value: "0" }, "— choose a scene —"), scenes.map((s, k) => h("option", { value: String(k + 1), selected: r.scene === k + 1 }, `Scene ${k + 1}${s.start_asset_url ? " · has a frame" : ""}`)));
            return h("div", { class: "im-row" }, r.ins.url ? h("img", { src: r.ins.url, alt: "" }) : h("div", { class: "ph" }, "✕"), h("div", { class: "im-grow" }, h("div", { style: "overflow-wrap:anywhere" }, h("b", {}, r.ins.name)),
              h("div", { class: "im-" + (r.done ? "ok" : r.failed ? "bad" : tone) }, r.done ? "✓ " + txt(r.msg, "Imported") : r.failed ? "✕ " + txt(r.msg, "Failed") : r.working ? "Importing…" : (tone === "ok" ? "✓ " : tone === "warn" ? "⚠ " : "✕ ") + line),
              r.problem && !r.done && r.ins.ok ? h("div", { class: "im-warn" }, r.problem) : null, h("div", { class: "ds-row ds-wrap", style: "margin-top:6px" }, sel,
                h("button", { class: "ds-btn ghost sm", disabled: busy || r.done, "aria-label": "Remove " + r.ins.name, onclick: () => { rows.splice(idx, 1); assign(); draw(); } }, "Remove"))));
          }));
        };
        const add = async fs => {
          const seen = new Set(rows.map(r => r.ins.name + r.ins.bytes));
          for (const f of fs.slice(0, 40)) { if (seen.has(f.name + f.size)) continue; rows.push({ ins: await inspect(f, project), scene: 0, manual: false }); }
          assign(); draw();
        };
        go.onclick = async () => {
          if (busy) return; const todo = rows.filter(r => !r.problem && !r.done);
          if (!todo.length) return;
          const repl = todo.filter(r => target(r).start_asset_url).length;
          if (repl && !(await APP.confirm(`Replace ${repl} existing frame${repl === 1 ? "" : "s"}?`, "The old frames stay in Versions and can be restored. Replaced frames have to be approved again.", "Replace"))) return;
          busy = true; rows.forEach(r => { r.failed = false; }); draw();
          let okN = 0, failN = 0;
          for (const r of todo) {
            r.working = true; draw();
            try { const res = await importOne(project, target(r), r.ins, { source, replace: !!target(r).start_asset_url, number: r.scene }); r.msg = res.message; if (res.status === "imported" || res.status === "unchanged") { r.done = true; okN++; } else { r.failed = true; failN++; } }
            catch (e) { r.failed = true; r.msg = String(e && e.message || e); failN++; }
            r.working = false; draw();
          }
          busy = false; draw(); APP.toast(`${okN} imported${failN ? `, ${failN} failed: fix them and press the button again to retry only those` : ""}.`, failN ? "bad" : "ok", 6500);
          if (o.refresh) o.refresh();
        };
        const rep = h("input", { type: "checkbox", onchange: () => { replace = rep.checked; draw(); } }), srcSeg = h("div", { class: "ds-seg" }, [["chatgpt", "From ChatGPT"], ["upload", "My own pictures"]].map(([k, l]) => h("button", { type: "button", class: k === source ? "on" : "", onclick: e => { source = k; [...srcSeg.children].forEach(b => b.classList.remove("on")); e.currentTarget.classList.add("on"); } }, l)));
        box.append(h("h2", { class: "ds-h2", style: "font-size:18px;margin-bottom:4px" }, "Import frames"),
          h("p", { class: "ds-sub", style: "margin:0 0 10px" }, "Pick all the pictures at once. They are matched to scenes by their file name (scene-3, s03, 03…) or in order; you can change any match."),
          scenes.some(isChat) && !actLink() ? h("div", { class: "im-warn", style: "margin-bottom:8px" }, "Chat movie: ask your chat to open the studio app with actions allowed, then open that link on this device. Without it nothing can be sent.") : null,
          picker(add, true), h("div", { class: "ds-field", style: "margin-top:10px" }, srcSeg), h("label", { class: "ds-row", style: "gap:8px;margin:6px 0" }, rep, h("span", {}, "Replace existing frames (old ones stay in Versions)")), sum, list,
          h("div", { class: "ds-row", style: "margin-top:10px" }, h("button", { class: "ds-btn ghost", style: "flex:1", onclick: close }, "Close"), go));
        draw();
      });
    }

    // ------------------------------------------------------------------ versions + rollback
    function versions(project, sc, o = {}) {
      style(); const st = stOf(sc), list = [];
      if (isChat(sc)) { for (const x of (st.cversions || [])) list.push({ v: x.v, url: x.url, current: x.v === st.kv, label: "Version " + x.v }); if (!list.some(x => x.current) && sc.start_asset_url) list.push({ v: st.kv || "now", url: sc.start_asset_url, current: true, label: st.kv ? "Version " + st.kv : "This frame" }); }
      else { for (const x of (st.frame_history || [])) list.push({ v: x.v, asset: x.asset, url: "/media/" + x.asset, current: x.asset === sc.start_asset, label: "Version " + x.v, source: x.source, at: x.at }); if (!list.length && sc.start_asset_url) list.push({ v: 1, asset: sc.start_asset, url: sc.start_asset_url, current: true, label: "Current" }); }
      list.sort((a, b) => (b.v || 0) - (a.v || 0));
      APP.sheet((box, close) => {
        box.append(h("h2", { class: "ds-h2", style: "font-size:18px;margin-bottom:4px" }, `Frame versions · Scene ${isChat(sc) ? st.cn : (o.number || "")}`),
          h("p", { class: "ds-sub", style: "margin:0 0 8px" }, "Nothing is ever deleted. Making an old version current creates a new version and it has to be approved again. No GPU is used."),
          list.length ? list.map(x => h("div", { class: "im-row" }, h("img", { src: x.url, alt: "", loading: "lazy" }), h("div", { class: "im-grow" }, h("b", {}, x.label + (x.current ? " · current" : "")),
            h("div", { class: "im-mut" }, [SRC_LABEL[x.source] || (x.source ? x.source : ""), x.at ? new Date(x.at * 1000).toLocaleString() : ""].filter(Boolean).join(" · ")),
            x.current ? null : h("button", { class: "ds-btn sm", style: "margin-top:6px;min-height:44px", onclick: async () => {
              if (!(await APP.confirm("Make this version current?", "It becomes the start frame (as a new version) and waits for your approval." + (sc.video_asset_url ? "\nThe existing video is kept but marked outdated." : ""), "Make current"))) return;
              try { const res = await restoreOne(project, sc, x); report(res, isChat(sc) ? st.cn : (o.number || "")); if (res.status === "imported" || res.status === "unchanged") { close(); o.refresh && o.refresh(); } } catch (e) { APP.fail(e, "Restore"); } } }, "Make current")))) : h("div", { class: "ds-empty" }, "No frame yet."),
          h("div", { class: "ds-row", style: "margin-top:10px" }, h("button", { class: "ds-btn ghost", style: "flex:1", onclick: close }, "Close")));
      });
    }

    // ------------------------------------------------------------------ the workflow card
    function steps(p, scenes, infos) {
      const n = scenes.length, frames = infos.filter(i => i.hasFrame).length, appr = infos.filter(i => i.hasFrame && i.approved).length, rev = infos.filter(i => i.hasFrame && i.key !== "review").length, vids = infos.filter(i => i.hasVideo).length;
      const S = [["Characters", (p.characters || []).length > 0 || scenes.some(isChat), ""], ["Storyboard", n > 0, n ? n + " scenes" : ""], ["Import frames", n > 0 && frames === n, `${frames}/${n}`], ["Review", n > 0 && frames === n && rev === n, `${rev}/${n}`],
        ["Approve", n > 0 && appr === n, `${appr}/${n}`], ["Generate videos", n > 0 && vids === n, `${vids}/${n}`], ["Assemble", !!((p.data || {}).connector_final), ""]];
      return S;
    }
    function card(p, scenes, ctx = {}) {
      if (!p || !scenes) return null;
      const md = mode(p);
      style();
      if (md === "ai" && !scenes.some(isImported) && !scenes.some(s => stOf(s).cstate === "frame_awaiting_import") && !isChat(scenes[0] || {})) {   // a normal AI project: just a doorway to the import
        return h("div", { class: "ds-row ds-wrap", style: "margin:0 0 10px;gap:8px" }, h("button", { class: "ds-btn sm ghost", onclick: () => bulk(p, scenes, { refresh: ctx.refresh }) }, icon("img"), "Import frames from ChatGPT…"),
          h("span", { class: "ds-small" }, "No GPU, $0.00"));
      }
      const infos = scenes.map(s => APP.sceneInfo(s, p)), S = steps(p, scenes, infos), cur = S.findIndex(x => !x[1]);
      const chars = ctx.chars || [], left = scenes.reduce((a, s, i) => a + (infos[i].hasVideo ? 0 : APP.estimate(s, "clip")), 0) + (md === "ai" ? 0 : 0);
      const act = ctx.actions || {};
      const rows = scenes.map((s, i) => {
        const info = infos[i], num = isChat(s) ? stOf(s).cn : i + 1, src = srcOf(s), nm = names(s, chars), clipOld = !!stOf(s).clip_stale;
        const thumb = info.hasFrame ? (APP.lazyThumb ? APP.lazyThumb("a" + s.start_asset, s.start_asset_url, `Scene ${num}`) : h("img", { src: s.start_asset_url, alt: "" })) : h("div", { class: "ph" }, md === "ai" ? "No frame" : "Waiting");
        const frameCost = isImported(s) ? "$0.00 (imported)" : info.hasFrame ? "made on GPU" : md === "chatgpt" ? "$0.00 (you import it)" : "GPU ≈ " + APP.money(APP.estimate(s, "frame"));
        return h("div", { class: "im-sc" }, h("div", { class: "ds-row", style: "gap:10px;align-items:flex-start" }, thumb, h("div", { class: "im-grow" },
          h("div", { class: "ds-row ds-wrap", style: "gap:6px" }, h("b", {}, "Scene " + num), h("span", { class: "ds-pill " + (!info.hasFrame && md === "chatgpt" ? "warn" : info.tone) }, info.key === "await_import" || (!info.hasFrame && !info.busy && md === "chatgpt") ? "Needs picture" : info.label), src ? h("span", { class: "ds-pill" }, SRC_LABEL[src] || src) : null),
          nm.length ? h("div", { class: "im-mut" }, nm.join(", ")) : null,
          stOf(s).csb ? h("div", { class: "im-mut" }, `Approval: ${stOf(s).csb.approval_status}${stOf(s).csb.approved_at ? " (" + new Date(stOf(s).csb.approved_at * 1000).toLocaleString() + ")" : ""} · Import: ${String(stOf(s).csb.import_status).replace("_", " ")}${stOf(s).csb.image_version ? " · v" + stOf(s).csb.image_version : ""}`) : null,
          h("div", { class: "im-mut" }, `Video: ${info.hasVideo ? (clipOld ? "ready, outdated" : "ready") : info.busy && info.key === "video_run" ? "making…" : "not made"} · Frame ${frameCost} · Video ≈ ${info.hasVideo ? "$0.00" : APP.money(APP.estimate(s, "clip"))}`),
          h("div", { class: "im-btns" }, h("button", { class: "ds-btn sm", onclick: () => scene(p, s, { actions: act, chars, refresh: ctx.refresh, scenes }) }, "Details"), h("button", { class: "ds-btn sm", onclick: () => sheet(p, s, { refresh: ctx.refresh, number: num, scenes }) }, icon("img"), info.hasFrame ? "Replace frame" : "Import frame"),
            (stOf(s).frame_history || stOf(s).cversions || []).length > 1 ? h("button", { class: "ds-btn sm ghost", onclick: () => versions(p, s, { refresh: ctx.refresh, number: num }) }, "Versions") : null,
            info.hasFrame && info.approved && act.video && !info.busy ? h("button", { class: "ds-btn sm", onclick: () => act.video(s) }, icon("play"), info.hasVideo ? "Regenerate video" : "Make video") : null))));
      });
      const wf = (p.data || {}).connector_workflow, ov = wf && wf.overview;
      const wfBox = wf ? h("div", { class: "lv", style: "margin:6px 0" }, h("b", {}, "ChatGPT storyboard · " + ({ storyboard_needed: "waiting for the overview", awaiting_storyboard_approval: "overview waiting for approval", storyboard_changes_requested: "changes requested", scene_image_needed: "next scene image needed",
        awaiting_scene_approval: "scene waiting for approval", verify_images: "verifying images", ready_to_prepare_video: "ready for the video plan", awaiting_cost_approval: "waiting for cost approval", generating_videos: "videos are being made", assembling: "assembling", done: "finished", videos_need_fix: "a video needs a fix" }[wf.stage] || wf.stage)),
        ov && ov.image_url ? h("div", { class: "im-prev", style: "margin:8px 0" }, h("img", { src: ov.image_url, alt: "Storyboard overview", style: "width:150px;max-height:110px;object-fit:cover" }), h("div", { class: "im-grow im-mut" }, h("div", {}, `Overview v${ov.version} · ${ov.status}${ov.approved ? " ✓" : ""}`),
          h("div", { style: "overflow-wrap:anywhere" }, "SHA-256 " + String(ov.image_sha256 || "").slice(0, 16) + "…"), ov.approved_at ? h("div", {}, "Approved " + new Date(ov.approved_at * 1000).toLocaleString()) : null)) : null,
        h("div", { class: "lv-mut", style: "font-size:13px" }, `${wf.approved || 0} of ${scenes.length} scenes approved · paid videos ${wf.video && wf.video.authorized ? "approved" : "wait for your cost approval"}`)) : null;
      const det = h("details", { class: "ws-sec", open: md !== "ai" }, h("summary", {}, `${SOURCES.find(x => x[0] === md)[1]} · ${scenes.filter(s => s.start_asset_url).length}/${scenes.length} frames`),
        h("div", { class: "in" }, wfBox, h("div", { class: "ds-row ds-wrap", style: "gap:8px;margin-bottom:6px" }, h("label", { class: "ds-small", for: "im-mode" }, "Storyboard image source"),
          h("select", { class: "im-sel", id: "im-mode", disabled: isChat(scenes[0] || {}), title: isChat(scenes[0] || {}) ? "A chat movie keeps the source it was created with." : "", onchange: async e => { try { await APP.saveProject(p, { data: { ...(p.data || {}), image_source: e.target.value } }); ctx.refresh && ctx.refresh(); } catch (er) { APP.fail(er, "Could not change the source"); } } },
            SOURCES.map(([k, l]) => h("option", { value: k, selected: k === md }, l)))), h("div", { class: "im-steps" }, S.map((x, k) => h("span", { class: (x[1] ? "on" : "") + (k === cur ? " now" : ""), title: x[2] }, (x[1] ? "✓ " : "") + x[0] + (x[2] ? " " + x[2] : "")))),
          h("div", { class: "ds-row ds-wrap" }, h("button", { class: "ds-btn", onclick: () => bulk(p, scenes, { refresh: ctx.refresh }) }, icon("plus"), "Import frames…"), h("span", { class: "ds-small" }, `Videos left ≈ ${APP.money(left)} · start frames from import cost $0.00`)),
          h("div", {}, rows)));
      return det;
    }

    // ------------------------------------------------------------------ never make a GPU frame in a "ChatGPT Storyboard Import" project
    const gpuFramesBlocked = p => mode(p) === "chatgpt";
    function guard() {
      const sb = window.SP && window.SP.sb; if (!sb) return false; if (sb.__impGuard) return true; sb.__impGuard = true;
      let pid = ""; const use = sb.use, frame = sb.frame, keyframes = sb.keyframes;
      const MSG = "This project uses imported pictures (ChatGPT Storyboard Import): start frames are never made on the GPU. Import the picture for this scene instead.";
      const blocked = async () => { if (!pid) return false; try { return gpuFramesBlocked(await APP.project(pid)); } catch { return false; } };
      sb.use = async id => { pid = id; return use.call(sb, id); };
      sb.frame = async function (id) { if (await blocked()) throw new Error(MSG); return frame.apply(this, arguments); };
      sb.keyframes = async function () { if (await blocked()) { if ((await APP.scenes(pid, true)).some(s => !s.start_asset)) throw new Error(MSG); return 0; } return keyframes.apply(this, arguments); };
      return true;
    }
    const g = setInterval(() => { if (guard()) clearInterval(g); }, 300); setTimeout(() => clearInterval(g), 60000);

    // ------------------------------------------------------------------ Scene details: everything about ONE scene in one place (frame, cast, approval, video, errors)
    const STEPS6 = ["Request accepted", "Queued", "Worker assigned", "Generating", "Validating", "Ready for review"];
    async function post(op, st, extra) {
      const act = actLink(); if (!act) throw new Error("This is a chat movie: ask your chat to open the studio app with actions allowed, then open that link on this device.");
      let r, j;
      try { r = await fetch(`${act}/${op}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ movie_id: st.cm, scene_number: st.cn, ...extra }), cache: "no-store", credentials: "omit" }); j = await r.json().catch(() => ({})); }
      catch (e) { throw new Error("Could not reach the connector. Nothing was changed or charged. " + (e && e.message || "")); }
      if (r.status === 404) throw new Error("The actions link is no longer valid. Ask your chat for a new one (say “open in studio app”, actions allowed).");
      return j;
    }
    function scene(project, sc0, ctx = {}) {
      style();
      let sc = sc0, err = "", note = "", busy = false, off = [], box = null, closeSheet = null;
      const st = () => stOf(sc), chat = () => isChat(sc), cid = () => (project.data || {}).connector_id || st().cm;
      const num = () => chat() ? st().cn : ((ctx.scenes || []).findIndex(x => x.id === sc.id) + 1 || "");
      const fail = e => { err = String(e && e.message || e); note = ""; render(); };
      const refresh = async () => { try { const all = await APP.scenes(project.id, true); sc = all.find(x => x.id === sc.id) || sc; } catch {} if (box) render(); };
      async function chatVideo() {
        if (busy) return; const s = st(), sha = (s.cmeta || {}).sha256 || "", cast = names(sc, ctx.chars);
        const extra = { approve_frame: true, expected_sha256: sha, expected_characters: cast };
        busy = true; err = ""; note = "Checking the scene…"; render();
        try {
          const pre = await post("video_preview", s, extra);
          if (pre.status !== "needs_confirmation") { err = txt(pre.message || pre.error, "The connector did not accept the request."); note = ""; busy = false; render(); return; }
          busy = false; note = ""; render();
          const ok = await APP.confirm(`Make scene ${num()}'s video?`, `One paid video job for this scene only (about ${APP.money(pre.estimated_cost_usd)} of RunPod credit). The frame you see is approved now and is the exact start of the video. No other scene, no new start frame, no assembly.${APP.gpu && APP.gpu.state === "asleep" ? "\nThe GPU is asleep: the first video can take about 20 minutes." : ""}`, "Approve & generate");
          if (!ok) return;
          busy = true; note = "Sending the request…"; render();
          const res = await post("generate_video", s, { ...extra, confirm: true, resume_if_paused: true, idempotency_key: `app-${String(s.cm).slice(-5)}-s${s.cn}-${Date.now().toString(36)}`, wait_seconds: 10 });
          if (res.status === "submitted" || res.status === "queued") note = txt(res.message, "Started."); else { err = txt(res.message || res.error, "The connector did not start the video."); note = ""; }
          if (APP.live && APP.live.refresh) APP.live.refresh();
        } catch (e) { err = String(e && e.message || e); note = ""; }
        busy = false; render();
      }
      async function approveLocal() {
        try { await APP.saveScene(sc, { settings: { ...st(), review: "approved" } }); note = "Frame approved."; err = ""; await refresh(); } catch (e) { fail(e); }
      }
      function render() {
        if (!box) return;
        const info = APP.sceneInfo(sc, project), L = (APP.live && APP.live.get(cid())) || null, row = L && (L.scenes || []).find(x => x.scene === st().cn), lc = row && row.lifecycle;
        const cast = names(sc, ctx.chars), src = srcOf(sc), meta = st().cmeta || st().frame_meta || {}, hasVid = info.hasVideo, failed = info.key === "failed" || (row && row.state === "needs_fix");
        const blocks = [];
        blocks.push(h("div", { class: "ds-row ds-between", style: "align-items:flex-start" }, h("div", { class: "im-grow" }, h("h2", { class: "ds-h2", style: "font-size:18px;margin:0" }, `Scene ${num()}`), h("div", { class: "ds-sub", style: "margin:2px 0 0" }, /^scene \d+$/i.test(txt(sc.title, "").trim()) ? "" : txt(sc.title, ""))),
          h("button", { class: "ds-btn icon ghost", "aria-label": "Close", onclick: () => closeSheet && closeSheet() }, icon("x"))));
        blocks.push(h("div", { class: "ds-row ds-wrap", style: "gap:6px;margin:6px 0" }, h("span", { class: "ds-pill " + info.tone }, info.key === "await_import" ? "Waiting for your picture" : info.label), src ? h("span", { class: "ds-pill" }, SRC_LABEL[src] || src) : null,
          stOf(sc).clip_stale ? h("span", { class: "ds-pill warn" }, "video is from an older frame") : null));
        blocks.push(h("p", { class: "ds-sub", style: "margin:0 0 8px" }, txt(sc.action, "").slice(0, 300)));
        blocks.push(h("div", { class: "ds-field" }, h("label", {}, "Characters in this scene"), cast.length ? h("div", { class: "ds-chips", style: "flex-wrap:wrap" }, cast.map(n => h("span", { class: "ds-chip on" }, n))) : h("div", { class: "im-mut" }, "No characters assigned.")));
        blocks.push(info.hasFrame ? h("div", { class: "im-prev", style: "margin:8px 0" }, h("img", { src: sc.start_asset_url, alt: `Scene ${num()} start frame`, style: "width:140px;max-height:250px", onclick: () => APP.viewer && APP.viewer([{ url: sc.start_asset_url, title: `Scene ${num()}`, id: sc.id }], 0, {}) }),
          h("div", { class: "im-grow im-mut" }, h("div", {}, `Start frame · ${SRC_LABEL[src] || "AI Studio GPU"}${meta.version ? " · version " + meta.version : ""}`), meta.width ? h("div", {}, `${meta.width}×${meta.height}${meta.format ? " " + String(meta.format).toUpperCase() : ""}`) : null,
            meta.sha256 ? h("div", { style: "overflow-wrap:anywhere" }, "SHA-256 " + String(meta.sha256).slice(0, 16) + "…") : null,
            st().cwarn ? h("div", { class: "im-warn" }, "⚠ " + st().cwarn) : null, ...(st().cflags || []).slice(0, 3).map(f => h("div", { class: "im-warn" }, "⚠ " + f)),
            st().cidentity ? h("div", {}, "Face check: " + st().cidentity.overall) : h("div", {}, chat() ? "" : "Face check: not available on this device")))
          : h("div", { class: "ds-empty", style: "margin:8px 0" }, icon("img"), "No start frame yet. Import the approved picture."));
        const btns = [h("button", { class: "ds-btn", onclick: () => sheet(project, sc, { refresh, number: num(), scenes: ctx.scenes }) }, icon("img"), info.hasFrame ? "Replace image" : "Import image")];
        if ((st().frame_history || st().cversions || []).length > 1) btns.push(h("button", { class: "ds-btn ghost", onclick: () => versions(project, sc, { refresh, number: num() }) }, "Versions"));
        blocks.push(h("div", { class: "ds-row ds-wrap", style: "gap:8px" }, btns));
        // approval + video
        const vb = [];
        if (chat()) {
          if (info.hasFrame && !hasVid && !info.busy) vb.push(h("button", { class: "ds-btn pri", disabled: busy, onclick: () => APP.once("scene-video:" + sc.id, chatVideo) }, icon("play"), failed ? "Retry failed video" : info.approved ? "Generate video" : "Approve frame & generate video"));
          if (hasVid) vb.push(h("button", { class: "ds-btn", disabled: busy, onclick: () => APP.once("scene-video:" + sc.id, chatVideo) }, icon("refresh"), "Regenerate video"));
        } else {
          if (info.hasFrame && !info.approved && !hasVid) vb.push(h("button", { class: "ds-btn pri", onclick: approveLocal }, icon("check"), "Approve frame"));
          if (info.hasFrame && info.approved && !info.busy && ctx.actions && ctx.actions.video) vb.push(h("button", { class: "ds-btn pri", onclick: async () => { try { await ctx.actions.video(sc); await refresh(); } catch (e) { fail(e); } } }, icon("play"), failed ? "Retry failed video" : hasVid ? "Regenerate video" : "Generate video"));
        }
        blocks.push(h("div", { class: "ds-row ds-wrap", style: "gap:8px;margin-top:8px" }, vb, info.hasFrame && !info.approved && chat() ? h("span", { class: "im-mut" }, "Approving also starts this scene's video (only this scene).") : null));
        // progress
        if (lc || info.busy) {
          const step = lc ? lc.step : 0;
          blocks.push(h("div", { class: "lv", style: "margin-top:10px" }, h("b", {}, "Progress: " + (lc ? lc.label : info.label)), h("div", { class: "lv-steps" }, STEPS6.map((s, i) => h("i", { class: i < step ? "on" : i === step - 1 ? "on now" : "", title: s }))),
            row && row.gpu ? h("div", { class: "lv-mut", style: "font-size:13px" }, `${row.gpu.node || row.gpu.phase || ""} ${row.gpu.nodes || ""} · running ${Math.round((row.gpu.elapsed_seconds || 0) / 60)} min`) : null,
            row && row.next_action ? h("div", { class: "lv-mut", style: "font-size:13px" }, row.next_action) : null));
        }
        if (row && (row.needs_fix || row.error)) blocks.push(h("div", { class: "im-bad", style: "margin-top:8px" }, "✕ " + txt((row.needs_fix && row.needs_fix.reason) || row.error, "This scene needs a fix.")));
        if (hasVid) blocks.push(h("div", { style: "margin-top:10px" }, h("video", { src: sc.video_asset_url, controls: true, playsinline: true, preload: "metadata", style: "width:100%;max-height:340px;border-radius:10px;background:#000" }),
          h("div", { class: "ds-row ds-wrap", style: "gap:8px;margin-top:6px" }, h("a", { class: "ds-btn", href: sc.video_asset_url, download: `scene-${num()}.mp4` }, icon("down"), "Download clip"))));
        if (note) blocks.push(h("div", { class: "im-ok", style: "margin-top:8px" }, note));
        if (err) blocks.push(h("div", { class: "im-bad", style: "margin-top:8px", role: "alert" }, "✕ " + err));
        box.replaceChildren(...blocks);
      }
      APP.sheet((b, close) => { box = b; closeSheet = close; render(); }, { onClose: () => { off.forEach(f => { try { f(); } catch {} }); box = null; } });
      off.push(APP.on("live", () => { if (box) refresh(); }), APP.on("changed", () => { if (box) refresh(); }));
      refresh();
    }

    // ------------------------------------------------------------------ chat movies that were deleted on this phone but still exist in the studio
    function hiddenBanner() {
      const list = APP.hiddenChat || []; if (!list.length) return null; style();
      const go = async ids => { try { await window.__connectorRestore(ids); APP.toast(ids.length > 1 ? "Chat movies restored." : "Movie restored.", "ok"); } catch (e) { APP.fail(e, "Restore"); } };
      return h("div", { class: "im-hid", role: "status" }, h("b", {}, `${list.length} chat movie${list.length === 1 ? " is" : "s are"} hidden on this phone`),
        h("div", { class: "im-mut" }, "They were deleted here earlier. They still exist in your studio and nothing was lost; restoring brings the project back with its frames and videos."),
        h("div", { class: "ds-row ds-wrap", style: "gap:8px;margin-top:8px" }, list.slice(0, 3).map(m => h("button", { class: "ds-btn sm", onclick: () => go([m.id]) }, "Restore “" + String(m.title).slice(0, 32) + "”")), list.length > 1 ? h("button", { class: "ds-btn sm pri", onclick: () => go(list.map(m => m.id)) }, "Restore all " + list.length) : null));
    }
    APP.on("hidden-chat", () => { try { if (/^#\/projects\/?$/.test(location.hash) || location.hash === "" || /^#\/home/.test(location.hash)) APP.changed("projects"); } catch {} });

    window.IMP = { sheet, bulk, versions, card, scene, hiddenBanner, gpuFramesBlocked, mode, SOURCES, _t: { inspect, importOne, guessScene, sniff, mode, srcOf, isImported, steps, restoreOne } };
  }
})();
