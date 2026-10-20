// Studio Pro "backend" that runs inside the page: a JavaScript port of the PC app's studio_db / studio_scenes / studio_director /
// studio_workflows / studio_models / studio_editor (timeline part). Same JSON contract, so the same screens work in both apps.
// Everything is stored in IndexedDB on this device (see idb.js). Large files are stored as Blobs.
"use strict";
(() => {
  const D = window.SDB;
  const now = () => Date.now() / 1000;
  const clean = (t, n = 2000) => String(t ?? "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").slice(0, n).trim();
  const clamp = (v, d, lo, hi) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.max(lo, Math.min(n, hi)) : d; };
  const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
  const jparse = (s, d) => { try { return s == null ? d : typeof s === "string" ? JSON.parse(s) : s; } catch { return d; } };

  const ASSET_TYPES = ["image", "video", "audio", "character", "background", "location", "prop", "mask", "depth", "pose", "export", "other"];
  const CHAR_ROLES = ["primary", "face", "body", "profile", "expression", "pose", "costume", "other"];
  const EXT = { ".png": ["image", "image/png"], ".jpg": ["image", "image/jpeg"], ".jpeg": ["image", "image/jpeg"], ".webp": ["image", "image/webp"], ".gif": ["image", "image/gif"],
    ".mp4": ["video", "video/mp4"], ".webm": ["video", "video/webm"], ".mov": ["video", "video/quicktime"], ".mkv": ["video", "video/x-matroska"],
    ".mp3": ["audio", "audio/mpeg"], ".wav": ["audio", "audio/wav"], ".flac": ["audio", "audio/flac"], ".ogg": ["audio", "audio/ogg"], ".m4a": ["audio", "audio/mp4"] };
  const MAX_UPLOAD = 60 * 1048576;

  // ------------------------------------------------------------------ blobs / urls / probing
  const urlCache = new Map();
  async function blobUrl(id) {
    if (urlCache.has(id)) return urlCache.get(id);
    const b = await D.get("blobs", id);
    if (!b) return "";
    const u = URL.createObjectURL(b.blob); urlCache.set(id, u); return u;
  }
  const getBlob = async id => (await D.get("blobs", id))?.blob || null;
  const probeCache = new Map();
  async function probe(asset) {
    if (probeCache.has(asset.id)) return probeCache.get(asset.id);
    const blob = await getBlob(asset.id);
    if (!blob) throw bad(`'${asset.filename}' is missing from this device.`);
    const el = document.createElement(asset.mime.startsWith("audio/") ? "audio" : "video");
    el.preload = "metadata"; el.muted = true;
    const url = URL.createObjectURL(blob);
    const dur = await new Promise((res, rej) => {
      el.onloadedmetadata = () => res(el.duration); el.onerror = () => rej(bad(`Could not read '${asset.filename}'.`));
      el.src = url;
    }).finally(() => { setTimeout(() => URL.revokeObjectURL(url), 1000); });
    const r = { duration: Number.isFinite(dur) ? dur : 0, audio: true };
    probeCache.set(asset.id, r); return r;
  }
  async function sha256(blob) {
    const h = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  // ------------------------------------------------------------------ assets
  const extOf = name => (String(name).match(/\.[a-z0-9]+$/i)?.[0] || "").toLowerCase();
  const cleanFilename = n => (String(n || "file").split(/[\\/]/).pop().replace(/[^\w.\- ]+/gu, "_").slice(0, 120)) || "file";
  async function assetView(a) {
    return { ...a, tags: jparse(a.tags, []), favorite: !!a.favorite, deleted: !!a.deleted, url: await blobUrl(a.id), sha: undefined };
  }
  async function imageSize(blob) {
    try { const b = await createImageBitmap(blob); const r = [b.width, b.height]; b.close?.(); return r; } catch { return [null, null]; }
  }
  async function addAsset(filename, blob, { type, tags = [], folder = "" } = {}) {
    if (!blob || !blob.size) throw bad("The file is empty.");
    if (blob.size > MAX_UPLOAD) throw bad(`File too large (limit ${MAX_UPLOAD / 1048576} MB).`);
    filename = cleanFilename(filename);
    const ext = extOf(filename);
    if (!EXT[ext]) throw bad(`Unsupported file type '${ext || "?"}'. Allowed: ${Object.keys(EXT).sort().join(", ")}`);
    const sha = await sha256(blob);
    const dup = (await D.all("assets")).find(a => a.sha === sha && !a.deleted);
    if (dup) return { ...(await assetView(dup)), duplicate: true };
    const [w, h] = EXT[ext][0] === "image" ? await imageSize(blob) : [null, null];
    const a = { id: D.uid(), sha, filename, type: ASSET_TYPES.includes(type) ? type : EXT[ext][0], mime: EXT[ext][1], ext, size: blob.size, width: w, height: h,
      tags: (tags || []).map(t => clean(t, 40)).slice(0, 20), folder: clean(folder, 80), favorite: 0, deleted: 0, version_of: "", created: now() };
    await D.put("blobs", { id: a.id, blob: new Blob([blob], { type: a.mime }) });
    await D.put("assets", a);
    return { ...(await assetView(a)), duplicate: false };
  }
  const dataUrlToBlob = async s => { const r = await fetch(s); return r.blob(); };
  const getAsset = async id => { const a = id ? await D.get("assets", id) : null; return a && !a.deleted ? a : null; };

  async function listAssets(q) {
    let items = (await D.all("assets")).filter(a => !!a.deleted === (q.deleted === "1"));
    if (q.type) items = items.filter(a => a.type === q.type);
    if (q.favorite === "1") items = items.filter(a => a.favorite);
    if (q.folder) items = items.filter(a => a.folder === q.folder);
    if (q.q) { const s = q.q.toLowerCase(); items = items.filter(a => a.filename.toLowerCase().includes(s) || JSON.stringify(a.tags).toLowerCase().includes(s)); }
    if (q.project) { const p = await D.get("projects", q.project); const ids = new Set(p?.asset_ids || []); items = items.filter(a => ids.has(a.id)); }
    items.sort((a, b) => b.created - a.created);
    return { items: await Promise.all(items.map(assetView)) };
  }
  async function updateAsset(id, ch) {
    const a = await D.get("assets", id);
    if (!a) throw bad("Asset not found.");
    if ("filename" in ch) a.filename = cleanFilename(ch.filename);
    if ("tags" in ch) a.tags = (ch.tags || []).map(t => clean(t, 40)).slice(0, 20);
    if ("folder" in ch) a.folder = clean(ch.folder, 80);
    if ("favorite" in ch) a.favorite = ch.favorite ? 1 : 0;
    if ("type" in ch && ASSET_TYPES.includes(ch.type)) a.type = ch.type;
    if ("deleted" in ch) a.deleted = ch.deleted ? 1 : 0;
    await D.put("assets", a);
    return assetView(a);
  }

  // ------------------------------------------------------------------ characters
  async function charView(c) {
    const refs = [];
    for (const r of c.refs || []) { const a = await getAsset(r.asset_id); if (a) refs.push({ asset: await assetView(a), role: r.role, label: r.label || "" }); }
    const primary = refs.find(r => r.role === "primary") || refs[0];
    return { ...c, costumes: c.costumes || [], deleted: undefined, refs, thumb: primary ? primary.asset.url : "" };
  }
  const listCharacters = async () => ({ items: await Promise.all((await D.all("characters")).filter(c => !c.deleted).sort((a, b) => a.name.localeCompare(b.name)).map(charView)) });
  async function getCharacter(id) { const c = id ? await D.get("characters", id) : null; return c && !c.deleted ? charView(c) : null; }
  async function saveCharacter(b) {
    const name = clean(b.name, 80);
    if (!name) throw bad("Please give the character a name.");
    const old = b.id ? await D.get("characters", b.id) : null;
    const c = { ...(old || { id: D.uid(), created: now(), refs: [] }), name, kind: clean(b.kind, 20) || "human", description: clean(b.description), age: clean(b.age, 40), hair: clean(b.hair, 120),
      eyes: clean(b.eyes, 120), voice: clean(b.voice, 200), costumes: (b.costumes || []).map(x => clean(x, 200)).slice(0, 20), updated: now(), deleted: 0 };
    if ("refs" in b) {
      c.refs = [];
      for (const r of (b.refs || []).slice(0, 60)) if (await getAsset(r.asset_id)) c.refs.push({ asset_id: r.asset_id, role: CHAR_ROLES.includes(r.role) ? r.role : "other", label: clean(r.label, 80) });
    }
    await D.put("characters", c);
    return charView(c);
  }
  async function deleteCharacter(id) { const c = await D.get("characters", id); if (c) { c.deleted = 1; c.updated = now(); await D.put("characters", c); } }
  function characterPrompt(chars) {
    const parts = chars.map(c => {
      const bits = [c.age, c.hair && (/hair/i.test(c.hair) ? c.hair : c.hair + " hair"), c.eyes && (/eye/i.test(c.eyes) ? c.eyes : c.eyes + " eyes"), c.description].filter(Boolean);
      return c.name + (bits.length ? " (" + bits.join(", ") + ")" : "");
    });
    if (chars.length === 1) return `The reference shows ${parts[0]}. Keep the exact same face, hair and clothes.`;
    return "The reference shows, left to right: " + parts.join("; ") + ". Keep the exact same faces, hair and clothes for each.";
  }
  const primaryRef = c => (c.refs.find(r => r.role === "primary") || c.refs.find(r => r.role === "face") || c.refs[0])?.asset || null;

  // The characters' main photos side by side as ONE reference picture (for models that take a single reference image).
  async function buildBoard(ids, width = 1344, height = 768) {
    const chars = (await Promise.all((ids || []).slice(0, 4).map(getCharacter))).filter(Boolean);
    if (!chars.length) throw bad("Pick at least one character.");
    const imgs = [];
    for (const c of chars) {
      const a = primaryRef(c);
      if (!a || !a.mime.startsWith("image/")) throw bad(`${c.name} has no reference photo yet. Add one in the Characters tab.`);
      imgs.push(await createImageBitmap(await getBlob(a.id)));
    }
    const n = imgs.length, slotW = n > 1 ? Math.floor(width / n) : Math.floor(height * 0.58);
    const cv = document.createElement("canvas"); cv.width = width; cv.height = height;
    const g = cv.getContext("2d"); g.fillStyle = "rgb(225,215,200)"; g.fillRect(0, 0, width, height);
    const x0 = Math.floor((width - slotW * n) / 2);
    imgs.forEach((im, i) => {  // cover-crop to the slot, keeping the top (faces)
      const s = Math.max(slotW / im.width, height / im.height), sw = slotW / s, sh = height / s;
      g.drawImage(im, (im.width - sw) / 2, 0, sw, sh, x0 + i * slotW, 0, slotW, height);
    });
    const blob = await new Promise(r => cv.toBlob(r, "image/png"));
    const image = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
    return { image, prompt: characterPrompt(chars), names: chars.map(c => c.name) };
  }

  // ------------------------------------------------------------------ projects
  async function projView(p) {
    const cover = p.cover_asset && await getAsset(p.cover_asset);
    return { ...p, data: p.data || {}, archived: !!p.archived, deleted: !!p.deleted, characters: p.characters || [], asset_ids: p.asset_ids || [], cover_url: cover ? await blobUrl(cover.id) : "" };
  }
  const listProjects = async q => ({ items: await Promise.all((await D.all("projects")).filter(p => !!p.archived === (q.archived === "1") && !!p.deleted === (q.deleted === "1")).sort((a, b) => b.updated - a.updated).map(projView)) });
  const getProject = async id => { const p = id ? await D.get("projects", id) : null; return p ? projView(p) : null; };
  async function saveProject(b) {
    const name = clean(b.name, 120);
    if (!name) throw bad("Please give the project a name.");
    const old = b.id ? await D.get("projects", b.id) : null;
    const p = { ...(old || { id: D.uid(), created: now(), parent_id: "", version: 1, archived: 0, deleted: 0, characters: [], asset_ids: [] }),
      name, description: clean(b.description), folder: clean(b.folder, 80), aspect: clean(b.aspect, 10) || "16:9", resolution: clean(b.resolution, 12) || "1344x768",
      duration: Math.max(1, Math.min(parseInt(b.duration || 60, 10) || 60, 3600)), story: clean(b.story, 20000), cover_asset: clean(b.cover_asset, 20),
      data: b.data && typeof b.data === "object" ? b.data : (old?.data || {}), updated: now() };
    if ("characters" in b) { p.characters = []; for (const c of b.characters || []) if (await getCharacter(c)) p.characters.push(c); }
    if ("asset_ids" in b) { p.asset_ids = []; for (const a of b.asset_ids || []) if (await getAsset(a)) p.asset_ids.push(a); }
    await D.put("projects", p);
    return projView(p);
  }
  async function projectAction(id, action) {
    const p = await D.get("projects", id);
    if (!p) throw bad("Project not found.");
    const set = async ch => { Object.assign(p, ch, { updated: now() }); await D.put("projects", p); return projView(p); };
    if (action === "archive") return set({ archived: 1 });
    if (action === "unarchive") return set({ archived: 0 });
    if (action === "delete") return set({ deleted: 1 });
    if (action === "restore") return set({ deleted: 0 });
    if (action === "duplicate" || action === "new_version") {
      const copy = await saveProject({ ...p, id: null, name: p.name + (action === "duplicate" ? " (copy)" : ` v${p.version + 1}`), characters: p.characters, asset_ids: p.asset_ids });
      const n = await D.get("projects", copy.id); n.parent_id = id; n.version = action === "new_version" ? p.version + 1 : 1; await D.put("projects", n);
      return projView(n);
    }
    throw bad("Unknown action.");
  }

  // ------------------------------------------------------------------ Director presets (prompt wording, never guaranteed camera control)
  const PRESETS = {
    camera: ["Camera movement", { locked: ["Locked camera", "locked-off static camera, no camera movement"], dolly_in: ["Dolly in", "slow smooth dolly-in toward the subject"],
      dolly_out: ["Dolly out", "slow smooth dolly-out away from the subject"], tracking: ["Tracking shot", "smooth tracking shot following the subject"],
      orbit: ["Orbit", "camera slowly orbits around the subject"], crane_up: ["Crane up", "camera cranes upward, rising above the scene"],
      crane_down: ["Crane down", "camera cranes downward toward the subject"], aerial: ["Aerial", "aerial drone shot moving over the scene"],
      handheld: ["Handheld", "natural gentle handheld camera"], pan: ["Slow pan", "slow horizontal pan across the scene"] }],
    shot: ["Shot type", { wide: ["Wide establishing", "wide establishing shot showing the whole location"], medium: ["Medium shot", "medium shot, subjects framed from the waist up"],
      close: ["Close-up", "close-up on the faces"], ots: ["Over-the-shoulder", "over-the-shoulder shot"], low: ["Low-angle hero", "low-angle hero shot looking up at the subject"],
      behind: ["From behind", "shot from behind the subjects looking where they look"] }],
    subject: ["Subject movement", { still: ["Mostly still", "subjects stay mostly still with small natural movements"], walk: ["Walking", "subjects walk slowly and naturally"],
      turn: ["Turning to look", "subjects turn their heads and look with curiosity"], reach: ["Reaching out", "subjects gently reach out toward something"],
      kneel: ["Kneeling / crouching", "subjects kneel or crouch down to look closely"] }],
    lighting: ["Lighting", { golden: ["Golden hour", "warm golden-hour sunlight"], window: ["Soft window light", "soft natural window light"], lamp: ["Night lamp", "warm cozy lamp light at night"],
      magic: ["Magical glow", "magical golden glow lighting the faces"], overcast: ["Overcast", "soft overcast daylight"], dramatic: ["Dramatic", "dramatic high-contrast lighting"] }],
    mood: ["Cinematic mood", { wonder: ["Wonder", "sense of wonder and discovery"], cozy: ["Cozy", "cozy, safe and warm atmosphere"], adventure: ["Adventure", "adventurous and exciting but child-friendly"],
      emotional: ["Emotional", "tender emotional atmosphere"], playful: ["Playful", "light playful happy atmosphere"] }],
    lens: ["Lens look", { "24": ["24 mm wide", "24mm wide-angle lens look"], "35": ["35 mm", "35mm cinematic lens look"], "50": ["50 mm", "50mm natural lens look"],
      "85": ["85 mm portrait", "85mm portrait lens look with compressed background"], anamorphic: ["Anamorphic", "anamorphic lens look with soft horizontal flares"] }],
    dof: ["Depth of field", { shallow: ["Shallow", "shallow depth of field with a softly blurred background"], deep: ["Deep", "deep focus, everything sharp"] }],
  };
  const directorPresets = () => Object.fromEntries(Object.entries(PRESETS).map(([k, [label, items]]) => [k, { label, items: Object.entries(items).map(([id, v]) => ({ id, label: v[0], text: v[1] })) }]));
  const directorPhrases = sel => { const out = []; for (const [g, [, items]] of Object.entries(PRESETS)) { const it = items[(sel || {})[g]]; if (it) out.push(it[1]); } return out.length ? out.join(", ") + "." : ""; };

  // ------------------------------------------------------------------ scenes
  const TEXT = ["title", "purpose", "location", "time_of_day", "lighting", "props", "action", "camera", "dialogue", "sfx", "music"];
  const STATUS = ["draft", "keyframe_generating", "keyframe_ready", "queued", "generating", "done", "failed", "cancelled"];
  async function sceneView(s) {
    const o = { ...s, characters: s.characters || [], settings: s.settings || {} };
    for (const k of ["start_asset", "end_asset", "video_asset"]) o[k + "_url"] = s[k] && await getAsset(s[k]) ? await blobUrl(s[k]) : "";
    return o;
  }
  const rawScenes = async pid => (await D.all("scenes")).filter(s => s.project_id === pid).sort((a, b) => a.position - b.position || a.created - b.created);
  const listScenes = async pid => Promise.all((await rawScenes(pid)).map(sceneView));
  const getScene = async id => { const s = id ? await D.get("scenes", id) : null; return s ? sceneView(s) : null; };
  async function saveScene(b) {
    const old = b.id ? await D.get("scenes", b.id) : null;
    const pid = old ? old.project_id : clean(b.project_id, 20);
    if (!await getProject(pid)) throw bad("Project not found.");
    const g = (k, d = "") => (k in b ? b[k] : old ? old[k] : d);
    const s = { ...(old || { id: D.uid(), project_id: pid, created: now(), position: (await rawScenes(pid)).reduce((m, x) => Math.max(m, x.position), -1) + 1 }) };
    for (const k of TEXT) s[k] = clean(g(k), 3000);
    s.duration = Math.max(2, Math.min(parseInt(g("duration", 6), 10) || 6, 60));
    s.characters = []; for (const c of g("characters", [])) if (await getCharacter(c) && s.characters.length < 6) s.characters.push(c);
    for (const k of ["start_asset", "end_asset", "video_asset"]) { const v = g(k); s[k] = v === "" || await getAsset(v) ? v : ""; }
    s.chain_prev = g("chain_prev", 0) ? 1 : 0;
    s.model = clean(g("model", "minimax_h3"), 40) || "minimax_h3";
    s.status = STATUS.includes(g("status", "draft")) ? g("status", "draft") : "draft";
    s.job_id = clean(g("job_id"), 80); s.error = clean(g("error"), 500);
    s.settings = b.settings && typeof b.settings === "object" ? b.settings : (old?.settings || {});
    s.updated = now();
    await D.put("scenes", s);
    return sceneView(s);
  }
  const deleteScene = id => D.del("scenes", id);
  async function reorderScenes(pid, ids) {
    for (const [i, id] of (ids || []).entries()) { const s = await D.get("scenes", id); if (s && s.project_id === pid) { s.position = i; await D.put("scenes", s); } }
    return listScenes(pid);
  }
  async function duplicateScene(id) {
    const s = await getScene(id);
    if (!s) throw bad("Scene not found.");
    const n = await saveScene({ ...s, id: null, title: (s.title || "Scene") + " (copy)", status: "draft", job_id: "", video_asset: "", error: "" });
    const order = (await rawScenes(s.project_id)).map(x => x.id).filter(x => x !== n.id);
    order.splice(order.indexOf(id) + 1, 0, n.id);
    await reorderScenes(s.project_id, order);
    return getScene(n.id);
  }
  async function scenePrompt(id) {
    const s = await getScene(id);
    if (!s) throw bad("Scene not found.");
    const all = await rawScenes(s.project_id), i = all.findIndex(x => x.id === id), prev = i > 0 ? all[i - 1] : null;
    const chars = (await Promise.all(s.characters.map(getCharacter))).filter(Boolean);
    const parts = [];
    if (chars.length) parts.push(characterPrompt(chars));
    const setting = [s.location, s.time_of_day, s.lighting].filter(Boolean).join(", ");
    if (setting) parts.push("Setting: " + setting + ".");
    if (s.props) parts.push("Props: " + s.props + ".");
    if (prev && (prev.action || prev.title)) parts.push("Previously: " + (prev.action || prev.title).replace(/\.$/, "") + ". Keep the same clothes, props and lighting.");
    if (s.action) parts.push(s.action.replace(/\.$/, "") + ".");
    const proj = await getProject(s.project_id);
    const look = directorPhrases({ ...(proj?.data?.director || {}), ...(s.settings?.director || {}) });
    if (look) parts.push("Cinematography: " + look);
    if (s.camera) parts.push("Camera: " + s.camera + ".");
    if (s.dialogue) parts.push("Dialogue: " + s.dialogue);
    const sound = [s.sfx && "Sound effects: " + s.sfx, s.music && "Music: " + s.music].filter(Boolean).join(". ");
    if (sound) parts.push(sound + ".");
    // image-to-video prompt: visible action first, characters by name only (faces are in the start frame), nothing else may happen
    const v = [];
    if (s.action) v.push("Visible action: " + s.action.replace(/\.$/, "") + ".");
    if (chars.length) v.push("Characters (exactly as in the first frame): " + chars.map(c => c.name).join(", ") + ".");
    const cine = [look.replace(/\.$/, ""), s.camera].filter(Boolean).join(", ");
    if (cine) v.push("Camera and look: " + cine + ".");
    if (setting) v.push("Setting: " + setting + ".");
    if (s.dialogue) v.push("Dialogue: " + s.dialogue);
    if (sound) v.push(sound + ".");
    v.push("Only this action happens, with slow natural movement. Same room, same clothes, no new people, no scene change.");
    return { prompt: parts.join(" "), video_prompt: v.join(" "), scene_text: parts.filter(p => !p.startsWith("The reference")).join(" "), characters: chars.map(c => c.id) };
  }
  const BEATS = [["Introduction", "Meet the heroes in their everyday world."], ["Main characters", "Show who they are and what they love."], ["Inciting incident", "Something unexpected disturbs their world."],
    ["Objective", "They decide what they must do."], ["Conflict", "An obstacle blocks the way."], ["Character actions", "They work together, each using their strength."],
    ["Resolution", "The problem is solved."], ["Ending", "A warm closing moment that hints at more."]];
  async function planScenes(pid, idea, seconds, clip, characters) {
    const n = Math.max(2, Math.round(parseInt(seconds, 10) / parseInt(clip, 10))), made = [];
    for (let i = 0; i < n; i++) {
      const [beat, desc] = BEATS[Math.round(i * (BEATS.length - 1) / (n - 1))];
      made.push(await saveScene({ project_id: pid, title: `${i + 1}. ${beat}`, purpose: desc, duration: clip, action: (i === 0 && (idea || "").trim() ? idea.trim() + " — " : "") + desc, characters: characters || [] }));
    }
    return made;
  }
  async function importScenes(pid, items, replace) {
    if (replace) for (const s of await rawScenes(pid)) await deleteScene(s.id);
    const out = [];
    for (const it of (items || []).slice(0, 200)) if (it && typeof it === "object") out.push(await saveScene({ ...Object.fromEntries(TEXT.map(k => [k, it[k] || ""])), duration: it.duration || 6, project_id: pid, characters: it.characters || [] }));
    return out;
  }

  // ------------------------------------------------------------------ workflows (saved step lists)
  const STEP_TYPES = {
    plan: { label: "Plan scenes from the story", gpu: false, defaults: { seconds: 30, clip: 6 } },
    keyframes: { label: "Make start frames from the characters", gpu: true, defaults: {} },
    approve: { label: "Pause for storyboard approval", gpu: false, defaults: {} },
    videos: { label: "Make scene videos (chained)", gpu: true, defaults: {} },
    enhance: { label: "Enhance scene videos to 1080p (SeedVR2)", gpu: true, defaults: {} },
    timeline: { label: "Fill the timeline from scene videos", gpu: false, defaults: {} },
    audio: { label: "Generate audio and add it to the timeline", gpu: true, defaults: { kind: "music", prompt: "", seconds: 30, volume: 0.25 } },
    export: { label: "Export MP4", gpu: false, defaults: { resolution: "source" } },
  };
  const BUILTIN = [
    ["Short movie", "Idea → scenes → start frames → approval → videos → timeline → music → export.", [["plan", { seconds: 30, clip: 6 }], ["keyframes", {}], ["approve", {}], ["videos", {}], ["timeline", {}],
      ["audio", { kind: "music", prompt: "gentle warm orchestral children's adventure music, soft and magical", seconds: 30, volume: 0.2 }], ["export", { resolution: "source" }]]],
    ["Character consistency", "Reference photos of the selected characters → start frame for every scene. No video yet.", [["keyframes", {}]]],
    ["Video enhancement", "Upscale every finished scene video to 1080p (clips up to ~7 MB), then rebuild the timeline and export in 1080p.", [["enhance", {}], ["timeline", {}], ["export", { resolution: "hd" }]]],
    ["Image to video", "Scenes that already have a start frame → videos → timeline → export.", [["approve", {}], ["videos", {}], ["timeline", {}], ["export", { resolution: "source" }]]],
  ];
  async function listWorkflows() {
    let all = await D.all("workflows");
    const have = new Set(all.filter(w => w.builtin).map(w => w.name));
    for (const [name, description, steps] of BUILTIN) if (!have.has(name)) await D.put("workflows", { id: D.uid(), name, description, steps: steps.map(([type, config]) => ({ type, config })), builtin: true, created: now(), updated: now() });
    all = (await D.all("workflows")).sort((a, b) => (b.builtin - a.builtin) || a.name.localeCompare(b.name));
    return { items: all, types: STEP_TYPES };
  }
  const cleanSteps = steps => (steps || []).slice(0, 30).filter(s => STEP_TYPES[s.type]).map(s => {
    const d = STEP_TYPES[s.type].defaults, cfg = {};
    for (const k of Object.keys(d)) cfg[k] = k in (s.config || {}) ? (typeof s.config[k] === "string" ? clean(s.config[k], 400) : s.config[k]) : d[k];
    return { type: s.type, config: cfg };
  });
  async function saveWorkflow(b) {
    const name = clean(b.name, 80);
    if (!name) throw bad("Give the workflow a name.");
    const old = b.id ? await D.get("workflows", b.id) : null;
    if (old?.builtin) throw bad("Built-in workflows can't be edited. Duplicate it first.");
    const w = { ...(old || { id: D.uid(), builtin: false, created: now() }), name, description: clean(b.description, 400), steps: cleanSteps(b.steps), updated: now() };
    await D.put("workflows", w); return w;
  }

  // ------------------------------------------------------------------ models registry (what each tool can do; "last worked" comes from this device's job log)
  const MODELS = [
    { tool: "minimax_h3", name: "MiniMax-H3", kind: "Video with sound", modes: ["Text → video", "Image → video (first frame)", "First + last frame → video", "Sound generated with the video (stereo, 24 fps)"],
      limits: "2-15 s per clip, up to 1920 px, quality fast (4 steps) / high (8). Start frame must be sharp.", not_supported: ["Reference images (character identity comes only from the start frame)", "Video continuation / extension", "Video → video", "Camera path control (prompt wording only)"], files: ["minimax_h3 (int8)", "qwen3vl 32B text encoder", "video + audio VAE", "turbo 4/8-step LoRAs"] },
    { tool: "qwen_image", name: "Qwen-Image 2.1 (create)", kind: "Image", modes: ["Text → image", "Turbo 8-step option"], limits: "256-2048 px.", not_supported: ["Reference images"], files: ["qwen_image_2.1"] },
    { tool: "qwen_edit", name: "Qwen-Image 2.1 (edit)", kind: "Image", modes: ["Image edit with ONE reference picture", "Character board: up to 4 characters side by side in one reference"], limits: "One reference image per job (the board is how several characters are used).",
      not_supported: ["Several separate reference images", "Face-embedding identity (IP-Adapter / InstantID / LoRA not installed)"], files: ["qwen_image_2.1"] },
    { tool: "wan_i2v", name: "Wan 2.2 A14B image → video", kind: "Video (silent)", modes: ["Image → video (4-step)"], limits: "Silent video.", not_supported: ["Sound", "Text-only video"], files: ["wan2.2 i2v high/low noise", "lightx2v 4-step LoRAs"] },
    { tool: "wan_animate", name: "Wan 2.2 Animate", kind: "Character animation", modes: ["Animate a character image from a motion video (pose)"], limits: "Needs a motion video.", not_supported: [], files: ["wan2.2 animate 14B"] },
    { tool: "talking_avatar", name: "InfiniteTalk avatar", kind: "Audio-driven video", modes: ["Photo + speech audio → talking video"], limits: "480p base model.", not_supported: [], files: ["wan2.1 infiniteTalk"] },
    { tool: "f5_voice", name: "F5-TTS", kind: "Voice", modes: ["Voice cloning from a 5-15 s sample"], limits: "English and Chinese only.", not_supported: ["Arabic"], files: ["F5TTS_v1_Base"] },
    { tool: "stable_audio", name: "Stable Audio Open 1.0", kind: "Sound / music", modes: ["Text → sound effect, ambience, short music"], limits: "Up to 47 s per clip; not full songs.", not_supported: ["Speech"], files: ["stable-audio-open-1.0"] },
    { tool: "seedvr2_upscale", name: "SeedVR2 3B", kind: "Upscale", modes: ["Image upscale", "Video upscale (short clips, ≤ about 7 MB)"], limits: "RunPod job input is limited to about 10 MB.", not_supported: [], files: ["seedvr2 3B"] },
    { tool: "trellis_3d", name: "TRELLIS.2", kind: "3D", modes: ["Image → 3D model"], limits: "Results limited to about 20 MB.", not_supported: [], files: ["TRELLIS.2"] },
    { tool: "hy_motion", name: "HY-Motion 1.0", kind: "3D motion", modes: ["Text → 3D character motion"], limits: "", not_supported: [], files: ["HY-Motion 1.0"] },
  ];
  async function models() {
    const log = await D.all("joblog"), last = {};
    for (const r of log) if (r.status === "COMPLETED" && r.files?.length && (!last[r.tool] || r.finished > last[r.tool].finished)) last[r.tool] = r;
    return { items: MODELS.map(m => ({ ...m, last_ok: last[m.tool]?.finished || null, last_ok_gpu_seconds: last[m.tool]?.gpu_seconds || null })), retired: ["LTX-2 19B (video+audio)", "FLUX.2 Klein", "Hunyuan3D 2.1"],
      note: "'Last worked' comes from real jobs recorded on this device. Tools without a date have no recorded job here yet; their files are only configured, not verified." };
  }

  // ------------------------------------------------------------------ timeline (stored in the project's data)
  async function cleanTimeline(tl) {
    const out = { clips: [], audio: [], texts: [] }, rid = v => String(v || D.uid()).slice(0, 16);
    for (const c of (tl.clips || []).slice(0, 200)) {
      const a = await getAsset(c.asset_id); if (!a || a.type !== "video" && !a.mime.startsWith("video/")) continue;
      const d = (await probe(a)).duration, i = clamp(c.in, 0, 0, d - 0.1), o = clamp(c.out, d, i + 0.1, d);
      out.clips.push({ id: rid(c.id), asset_id: a.id, in: +i.toFixed(3), out: +o.toFixed(3), fade_in: clamp(c.fade_in, 0, 0, 5), fade_out: clamp(c.fade_out, 0, 0, 5), transition: clamp(c.transition, 0, 0, 3), volume: clamp(c.volume, 1, 0, 3) });
    }
    for (const c of (tl.audio || []).slice(0, 50)) {
      const a = await getAsset(c.asset_id); if (!a || !(a.mime.startsWith("audio/") || a.mime.startsWith("video/"))) continue;
      const d = (await probe(a)).duration, i = clamp(c.in, 0, 0, d - 0.1);
      out.audio.push({ id: rid(c.id), asset_id: a.id, start: clamp(c.start, 0, 0, 36000), in: +i.toFixed(3), out: +clamp(c.out, d, i + 0.1, d).toFixed(3), volume: clamp(c.volume, 1, 0, 3), fade_in: clamp(c.fade_in, 0, 0, 30), fade_out: clamp(c.fade_out, 0, 0, 30), kind: ["music", "sfx", "voice"].includes(c.kind) ? c.kind : "music" });
    }
    for (const t of (tl.texts || []).slice(0, 100)) {
      const text = clean(t.text, 300); if (!text) continue;
      out.texts.push({ id: rid(t.id), text, start: clamp(t.start, 0, 0, 36000), dur: clamp(t.dur, 3, 0.2, 600), pos: ["top", "center", "bottom"].includes(t.pos) ? t.pos : "bottom", size: Math.round(clamp(t.size, 44, 12, 200)),
        color: ["white", "yellow", "black", "red", "cyan"].includes(t.color) ? t.color : "white", kind: t.kind === "subtitle" ? "subtitle" : "text" });
    }
    return out;
  }
  async function getTimeline(pid) {
    const p = await D.get("projects", pid);
    if (!p) throw bad("Project not found.");
    const tl = JSON.parse(JSON.stringify(p.data?.timeline || { clips: [], audio: [], texts: [] }));
    for (const c of [...tl.clips, ...tl.audio]) { const a = await getAsset(c.asset_id); c.url = a ? await blobUrl(a.id) : ""; c.name = a ? a.filename : "(missing)"; c.duration = a ? (await probe(a)).duration : 0; }
    return tl;
  }
  async function saveTimeline(pid, tl) {
    const p = await D.get("projects", pid);
    if (!p) throw bad("Project not found.");
    p.data = { ...(p.data || {}), timeline: await cleanTimeline(tl || {}) }; p.updated = now(); await D.put("projects", p);
    return getTimeline(pid);
  }
  async function timelineFromScenes(pid, replace = true) {
    const tl = replace ? { clips: [], audio: [], texts: [] } : await getTimeline(pid), have = new Set(tl.clips.map(c => c.asset_id));
    for (const sc of await rawScenes(pid)) if (sc.video_asset && !have.has(sc.video_asset)) { const a = await getAsset(sc.video_asset); if (a) tl.clips.push({ asset_id: a.id, in: 0, out: (await probe(a)).duration, transition: 0 }); }
    return saveTimeline(pid, tl);
  }

  // ------------------------------------------------------------------ outputs from jobs -> library, last frame
  async function register(file) {
    const name = String(file).split("/").pop(), o = await D.get("outputs", name);
    if (!o) throw bad("Result file not found.");
    return addAsset(o.name, o.blob, { tags: ["generated"] });
  }
  async function lastFrame(assetId) {
    const a = await getAsset(assetId);
    if (!a || !a.mime.startsWith("video/")) throw bad("That asset is not a video.");
    const v = document.createElement("video"); v.muted = true; v.preload = "auto"; v.playsInline = true;
    const url = URL.createObjectURL(await getBlob(a.id));
    try {
      await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(bad("Could not read the video.")); v.src = url; });
      await new Promise(res => { v.onseeked = res; v.currentTime = Math.max(0, v.duration - 0.12); });
      const cv = document.createElement("canvas"); cv.width = v.videoWidth; cv.height = v.videoHeight; cv.getContext("2d").drawImage(v, 0, 0);
      const blob = await new Promise(r => cv.toBlob(r, "image/png"));
      return addAsset("lastframe_" + a.filename.replace(/\.[^.]+$/, "") + ".png", blob, { tags: ["last-frame"] });
    } finally { URL.revokeObjectURL(url); }
  }

  // ------------------------------------------------------------------ router
  async function route(method, parts, q, body) {
    const [kind, ...rest] = parts;
    const json = body || {};
    switch (kind) {
      case "projects":
        if (method === "GET") return rest.length ? getProject(rest[0]) : listProjects(q);
        if (rest.length === 2) return projectAction(rest[0], rest[1]);
        return saveProject(json);
      case "characters":
        if (method === "GET") return rest.length ? getCharacter(rest[0]) : listCharacters();
        if (rest.length === 2 && rest[1] === "delete") { await deleteCharacter(rest[0]); return { ok: true }; }
        return saveCharacter(json);
      case "assets":
        if (method === "GET") return listAssets(q);
        if (rest.length) return updateAsset(rest[0], json);
        return addAsset(json.filename, await dataUrlToBlob(json.data || ""), { type: json.type, tags: json.tags, folder: json.folder });
      case "scenes":
        if (method === "GET") return !rest.length ? { items: await listScenes(q.project) } : rest[rest.length - 1] === "prompt" ? scenePrompt(rest[0]) : getScene(rest[0]);
        if (rest[0] === "reorder") return { items: await reorderScenes(json.project, json.ids) };
        if (rest[0] === "plan") return { items: await planScenes(json.project, json.idea || "", json.seconds || 60, json.clip || 6, json.characters) };
        if (rest[0] === "import") return { items: await importScenes(json.project, json.scenes, !!json.replace) };
        if (rest.length === 2 && rest[1] === "delete") { await deleteScene(rest[0]); return { ok: true }; }
        if (rest.length === 2 && rest[1] === "duplicate") return duplicateScene(rest[0]);
        return saveScene(json);
      case "board": return buildBoard(json.characters, json.width, json.height);
      case "characters_prompt": { const cs = (await Promise.all((json.characters || []).map(getCharacter))).filter(Boolean); return { prompt: cs.length ? characterPrompt(cs) : "", names: cs.map(c => c.name) }; }
      case "register": return register(json.file);
      case "lastframe": return lastFrame(json.asset_id);
      case "director": return directorPresets();
      case "workflows":
        if (method === "GET") return listWorkflows();
        if (rest.length === 2 && rest[1] === "delete") { const w = await D.get("workflows", rest[0]); if (w?.builtin) throw bad("Built-in workflows can't be deleted."); await D.del("workflows", rest[0]); return { ok: true }; }
        if (rest.length === 2 && rest[1] === "duplicate") { const w = await D.get("workflows", rest[0]); if (!w) throw bad("Workflow not found."); return saveWorkflow({ name: w.name + " (copy)", description: w.description, steps: w.steps }); }
        return saveWorkflow(json);
      case "models": return models();
      case "storage": { const e = await navigator.storage?.estimate?.() || {}; return { data_mb: Math.round((e.usage || 0) / 1048576), outputs_mb: 0, quota_mb: Math.round((e.quota || 0) / 1048576) }; }
      case "timeline":
        if (method === "GET") return getTimeline(q.project);
        if (rest[0] === "from_scenes") return timelineFromScenes(json.project, json.replace !== false);
        return saveTimeline(json.project, json.timeline);
      case "local_ai": {
        const sub = !!window.StudioSubtitles;
        return { subtitles: { available: sub, install: "Speech-to-text could not be loaded in this browser. The PC version of AI Studio can do it.",
            note: "This exports the movie, then listens to its sound on this device to write subtitles. The first time it downloads a speech model (about 80 MB for Fast, about 250 MB for Better), which your browser then keeps. The sound never leaves this device. Continue?" },
          identity: { available: false, install: "Face checks need the PC version of AI Studio." } };
      }
      case "subtitles":
        if (!window.StudioSubtitles) throw bad("Speech-to-text is not available in this browser.");
        return method === "GET" ? window.StudioSubtitles.status(rest[0]) : window.StudioSubtitles.start(json);
      case "identity": throw bad("Face checks need the PC version of AI Studio.");
      default: return undefined;
    }
  }
  const outputUrl = async f => { const o = await D.get("outputs", String(f).split("/").pop()); return o ? URL.createObjectURL(o.blob) : ""; };
  window.StudioBackend = { outputUrl, route, getAsset, getBlob, blobUrl, probe, addAsset, getProject, getTimeline, rawScenes, clean, bad };
})();
