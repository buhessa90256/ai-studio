// Studio Pro: Projects, Characters and Assets tabs. Talks to /api/studio/* (SQLite on the PC); nothing is kept only in the browser.
(() => {
  // phone/tunnel: the access token arrives once as ?token=…; keep it as a cookie so <img>/<video> can load /media too
  try {
    const t = new URLSearchParams(location.search).get("token");
    if (t) { document.cookie = "studio_token=" + t + "; path=/; max-age=31536000; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : ""); history.replaceState(null, "", location.pathname); }
  } catch {}

  const css = document.createElement("style");
  css.textContent = `
  .sp-bar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:14px }
  .sp-bar h2 { margin:0; font-size:18px; flex:1 }
  .sp-btn { font:inherit; font-size:13.5px; padding:8px 14px; border-radius:8px; border:1px solid var(--line); background:var(--panel); color:var(--ink); cursor:pointer }
  .sp-btn.pri { background:var(--accent); color:var(--accent-ink); border-color:var(--accent); font-weight:600 }
  .sp-btn.bad { color:var(--bad); border-color:var(--bad) }
  .sp-btn.on { background:var(--soft); border-color:var(--accent) }
  .sp-card { background:var(--panel); border:1px solid var(--line); border-radius:12px; overflow:hidden; cursor:pointer; display:flex; flex-direction:column }
  .sp-card .pic { aspect-ratio:16/10; background:var(--bg); display:flex; align-items:center; justify-content:center; color:var(--muted); font-size:34px; overflow:hidden }
  .sp-card.sq .pic { aspect-ratio:1 }
  .sp-card .pic img, .sp-card .pic video { width:100%; height:100%; object-fit:cover; display:block }
  .sp-card .info { padding:10px 12px; font-size:13px; color:var(--muted) } .sp-card .info b { display:block; color:var(--ink); font-size:14.5px }
  .sp-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:14px }
  .sp-modal { position:fixed; inset:0; z-index:70; background:rgba(0,0,0,.55); display:flex; align-items:center; justify-content:center; padding:12px }
  .sp-box { background:var(--panel); border:1px solid var(--line); border-radius:12px; width:min(920px,100%); max-height:94vh; overflow-y:auto; padding:18px }
  .sp-box h3 { margin:0 0 4px } .sp-two { display:grid; grid-template-columns:1fr 1fr; gap:0 14px } .sp-three { display:grid; grid-template-columns:repeat(3,1fr); gap:0 12px }
  .sp-refs { display:grid; grid-template-columns:repeat(auto-fill,minmax(130px,1fr)); gap:10px; margin-top:8px }
  .sp-ref { border:1px solid var(--line); border-radius:10px; overflow:hidden; background:var(--bg) }
  .sp-ref img { width:100%; aspect-ratio:3/4; object-fit:cover; display:block } .sp-ref select, .sp-ref button { width:100%; border-radius:0; border:0; border-top:1px solid var(--line) }
  .sp-ref button { font:inherit; font-size:12px; padding:5px; background:var(--panel); color:var(--bad); cursor:pointer }
  .sp-saved { color:var(--muted); font-size:12.5px } .sp-empty { color:var(--muted); padding:30px; text-align:center; grid-column:1/-1 }
  .sp-pick { display:flex; flex-wrap:wrap; gap:8px; margin-top:6px } .sp-pick .sp-btn { display:flex; align-items:center; gap:6px; padding:4px 10px 4px 4px }
  .sp-pick img { width:26px; height:26px; border-radius:50%; object-fit:cover }
  @media (max-width:820px) { .sp-two, .sp-three { grid-template-columns:1fr } }`;
  document.head.append(css);

  const api = async (path, body) => {
    const r = await fetch("/api/studio/" + path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ("Error " + r.status));
    return j;
  };
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") el.className = v; else if (k.startsWith("on")) el[k] = v; else if (v === true) el.setAttribute(k, ""); else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  };
  const debounce = (fn, ms = 700) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const fileB64 = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
  const fmtSize = n => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
  const thumb = a => a.type === "video" ? h("video", { src: a.url + "#t=0.5", muted: true, preload: "metadata" })
    : a.type === "audio" ? "♪" : (a.mime || "").startsWith("image/") ? h("img", { src: a.url, loading: "lazy", alt: a.filename }) : "▫";
  const err = e => alert(e.message || e);

  const modal = (...kids) => {
    const m = h("div", { class: "sp-modal" }, h("div", { class: "sp-box" }, kids));
    const close = () => { m.remove(); document.removeEventListener("keydown", esc); };
    const esc = ev => { if (ev.key === "Escape") close(); };
    m.onclick = ev => { if (ev.target === m) close(); };
    document.addEventListener("keydown", esc); document.body.append(m);
    m.close = close; return m;
  };

  // add nav buttons + sections (before Results)
  const nav = document.getElementById("tabs"), anchor = nav.querySelector('[data-tab="history"]');
  const main = (document.getElementById("studio-main") || document.querySelector("main")), mainAnchor = document.getElementById("tab-history");
  const tabs = { projects: "Projects", characters: "Characters", assets: "Assets" };
  for (const [id, label] of Object.entries(tabs)) {
    const b = h("button", { "data-tab": id }, label); b.onclick = () => showTab(id); nav.insertBefore(b, anchor);
    main.insertBefore(h("section", { class: "tab wide", id: "tab-" + id }), mainAnchor);
  }
  const loaders = {};
  window.SP = { api, h, debounce, modal, uploadFiles, thumb, err, fmtSize, loaders, fileB64 };
  // Run one GPU job and wait for its file; the file is saved into the asset library. onStatus(text) gets progress words.
  window.SP.runJob = async (tool, params, onStatus = () => {}, kind = /\.(png|jpe?g|webp|mp4|webm|wav|mp3|flac|ogg|m4a)$/i) => {
    const r = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, params }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || "Error " + r.status);
    onStatus("Queued on the GPU…");
    for (;;) {
      await new Promise(res => setTimeout(res, 6000));
      const s = await api("../status/" + j.id);
      if (s.error) throw new Error(String(s.error).slice(0, 300));
      if (s.files && s.files.length) { const f = s.files.find(x => kind.test(x)) || s.files[0]; return api("register", { file: f }); }
      onStatus("Generating… (the GPU can take a few minutes to wake)");
    }
  };
  const origShow = window.showTab;
  window.showTab = name => { origShow(name); if (loaders[name]) loaders[name](); };
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => window.showTab(b.dataset.tab));
  try { const t = localStorage.getItem("tab"); if (loaders && tabs[t]) setTimeout(() => window.showTab(t), 0); } catch {}

  // ------------------------------------------------------------------ Assets
  const AS = { type: "", q: "", fav: false, deleted: false };
  const TYPES = ["", "image", "video", "audio", "character", "background", "location", "prop", "mask", "depth", "pose", "export"];
  async function uploadFiles(files, extra = {}) {
    const out = [];
    for (const f of files) {
      try { out.push(await api("assets", { filename: f.name, data: await fileB64(f), ...extra })); }
      catch (e) { err(new Error(f.name + ": " + e.message)); }
    }
    return out;
  }
  loaders.assets = async function () {
    const root = document.getElementById("tab-assets");
    const grid = h("div", { class: "sp-grid" });
    const status = h("span", { class: "sp-saved" });
    const input = h("input", { type: "file", multiple: true, hidden: true, accept: "image/*,video/*,audio/*" });
    const upload = async files => { status.textContent = "Uploading…"; const r = await uploadFiles([...files]); status.textContent = r.length + " added" + (r.some(x => x.duplicate) ? " (some were already in the library)" : ""); refresh(); };
    input.onchange = () => upload(input.files);
    const search = h("input", { type: "text", placeholder: "Search name or tag", value: AS.q, style: "max-width:240px" });
    search.oninput = debounce(() => { AS.q = search.value; refresh(); }, 300);
    const typeSel = h("select", { style: "max-width:150px" }, TYPES.map(t => h("option", { value: t, selected: t === AS.type }, t || "All types")));
    typeSel.onchange = () => { AS.type = typeSel.value; refresh(); };
    const favBtn = h("button", { class: "sp-btn" + (AS.fav ? " on" : ""), onclick: () => { AS.fav = !AS.fav; favBtn.classList.toggle("on", AS.fav); refresh(); } }, "★ Favorites");
    const delBtn = h("button", { class: "sp-btn" + (AS.deleted ? " on" : ""), onclick: () => { AS.deleted = !AS.deleted; delBtn.classList.toggle("on", AS.deleted); refresh(); } }, "Deleted");
    root.replaceChildren(
      h("div", { class: "sp-bar" }, h("h2", {}, "Assets"), search, typeSel, favBtn, delBtn, h("button", { class: "sp-btn pri", onclick: () => input.click() }, "Upload files"), input),
      h("div", { class: "sp-saved", style: "margin-bottom:10px" }, "Drop files anywhere on this page. ", status), grid);
    root.ondragover = e => { e.preventDefault(); };
    root.ondrop = e => { e.preventDefault(); if (e.dataTransfer.files.length) upload(e.dataTransfer.files); };
    async function refresh() {
      const qs = new URLSearchParams({ type: AS.type, q: AS.q, favorite: AS.fav ? 1 : "", deleted: AS.deleted ? 1 : "" });
      const { items } = await api("assets?" + qs);
      grid.replaceChildren(...(items.length ? items.map(a => {
        const c = h("div", { class: "sp-card sq", onclick: () => openAsset(a, refresh) }, h("div", { class: "pic" }, thumb(a)),
          h("div", { class: "info" }, h("b", {}, (a.favorite ? "★ " : "") + a.filename), a.type + " · " + fmtSize(a.size) + (a.width ? ` · ${a.width}×${a.height}` : "")));
        return c;
      }) : [h("div", { class: "sp-empty" }, AS.deleted ? "Nothing deleted." : "No assets yet. Upload or drop files here.")]));
    }
    refresh().catch(err);
  };
  function openAsset(a, done) {
    const m = modal();
    const box = m.firstChild;
    const media = a.type === "video" ? h("video", { src: a.url, controls: true, style: "max-width:100%;max-height:55vh" })
      : a.type === "audio" ? h("audio", { src: a.url, controls: true }) : h("img", { src: a.url, style: "max-width:100%;max-height:55vh" });
    const name = h("input", { type: "text", value: a.filename }), tags = h("input", { type: "text", value: a.tags.join(", "), placeholder: "tags, separated by commas" });
    const typeSel = h("select", {}, TYPES.slice(1).map(t => h("option", { value: t, selected: t === a.type }, t)));
    const save = async patch => { try { await api("assets/" + a.id, patch); done(); } catch (e) { err(e); } };
    box.append(h("div", { class: "sp-bar" }, h("h3", { style: "flex:1" }, a.filename), h("button", { class: "sp-btn", onclick: m.close }, "Close")),
      h("div", { style: "text-align:center" }, media),
      h("div", { class: "sp-two" }, h("div", {}, h("label", {}, "Name"), name), h("div", {}, h("label", {}, "Type"), typeSel)),
      h("label", {}, "Tags"), tags,
      h("p", { class: "hint" }, `${a.mime} · ${fmtSize(a.size)}${a.width ? ` · ${a.width}×${a.height}` : ""} · added ${new Date(a.created * 1000).toLocaleString()}`),
      h("div", { class: "actions" },
        h("button", { class: "sp-btn pri", onclick: async () => { await save({ filename: name.value, type: typeSel.value, tags: tags.value.split(",").map(s => s.trim()).filter(Boolean) }); m.close(); } }, "Save"),
        h("button", { class: "sp-btn", onclick: async () => { await save({ favorite: !a.favorite }); m.close(); } }, a.favorite ? "★ Unfavorite" : "☆ Favorite"),
        h("a", { class: "sp-btn", href: a.url, download: a.filename, style: "text-decoration:none" }, "Download"),
        a.deleted ? h("button", { class: "sp-btn", onclick: async () => { await save({ deleted: false }); m.close(); } }, "Restore")
          : h("button", { class: "sp-btn bad", onclick: async () => { await save({ deleted: true }); m.close(); } }, "Delete")));
  }

  // ------------------------------------------------------------------ Characters
  const ROLES = ["primary", "face", "body", "profile", "expression", "pose", "costume", "other"];
  loaders.characters = async function () {
    const root = document.getElementById("tab-characters");
    const { items } = await api("characters");
    root.replaceChildren(
      h("div", { class: "sp-bar" }, h("h2", {}, "Characters"), h("button", { class: "sp-btn pri", onclick: () => editCharacter({ name: "", kind: "human", refs: [], costumes: [] }, loaders.characters) }, "New character")),
      h("div", { class: "sp-grid" }, items.length ? items.map(c => h("div", { class: "sp-card sq", onclick: () => editCharacter(c, loaders.characters) },
        h("div", { class: "pic" }, c.thumb ? h("img", { src: c.thumb, alt: c.name }) : "☺"),
        h("div", { class: "info" }, h("b", {}, c.name), c.kind + (c.age ? " · " + c.age : "") + " · " + c.refs.length + " photo" + (c.refs.length === 1 ? "" : "s"))))
        : [h("div", { class: "sp-empty" }, "No characters yet. Create one and add reference photos: front face, full body, profile, expressions.")]));
  };
  function editCharacter(c, done) {
    const st = { id: c.id, refs: c.refs.map(r => ({ asset_id: r.asset.id, role: r.role, label: r.label, url: r.asset.url })) };
    const saved = h("span", { class: "sp-saved" }, c.id ? "Saved" : "Not saved yet");
    const f = {
      name: h("input", { type: "text", value: c.name, placeholder: "e.g. Hessa" }),
      kind: h("select", {}, ["human", "animal", "fictional", "creature"].map(k => h("option", { value: k, selected: k === c.kind }, k))),
      age: h("input", { type: "text", value: c.age || "", placeholder: "e.g. 4 years old" }),
      hair: h("input", { type: "text", value: c.hair || "", placeholder: "long dark curly" }),
      eyes: h("input", { type: "text", value: c.eyes || "", placeholder: "big dark brown" }),
      voice: h("input", { type: "text", value: c.voice || "", placeholder: "voice notes or reference" }),
      description: h("textarea", { style: "min-height:70px", placeholder: "Short description: personality, looks, outfit" }, c.description || ""),
      costumes: h("textarea", { style: "min-height:60px", placeholder: "One outfit per line" }, (c.costumes || []).join("\n")),
    };
    const refsBox = h("div", { class: "sp-refs" });
    const m = modal();
    const persist = async () => {
      if (!f.name.value.trim()) { saved.textContent = "Give it a name to save"; return; }
      try {
        const r = await api("characters", { id: st.id, name: f.name.value, kind: f.kind.value, age: f.age.value, hair: f.hair.value, eyes: f.eyes.value, voice: f.voice.value,
          description: f.description.value, costumes: f.costumes.value.split("\n").map(s => s.trim()).filter(Boolean),
          refs: st.refs.map(({ asset_id, role, label }) => ({ asset_id, role, label })) });
        st.id = r.id; saved.textContent = "Saved ✓";
      } catch (e) { saved.textContent = "Not saved: " + e.message; }
    };
    const auto = debounce(persist);
    Object.values(f).forEach(el => { el.oninput = auto; el.onchange = auto; });
    const drawRefs = () => refsBox.replaceChildren(...st.refs.map((r, i) => {
      const sel = h("select", {}, ROLES.map(x => h("option", { value: x, selected: x === r.role }, x))); sel.onchange = () => { r.role = sel.value; auto(); };
      return h("div", { class: "sp-ref" }, h("img", { src: r.url }), sel, h("button", { onclick: () => { st.refs.splice(i, 1); drawRefs(); auto(); } }, "Remove"));
    }));
    drawRefs();
    const input = h("input", { type: "file", multiple: true, accept: "image/*", hidden: true });
    input.onchange = async () => {
      saved.textContent = "Uploading…";
      for (const a of await uploadFiles([...input.files], { type: "character" })) st.refs.push({ asset_id: a.id, role: st.refs.length ? "other" : "primary", label: "", url: a.url });
      drawRefs(); persist();
    };
    m.firstChild.append(
      h("div", { class: "sp-bar" }, h("h3", { style: "flex:1" }, c.id ? "Edit character" : "New character"), saved, h("button", { class: "sp-btn", onclick: () => { m.close(); done(); } }, "Close")),
      h("div", { class: "sp-two" }, h("div", {}, h("label", {}, "Name"), f.name), h("div", {}, h("label", {}, "Type"), f.kind)),
      h("div", { class: "sp-three" }, h("div", {}, h("label", {}, "Age"), f.age), h("div", {}, h("label", {}, "Hair"), f.hair), h("div", {}, h("label", {}, "Eyes"), f.eyes)),
      h("label", {}, "Description"), f.description,
      h("div", { class: "sp-two" }, h("div", {}, h("label", {}, "Clothing / costumes"), f.costumes), h("div", {}, h("label", {}, "Voice"), f.voice)),
      h("label", {}, "Reference photos"), h("p", { class: "hint", style: "margin:0" }, "Face close-up, full body, side profile, expressions, poses. The first one (or the one marked primary) is the main identity photo. Originals are never changed."),
      refsBox, h("div", { class: "actions" }, h("button", { class: "sp-btn pri", onclick: () => input.click() }, "Add photos"), input,
        c.id || st.id ? h("button", { class: "sp-btn bad", onclick: async () => { if (confirm("Delete this character? Its photos stay in Assets.")) { await api(`characters/${st.id}/delete`, {}); m.close(); done(); } } }, "Delete character") : null));
    m.close0 = m.close; m.close = () => { m.close0(); };
  }

  // ------------------------------------------------------------------ Projects
  const PS = { archived: false, deleted: false };
  loaders.projects = async function () {
    const root = document.getElementById("tab-projects");
    const { items } = await api(`projects?archived=${PS.archived ? 1 : ""}&deleted=${PS.deleted ? 1 : ""}`);
    const tog = (key, label) => h("button", { class: "sp-btn" + (PS[key] ? " on" : ""), onclick: () => { PS[key] = !PS[key]; if (key === "archived") PS.deleted = false; else PS.archived = false; loaders.projects(); } }, label);
    root.replaceChildren(
      h("div", { class: "sp-bar" }, h("h2", {}, "Projects"), tog("archived", "Archived"), tog("deleted", "Deleted"),
        !PS.deleted && !PS.archived && items.length && window.BULK ? h("button", { class: "sp-btn bad", id: "bk-del-open", onclick: () => window.BULK.deleteProjects({ onDone: loaders.projects }) }, "Delete several…") : null,
        h("button", { class: "sp-btn pri", onclick: () => editProject({ name: "", aspect: "16:9", duration: 60, story: "", characters: [], asset_ids: [] }, loaders.projects) }, "New project")),
      h("div", { class: "sp-grid" }, items.length ? items.map(p => h("div", { class: "sp-card", onclick: () => editProject(p, loaders.projects) },
        h("div", { class: "pic" }, p.cover_url ? h("img", { src: p.cover_url, alt: p.name }) : "🎬"),
        h("div", { class: "info" }, h("b", {}, p.name + (p.version > 1 ? " · v" + p.version : "")),
          `${p.aspect} · ${p.duration}s · ${p.characters.length} character${p.characters.length === 1 ? "" : "s"}${p.folder ? " · " + p.folder : ""}`)))
        : [h("div", { class: "sp-empty" }, "No projects here yet.")]));
  };
  async function editProject(p, done) {
    const chars = (await api("characters")).items;
    const st = { id: p.id, characters: [...p.characters], cover_asset: p.cover_asset || "", asset_ids: p.asset_ids || [] };
    const saved = h("span", { class: "sp-saved" }, p.id ? "Saved" : "Not saved yet");
    const f = {
      name: h("input", { type: "text", value: p.name, placeholder: "Project name" }),
      folder: h("input", { type: "text", value: p.folder || "", placeholder: "Folder (optional)" }),
      aspect: h("select", {}, ["16:9", "9:16", "1:1", "4:3", "21:9"].map(a => h("option", { value: a, selected: a === p.aspect }, a))),
      duration: h("select", {}, [15, 30, 60, 90, 120, 180, 300].map(d => h("option", { value: d, selected: d === p.duration }, d + " s"))),
      description: h("textarea", { style: "min-height:60px" }, p.description || ""),
      story: h("textarea", { style: "min-height:150px", placeholder: "Idea, script or story for this project" }, p.story || ""),
    };
    const m = modal();
    const persist = async () => {
      if (!f.name.value.trim()) { saved.textContent = "Give it a name to save"; return; }
      try {
        const r = await api("projects", { id: st.id, name: f.name.value, folder: f.folder.value, aspect: f.aspect.value, duration: +f.duration.value,
          description: f.description.value, story: f.story.value, characters: st.characters, asset_ids: st.asset_ids, cover_asset: st.cover_asset, data: p.data || {} });
        st.id = r.id; saved.textContent = "Saved ✓";
      } catch (e) { saved.textContent = "Not saved: " + e.message; }
    };
    const auto = debounce(persist);
    Object.values(f).forEach(el => { el.oninput = auto; el.onchange = auto; });
    const pick = h("div", { class: "sp-pick" }, chars.length ? chars.map(c => {
      const b = h("button", { class: "sp-btn" + (st.characters.includes(c.id) ? " on" : ""), type: "button" }, c.thumb ? h("img", { src: c.thumb }) : null, c.name);
      b.onclick = () => { const i = st.characters.indexOf(c.id); i < 0 ? st.characters.push(c.id) : st.characters.splice(i, 1); b.classList.toggle("on", i < 0); auto(); };
      return b;
    }) : [h("span", { class: "hint" }, "Create characters first (Characters tab).")]);
    const cover = h("input", { type: "file", accept: "image/*", hidden: true });
    cover.onchange = async () => { const [a] = await uploadFiles([...cover.files]); if (a) { st.cover_asset = a.id; if (!st.asset_ids.includes(a.id)) st.asset_ids.push(a.id); persist(); coverNote.textContent = "Cover set: " + a.filename; } };
    const coverNote = h("span", { class: "sp-saved" }, st.cover_asset ? "Cover set" : "");
    const isDel = p.deleted, isArch = p.archived;
    const act = (label, action, cls = "") => h("button", { class: "sp-btn " + cls, onclick: async () => { try { await api(`projects/${st.id}/${action}`, {}); m.close(); done(); } catch (e) { err(e); } } }, label);
    m.firstChild.append(
      h("div", { class: "sp-bar" }, h("h3", { style: "flex:1" }, p.id ? "Project" + (p.version > 1 ? " · version " + p.version : "") : "New project"), saved, h("button", { class: "sp-btn", onclick: () => { m.close(); done(); } }, "Close")),
      h("div", { class: "sp-two" }, h("div", {}, h("label", {}, "Name"), f.name), h("div", {}, h("label", {}, "Folder"), f.folder)),
      h("div", { class: "sp-two" }, h("div", {}, h("label", {}, "Aspect ratio"), f.aspect), h("div", {}, h("label", {}, "Target duration"), f.duration)),
      h("label", {}, "Description"), f.description, h("label", {}, "Story / script"), f.story,
      h("label", {}, "Characters in this project"), pick,
      h("div", { class: "actions" }, h("button", { class: "sp-btn", onclick: () => cover.click() }, "Set cover image"), cover, coverNote),
      st.id ? h("div", { class: "actions", style: "margin-top:18px" },
        isDel ? act("Restore", "restore") : [act("Duplicate", "duplicate"), act("Save as new version", "new_version"), isArch ? act("Unarchive", "unarchive") : act("Archive", "archive"), act("Delete", "delete", "bad")]) : null,
      h("p", { class: "hint" }, "Changes save automatically. Scenes, storyboard and timeline will live in this project in the next phases."));
  }
  Object.assign(window.SP, { openAsset, editCharacter, editProject, AS, TYPES });
})();

// ---------------------------------------------------------------------- character picker in generation forms
(() => {
  const api = async (path, body) => {
    const r = await fetch("/api/studio/" + path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ("Error " + r.status));
    return j;
  };
  const sel = new Map(); // form -> Set of character ids
  const FORMS = { "tab-edit": "qwen_edit", "tab-t2v": "minimax_h3" };
  const HINT = {
    qwen_edit: "Edit Image uses ONE reference picture, so the chosen characters' main photos are combined side by side (up to 4) and the model is told who is who. Describe the new scene; the original faces are the reference.",
    minimax_h3: "Video: MiniMax-H3 here takes only a start photo, so faces come from that photo. The characters' descriptions are added to your prompt. For the best faces, first make a start frame with Edit Image, then use it here.",
  };

  async function build(form, tool) {
    const set = sel.get(form) || new Set();
    const { items } = await api("characters");
    const box = form.querySelector(".sp-chars");
    box.replaceChildren();
    if (!items.length) { box.append(Object.assign(document.createElement("span"), { className: "hint", textContent: "No characters yet: create them in the Characters tab." })); return; }
    for (const c of items) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "sp-btn" + (set.has(c.id) ? " on" : "");
      if (c.thumb) { const i = document.createElement("img"); i.src = c.thumb; b.append(i); }
      b.append(c.name);
      b.onclick = () => { set.has(c.id) ? set.delete(c.id) : set.add(c.id); sel.set(form, set); b.classList.toggle("on", set.has(c.id)); note.hidden = !set.size; };
      box.append(b);
    }
    const note = form.querySelector(".sp-note"); note.hidden = !set.size;
  }

  for (const [tabId, tool] of Object.entries(FORMS)) {
    const form = document.querySelector(`#${tabId} form`);
    if (!form) continue;
    const wrap = document.createElement("div");
    wrap.innerHTML = '<label>Characters (optional)</label><div class="sp-pick sp-chars"></div><p class="hint sp-note" hidden></p>';
    wrap.querySelector(".sp-note").textContent = HINT[tool];
    const firstLabel = form.querySelector("label");
    form.insertBefore(wrap, firstLabel);
    sel.set(form, new Set());
    build(form, tool).catch(() => {});
    document.querySelector(`#tabs [data-tab="${tabId.slice(4)}"]`).addEventListener("click", () => build(form, tool).catch(() => {}));
  }

  window.StudioChars = {
    selected: form => [...(sel.get(form) || [])],
    // Turns the picked characters into model inputs. Returns false to cancel the run.
    async apply(form, params, tool, hasImage) {
      const ids = this.selected(form);
      if (tool === "qwen_edit") {
        const b = await api("board", { characters: ids, width: 1344, height: 768 });
        const scene = (params.prompt || "").trim();
        if (!scene) throw new Error("Describe the scene for these characters.");
        params.image = b.image;
        params.prompt = b.prompt + " Create a new photorealistic 16:9 photo of these same characters: " + scene + " Sharp, high detail, no extra people.";
        return true;
      }
      if (tool === "minimax_h3") {
        const b = await api("characters_prompt", { characters: ids });
        if (!hasImage && !confirm("No start photo: faces will only follow the text descriptions and may not match your characters.\n\nContinue anyway? (Better: make a start frame in Edit Image first.)")) return false;
        params.prompt = b.prompt + " " + (params.prompt || "");
        return true;
      }
      return true;
    },
  };
})();


// ---------------------------------------------------------------------- Settings: phone access (shown only on the PC)
(() => {
  const settings = document.getElementById("tab-settings");
  if (!settings) return;
  const { h } = window.SP;
  const card = h("div", { class: "card", style: "max-width:560px;margin-top:16px" }, h("h2", {}, "Phone access"), h("p", { class: "sub" }, "Open AI Studio from your phone through Tailscale (private, free)."), h("div", { id: "phone-body" }, "Checking…"));
  settings.append(card);
  async function show() {
    const body = card.querySelector("#phone-body");
    let info; try { info = await (await fetch("/api/phone/info")).json(); } catch { info = null; }
    if (!info || info.error) { card.remove(); return; } // opened through the tunnel: never show the token there
    if (!info.tailscale) { body.replaceChildren(h("p", { class: "hint" }, "Tailscale is not installed on this PC yet. Install it, sign in, then run in a terminal:"), h("code", {}, "tailscale serve --bg 8765"), h("p", { class: "hint" }, "Then reopen this page.")); return; }
    const direct = `http://${info.ip}:${info.port}/?token=${info.token}`, secure = info.serve ? `https://${info.dns}/?token=${info.token}` : "";
    const row = (label, url) => h("div", {}, h("label", {}, label), h("input", { type: "text", value: url, readonly: true, onclick: e => e.target.select() }),
      h("div", { class: "actions" }, h("button", { class: "sp-btn pri", type: "button", onclick: async () => { try { await navigator.clipboard.writeText(url); alert("Copied. Send it to your phone (for example to yourself in a private chat) and open it once there."); } catch { /* select the text instead */ } } }, "Copy link")));
    body.replaceChildren(h("p", { class: "hint" }, info.online ? "Tailscale is connected." : "Tailscale is installed but offline: open it and sign in."),
      secure ? row("Secure link (HTTPS) for your phone. It contains your private access token: don't share it", secure) : null,
      row(secure ? "Direct link (works without HTTPS; use it if the secure one fails)" : "Link for your phone (contains your private access token: don't share it)", direct),
      h("p", { class: "hint" }, "On the phone: install Tailscale, sign in with the same account, switch it on, then open a link once. After that the page remembers you. Requests without the token are refused."));
  }
  document.querySelector('#tabs [data-tab="settings"]').addEventListener("click", show);
  show();
})();
