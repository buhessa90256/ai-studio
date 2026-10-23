// Chat connector sync: what you make in the mobile chat (ChatGPT / Claude through the AI Studio connector) shows up in this app.
// The chat gives you a link once (tool "open_in_studio_app"); it holds a READ-ONLY token for your own connector and is kept only on this device.
// Sync copies characters (with their reference pictures), movies as projects with their scenes, start frames, scene videos and the finished movie
// into this device's Studio storage. Nothing is ever sent back to the connector, and local edits are never overwritten except the scene pictures/videos
// that came from the chat.
"use strict";
(() => {
  const KEY = "connector_url", DONE_REFS = "connector_refs";
  const ok = u => /^https:\/\/[^\s/]+\/ro\/[A-Za-z0-9]{20,}$/.test(u) || /^http:\/\/(127\.0\.0\.1|localhost):\d+\/ro\/[A-Za-z0-9]{20,}$/.test(u);
  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: k => { try { localStorage.removeItem(k); } catch {} } };

  try {  // a link from the chat: ...?connector=<address>
    const u = new URL(location.href), c = u.searchParams.get("connector");
    const a = u.searchParams.get("act");
    if (c) { if (ok(c)) store.set(KEY, c); if (a && /^https:\/\/[^\s/]+\/act\/[A-Za-z0-9]{20,}$|^http:\/\/(127\.0\.0\.1|localhost):\d+\/act\/[A-Za-z0-9]{20,}$/.test(a)) store.set("connector_act", a); else store.del("connector_act"); u.searchParams.delete("connector"); u.searchParams.delete("act"); history.replaceState(null, "", u.pathname + (u.search || "") + u.hash); }
  } catch {}

  const wait = setInterval(() => {  // the Studio screens (window.SP) load after this file
    if (window.SP && window.StudioBackend && document.getElementById("studio-main")) { clearInterval(wait); start(); }
  }, 300);

  function start() {
    const { api, h, fileB64 } = window.SP;
    let busy = false, last = Number(store.get("connector_last") || 0);
    const bar = h("div", { id: "chat-sync", style: "display:none;margin:0 0 10px;padding:8px 12px;border:1px solid var(--line);border-radius:10px;font-size:13px;align-items:center;gap:10px;flex-wrap:wrap" });
    document.getElementById("studio-main").prepend(bar);
    const text = h("span", { style: "flex:1;min-width:160px" });
    const syncBtn = h("button", { class: "sp-btn", type: "button", onclick: () => run(true) }, "Sync now");
    const offBtn = h("button", { class: "sp-btn", type: "button", onclick: () => { if (confirm("Disconnect this app from the chat connector? Items already copied stay.")) { store.del(KEY); draw(); } } }, "Disconnect");
    const connBtn = h("button", { class: "sp-btn pri", type: "button", onclick: () => { const v = (prompt("Paste the link the chat gave you (say \"open in studio app\" in the chat):") || "").trim(); const c = (v.match(/connector=([^&\s]+)/) || [])[1]; const a = c ? decodeURIComponent(c) : v; if (ok(a)) { store.set(KEY, a); draw(); run(true); } else if (v) alert("That is not a connector link."); } }, "Connect to chat");
    bar.append(h("b", {}, "💬 Chat"), text, syncBtn, offBtn, connBtn);
    function draw(msg) {
      const on = !!store.get(KEY);
      bar.style.display = "flex"; syncBtn.style.display = offBtn.style.display = on ? "" : "none"; connBtn.style.display = on ? "none" : "";
      text.textContent = msg || (on ? (last ? "Connected to your chat. Last synced " + ago(last) + "." : "Connected to your chat.") : "Not connected. Say \"open in studio app\" in your chat and open the link on this phone.");
    }
    const ago = t => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : Math.round(s / 3600) + " h ago"; };

    const base = () => store.get(KEY);
    const getJ = async p => { const r = await fetch(base() + p + (p.includes("?") ? "&" : "?") + "_=" + Date.now(), { cache: "no-store", credentials: "omit" }); const j = await r.json().catch(() => ({})); if (r.status === 404 || r.status === 401) throw new Error("This link is no longer valid (the connector's secret was changed). Say “open in studio app” in your chat and open the new link on this phone."); if (!r.ok) throw new Error(j.error || "connector answered " + r.status); return j; };
    const download = async u => { const r = await fetch(u); if (!r.ok) throw new Error("download " + r.status); return r.blob(); };
    const addAsset = async (name, blob, type, tags) => api("assets", { filename: name, data: await fileB64(blob), type, tags });
    const slug = s => String(s || "x").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
    const ROLE = { face: "face", full_body_front: "body", full_body_side: "body", full_body_back: "body", three_quarter: "profile", turnaround: "body", expression_sheet: "expression", outfit: "costume", action_pose: "pose" };
    let doneRefs; try { doneRefs = new Set(JSON.parse(store.get(DONE_REFS) || "[]")); } catch { doneRefs = new Set(); }
    let changed = 0;
    const HIDDEN = {};   // chat movies whose project was deleted on THIS phone: they are never recreated behind the user's back, but the app now says so and offers a restore
    const publishHidden = () => { const was = JSON.stringify((window.APP && APP.hiddenChat) || []), now = Object.values(HIDDEN); if (window.APP) { APP.hiddenChat = now; if (was !== JSON.stringify(now) && APP.emit) APP.emit("hidden-chat", now); } };

    async function syncCharacters() {
      const { characters } = await getJ("/characters");
      const local = (await api("characters")).items;
      for (const c of characters || []) {
        if (!c) continue;
        let lc = local.find(x => x.name.toLowerCase() === c.character.toLowerCase());
        const refs = [];
        for (const r of (c.references || []).filter(x => x.status === "ok" || x.status === undefined).slice(0, 10)) {
          const id = c.slug + "/" + r.ref_id;
          if (doneRefs.has(id) && lc) continue;
          try {
            const a = await addAsset(`${slug(c.character)}_${r.type}.png`, await download(r.original_url), "character", ["from chat"]);
            refs.push({ asset_id: a.id, role: r.preferred && r.type === "face" ? "primary" : (ROLE[r.type] || "other"), label: r.label || r.type_label || "" });
            doneRefs.add(id);
          } catch (e) { console.warn("reference skipped", e); }
        }
        if (!lc) {
          if (!refs.length) continue;
          if (!refs.some(r => r.role === "primary")) { const f = refs.find(r => r.role === "face") || refs[0]; f.role = "primary"; }
          await api("characters", { name: c.character, kind: c.kind || "human", description: c.description || "", age: c.age || "", hair: c.hair || "", eyes: c.eyes || "", voice: c.voice || "", refs });
          changed++;
        } else if (refs.length) {
          const have = new Set((lc.refs || []).map(r => r.asset.id));
          const add = refs.filter(r => !have.has(r.asset_id));
          if (add.length) { await api("characters", { id: lc.id, name: lc.name, kind: lc.kind, description: lc.description, age: lc.age, hair: lc.hair, eyes: lc.eyes, voice: lc.voice, costumes: lc.costumes,
            refs: [...(lc.refs || []).map(r => ({ asset_id: r.asset.id, role: r.role, label: r.label })), ...add] }); changed++; }
        }
      }
      store.set(DONE_REFS, JSON.stringify([...doneRefs].slice(-400)));
    }

    const STATE = { video_done: "done", video_generating: "generating", frame_generating: "keyframe_generating", frame_waiting: "keyframe_generating", frame_awaiting_approval: "keyframe_ready",
      frame_rejected: "keyframe_ready", frame_done: "keyframe_ready", video_waiting: "queued", failed: "failed", frame_awaiting_import: "draft" };
    async function syncMovie(m, localChars) {
      const d = await getJ("/movie?id=" + encodeURIComponent(m.id));
      if (d.error || !d.scenes) return;
      const aspect = d.aspect || "16:9";
      const projects = (await api("projects")).items;
      let p = projects.find(x => x.data && x.data.connector_id === d.movie_id);
      const gone = p ? null : ((await api("projects?deleted=1")).items || []).find(x => x.data && x.data.connector_id === d.movie_id);
      if (gone) { HIDDEN[d.movie_id] = { id: d.movie_id, title: d.title, localId: gone.id, status: d.status }; return; }   // deleted by the user: stays deleted until they restore it
      delete HIDDEN[d.movie_id];
      const data = { ...(p ? p.data : {}), connector_id: d.movie_id, connector_status: d.status, connector_step: d.current_step || "", connector_import_mode: d.import_mode || "", connector_workflow: d.workflow ? { stage: d.workflow.stage, next: d.workflow.next_step, overview: d.workflow.storyboard, approved: d.workflow.scenes_approved, video: d.workflow.video } : null };
      if (!p) { p = await api("projects", { name: "Chat: " + d.title, aspect, resolution: aspect === "9:16" ? "768x1344" : aspect === "1:1" ? "1024x1024" : "1344x768", description: "Made in the chat connector", data, folder: "From chat" }); changed++; }
      else if (p.data.connector_status !== d.status || p.data.connector_step !== data.connector_step || (p.data.connector_import_mode || "") !== data.connector_import_mode || JSON.stringify(p.data.connector_workflow || null) !== JSON.stringify(data.connector_workflow)) { await api("projects", { id: p.id, name: p.name, aspect: p.aspect, data }); changed++; }
      const scenes = (await api("scenes?project=" + p.id)).items;
      for (const s of d.scenes) {
        const ls = scenes.find(x => x.settings && x.settings.cn === s.scene_number);
        const settings = { ...(ls ? ls.settings : {}), cm: d.movie_id, cn: s.scene_number, cstate: s.state,
          cidentity: s.identity ? { overall: s.identity.overall, chars: Object.fromEntries(Object.entries(s.identity.characters || {}).map(([n, v]) => [n, { score: v.score, verdict: v.verdict }])) } : null,
          cattempts: (s.frame_attempts || []).map(a => ({ n: a.attempt, method: a.method, verdict: a.verdict, reasons: a.reasons || [] })),
          cwarn: s.frame_warning || "", csource: s.frame_source || "", cmeta: s.frame_meta || null, csb: s.storyboard || null, cversions: (s.frame_versions || []).map(x => ({ v: x.version, url: x.url })) };
        const lastTry = (s.frame_attempts || []).slice(-1)[0];
        settings.cflags = lastTry && lastTry.verdict !== "pass" ? (lastTry.reasons || []).slice(0, 4) : [];
        if (["frame_awaiting_approval", "frame_rejected"].includes(s.state)) settings.review = settings.review === "rejected" || s.state === "frame_rejected" ? "rejected" : "pending";
        else if (["frame_done", "video_waiting", "video_generating", "video_done"].includes(s.state)) settings.review = "approved";
        const body = { project_id: p.id, title: "Scene " + s.scene_number, action: s.action, location: s.location || "", time_of_day: s.time_of_day || "", lighting: s.lighting || "", props: s.props || "",
          camera: s.camera || "", dialogue: s.dialogue || "", sfx: s.sound || "", duration: (s.settings && s.settings.seconds) || 6,
          characters: (s.characters || []).map(n => (localChars.find(c => c.name.toLowerCase() === String(n).toLowerCase()) || {}).id).filter(Boolean),
          status: STATE[s.state] || "draft", error: s.error || "",
          purpose: s.state === "frame_awaiting_approval" ? "Waiting for your approval in the chat" + (s.identity ? " (face check: " + s.identity.overall + ")" : "") : (s.identity ? "Face check: " + s.identity.overall : "") };
        if (ls) body.id = ls.id;
        if (s.keyframe_url && settings.kv !== s.versions.frame) {
          try { const a = await addAsset(`${slug(d.title)}_s${s.scene_number}_frame_v${s.versions.frame}.png`, await download(s.keyframe_url), "image", ["from chat"]); body.start_asset = a.id; settings.kv = s.versions.frame;
            const hist = (settings.frame_history || []).slice(); if (!hist.some(x => x.v === s.versions.frame)) hist.push({ v: s.versions.frame, asset: a.id, at: Date.now() / 1000 }); settings.frame_history = hist.slice(-12); } catch (e) { console.warn(e); }
        }
        if (s.clip_url && settings.cv !== s.versions.clip) {
          try { const a = await addAsset(`${slug(d.title)}_s${s.scene_number}_v${s.versions.clip}.mp4`, await download(s.clip_url), "video", ["from chat"]); body.video_asset = a.id; settings.cv = s.versions.clip; } catch (e) { console.warn(e); }
        }
        body.settings = settings;
        const before = ls ? JSON.stringify([ls.status, ls.start_asset, ls.video_asset, ls.action, ls.purpose, ls.error]) : "";
        const saved = await api("scenes", body);
        if (!ls || before !== JSON.stringify([saved.status, saved.start_asset, saved.video_asset, saved.action, saved.purpose, saved.error])) changed++;
      }
      if (d.final_movie_url && p.data.connector_final !== d.final_movie_url.split("?")[0] + "|" + (d.final_movie_url.match(/[?&]v=(\d+)/) || [])[1]) {
        try {
          const a = await addAsset(`${slug(d.title)}_final.mp4`, await download(d.final_movie_url), "export", ["from chat", "final movie"]);
          const fresh = await api("projects/" + p.id);
          await api("projects", { id: p.id, name: fresh.name, aspect: fresh.aspect, asset_ids: [...new Set([...(fresh.asset_ids || []), a.id])], cover_asset: fresh.cover_asset,
            data: { ...fresh.data, connector_final: d.final_movie_url.split("?")[0] + "|" + (d.final_movie_url.match(/[?&]v=(\d+)/) || [])[1] } });
          changed++;
        } catch (e) { console.warn(e); }
      }
    }

    async function run(manual) {
      if (busy || !base()) return;
      busy = true; changed = 0; syncBtn.disabled = true; draw("Syncing with your chat…");
      try {
        await syncCharacters();
        const localChars = (await api("characters")).items;
        const all = (await getJ("/movies?limit=40")).movies || [];
        const movies = all.filter((m, i) => i < 12 || !["cancelled", "failed", "done"].includes(m.status));   // the 12 newest, plus anything older that is still alive (paused / waiting / running)
        for (const m of movies || []) { if (m.scenes) { draw("Syncing “" + m.title + "”…"); await syncMovie(m, localChars); } }
        publishHidden(); last = Date.now(); store.set("connector_last", String(last)); draw(changed ? `Synced: ${changed} change${changed === 1 ? "" : "s"} from your chat.` : null);
        if (changed) { const t = store.get("tab") || "dashboard"; try { window.showTab(t); } catch {} }
      } catch (e) { draw("Could not reach your connector: " + String(e.message || e).slice(0, 120)); }
      finally { busy = false; syncBtn.disabled = false; }
    }
    draw();
    window.__connectorSync = () => run(true);
    window.__connectorRestore = async ids => {   // bring chat movies back that were deleted on this phone (soft delete: nothing was ever lost)
      for (const id of ids || []) { const m = HIDDEN[id]; if (m) { await api("projects/" + m.localId + "/restore", {}); delete HIDDEN[id]; } }
      publishHidden();
      for (let i = 0; i < 60 && busy; i++) await new Promise(r => setTimeout(r, 250));   // a sync that is already running must finish first, otherwise the restored movie would wait for the next one
      await run(true); if (window.APP) APP.changed("all");
    };
    let one = false;   // live update of ONE chat movie (called every few seconds while its project is open)
    window.__connectorSyncMovie = async id => { if (one || busy || !base()) return false; one = true; try { const n0 = changed; changed = 0; await syncMovie({ id }, (await api("characters")).items); const c = changed; changed = n0; if (c && window.APP) APP.changed("scenes"); return true; } catch (e) { console.warn(e); return false; } finally { one = false; } };
    if (base()) setTimeout(() => run(false), 1500);
    setInterval(() => { if (document.visibilityState === "visible" && base() && Date.now() - last > 300000) run(false); }, 60000);
  }
})();
