// Home: what needs attention right now (frame reviews, running jobs), GPU and credit at a glance, active/recent projects, recent activity.
"use strict";
(() => {
  if (!window.AppShell || !window.AppShell.v2) return;
  const wait = setInterval(() => { if (window.APP && APP.go) { clearInterval(wait); init(); } }, 80);
  function init() {
    const { h, icon, txt, money, ago } = APP;
    const root = () => document.getElementById("v-hub");
    let drawing = 0;

    const thumb = (url, aspect, label) => h("div", { class: "ds-thumb", style: `aspect-ratio:${APP.arCss(aspect)}` }, url ? h("img", { src: url, loading: "lazy", alt: "" }) : (label || icon("img")));
    const statCard = (label, value, sub, pill) => h("div", { class: "ds-card hm-stat" }, h("small", {}, label), h("b", {}, value), sub ? h("span", { class: "ds-small" }, sub) : null, pill || null);
    const gpuPill = g => h("span", { class: "ds-pill " + ({ running: "run", idle: "ok", initializing: "warn", asleep: "", unavailable: "bad" }[g.state] || ""), style: "margin-top:8px" }, h("i"), g.label);

    async function draw() {
      const r = root(); if (!r || r.hidden) return; const my = ++drawing;
      if (!r.firstChild) r.replaceChildren(h("div", { class: "ds-stack" }, h("div", { class: "ds-skel", style: "height:56px" }), h("div", { class: "ds-skel", style: "height:110px" }), h("div", { class: "ds-skel", style: "height:180px" })));
      let projects = [], scenesBy = {};
      try { projects = await APP.projects(); await Promise.all(projects.slice(0, 14).map(async p => { scenesBy[p.id] = await APP.scenes(p.id); })); } catch (e) { APP.fail(e, "Could not load your projects"); }
      const g = await APP.refreshGpu().catch(() => APP.gpu);
      if (my !== drawing) return;
      const review = [], active = [];
      for (const p of projects) { const sc = scenesBy[p.id] || []; const pl = APP.pipeline(sc);
        for (const s of sc) if (APP.sceneInfo(s, p).key === "review") review.push({ p, s });
        if (sc.length && pl.vids < sc.length) active.push({ p, pl, sc }); }
      const recent = [...projects].sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 6);
      const badge = document.getElementById("busy-badge"); if (badge && badge.hidden !== undefined && g.running) { /* the legacy badge counts Create jobs; keep it */ }

      r.replaceChildren(
        h("div", { class: "hm-hero" },
          h("div", {}, h("h1", { class: "ds-h" }, "Your studio"), h("div", { class: "ds-sub" }, projects.length ? `${projects.length} project${projects.length === 1 ? "" : "s"}${review.length ? " · " + review.length + " frame" + (review.length === 1 ? "" : "s") + " waiting for you" : ""}` : "Make your first movie")),
          h("div", { class: "ds-row" }, h("button", { class: "ds-btn", onclick: () => APP.go("/create") }, icon("sparkle"), "Quick create"), h("button", { class: "ds-btn pri", onclick: () => newProject() }, icon("plus"), "New project"))),
        APP.LS.get("connector_url", "") ? h("div", { class: "ds-row ds-wrap", style: "margin-top:10px;gap:8px" }, h("span", { class: "ds-pill ok" }, icon("link"), "Chat connected"), h("span", { class: "ds-small" }, (() => { const t = Number(APP.LS.get("connector_last", 0)); return t ? "synced " + ago(t / 1000) : "not synced yet"; })()), h("button", { class: "ds-btn sm ghost", onclick: async ev => { ev.currentTarget.disabled = true; try { await APP.syncNow(); APP.toast("Synced with your chat", "ok"); } catch (e) { APP.fail(e, "Sync"); } draw(); } }, icon("refresh"), "Sync now")) : null,
        h("div", { class: "hm-stats", style: "margin-top:14px" },
          statCard("GPU", g.label.replace("GPU ", ""), g.detail, gpuPill(g)),
          statCard("RunPod credit", g.balance != null ? money(g.balance) : "–", g.balance != null ? (g.perHour ? money(g.perHour) + "/hour right now" : "Not spending now") : "Open AI Studio on your PC once to show it"),
          statCard("Jobs", `${g.running.length} running`, `${g.jobs.inQueue || 0} queued`),
          statCard("Recent spend", g.spent != null ? money(g.spent) : "–", `last ${g.recent.length} jobs`)),
        section("Needs your review", review.length ? null : null),
        review.length ? h("div", { class: "hm-list" }, review.slice(0, 8).map(({ p, s }) => item(thumb(s.start_asset_url, p.aspect), s.title || "Scene", `${p.name} · ${APP.sceneInfo(s, p).fromChat ? "from chat" : "start frame"}`, h("span", { class: "ds-pill warn" }, "Review"), () => APP.go(`/projects/${p.id}/storyboard/${s.id}/review`))))
          : h("div", { class: "ds-empty" }, icon("check"), h("b", {}, "Nothing is waiting"), "New start frames that need approval will appear here."),
        h("div", { class: "hm-split" },
          h("div", {}, section("Running now"), g.running.length ? h("div", { class: "hm-list" }, g.running.map(j => item(h("div", { class: "ds-thumb" }, h("span", { class: "ds-pill run" }, h("i"))), jobName(j.tool) + (j.scene ? " · " + j.scene : ""), `${Math.round(j.elapsed || 0)} s${j.typical ? " of about " + Math.round(j.typical) + " s" : ""}`, h("button", { class: "ds-btn sm bad", onclick: async ev => { ev.stopPropagation(); if (await APP.confirm("Cancel this job?", "GPU time already used is not refunded.", "Cancel job", true)) { try { await fetch("/api/cancel/" + j.id, { method: "POST" }); APP.toast("Cancelling…"); setTimeout(draw, 1500); } catch (e) { APP.fail(e); } } } }, "Cancel"), null)))
            : h("div", { class: "ds-empty" }, icon("bolt"), h("b", {}, "No jobs running"), "Generation jobs show their progress here.")),
          h("div", {}, section("Recent activity"), g.recent.length ? h("div", { class: "hm-list" }, g.recent.slice(0, 6).map(j => item(h("div", { class: "ds-thumb" }, icon(j.status === "COMPLETED" ? "check" : "warn")), jobName(j.tool) + (j.scene ? " · " + j.scene : ""), `${ago(j.finished)}${j.cost ? " · " + money(j.cost) : ""}`, h("span", { class: "ds-pill " + (j.status === "COMPLETED" ? "ok" : j.status === "CANCELLED" ? "" : "bad") }, j.status === "COMPLETED" ? "Done" : j.status === "CANCELLED" ? "Cancelled" : "Failed"), null)))
            : h("div", { class: "ds-empty" }, icon("film"), h("b", {}, "No activity yet"), "Finished jobs are listed here."))),
        section("Active projects", null, "All projects", () => APP.go("/projects")),
        active.length ? h("div", { class: "ds-grid wide" }, active.slice(0, 6).map(({ p, pl, sc }) => projectCard(p, sc, pl))) : h("div", { class: "ds-empty" }, icon("film"), h("b", {}, projects.length ? "All projects are finished" : "No projects yet"), projects.length ? "Start a new one whenever you like." : "Create a project to plan scenes, make frames and videos.", h("button", { class: "ds-btn pri", onclick: () => newProject() }, "New project")),
        recent.length ? [section("Recent projects"), h("div", { class: "ds-grid wide" }, recent.map(p => projectCard(p, scenesBy[p.id] || [], APP.pipeline(scenesBy[p.id] || []))))] : null);
    }
    const jobName = t => ({ qwen_edit: "Start frame", qwen_image: "Image", minimax_h3: "Video", stable_audio: "Music", f5_voice: "Voice", seedvr2_upscale: "Enhance" }[t] || APP.txt(t, "Job"));
    const section = (title, _x, link, fn) => h("div", { class: "ds-section" }, h("h2", {}, title), link ? h("button", { class: "ds-link", onclick: fn }, link) : null);
    const item = (th, title, sub, right, fn) => h("div", { class: "hm-item", role: fn ? "button" : null, tabindex: fn ? 0 : null, onclick: fn || null }, th, h("div", { class: "ds-grow" }, h("b", {}, title), h("span", { class: "ds-small" }, sub)), right);
    APP.projectCard = projectCard;
    function projectCard(p, scenes, pl) {
      const withFrame = scenes.find(s => s.start_asset_url), cover = p.cover_url || (withFrame && withFrame.start_asset_url) || "";
      const pend = scenes.filter(s => APP.sceneInfo(s, p).key === "review").length;
      const t = h("div", { class: "ds-thumb" }, cover ? h("img", { src: cover, loading: "lazy", alt: "" }) : icon("film"));
      return h("div", { class: "ds-card tap pj-card" + (APP.isPortrait(p.aspect) ? " portrait" : ""), role: "button", tabindex: 0, onclick: () => APP.go("/projects/" + p.id), onkeydown: e => { if (e.key === "Enter") APP.go("/projects/" + p.id); } }, t,
        h("div", { class: "in" }, h("div", { class: "ds-row ds-between" }, h("b", {}, APP.txt(p.name, "Untitled project")), h("span", { class: "ds-pill" }, p.aspect)),
          h("div", { class: "ds-bar" }, h("i", { style: `width:${pl.n ? Math.round(100 * (pl.vids + pl.frames) / (2 * pl.n)) : 0}%` })),
          h("div", { class: "ds-row ds-wrap" }, h("span", { class: "ds-small" }, pl.n ? `${pl.frames}/${pl.n} frames · ${pl.vids}/${pl.n} videos` : "No scenes yet"), pend ? h("span", { class: "ds-pill warn" }, pend + " to review") : null)));
    }
    async function newProject() {
      const chars = await APP.chars().catch(() => []);
      APP.sheet((box, close) => {
        const name = h("input", { class: "ds-input", placeholder: "Project name", maxlength: 120 }), aspect = h("div", { class: "ds-seg" }, ["9:16", "16:9", "1:1"].map((a, i) => h("button", { type: "button", class: a === APP.LS.get("def_aspect", "9:16") ? "on" : "", "data-a": a, onclick: e => { [...aspect.children].forEach(b => b.classList.remove("on")); e.target.classList.add("on"); } }, a === "9:16" ? "9:16 portrait" : a === "16:9" ? "16:9 wide" : "1:1 square")));
        let imgSrc = "ai"; const SRCS = (window.IMP && IMP.SOURCES) || [["ai", "AI Studio GPU", ""]], srcHint = h("div", { class: "ds-small", style: "margin-top:6px" }, SRCS[0][2]);
        const srcSel = h("div", { class: "ds-seg", role: "group", "aria-label": "Storyboard image source" }, SRCS.map(([k, l, d], i) => h("button", { type: "button", class: i === 0 ? "on" : "", onclick: e => { imgSrc = k; [...srcSel.children].forEach(b => b.classList.remove("on")); e.currentTarget.classList.add("on"); srcHint.textContent = d; } }, l)));
        const picked = new Set(); const pick = h("div", { class: "ds-chips", style: "flex-wrap:wrap" }, chars.map(c => h("button", { type: "button", class: "ds-chip", onclick: e => { picked.has(c.id) ? picked.delete(c.id) : picked.add(c.id); e.currentTarget.classList.toggle("on", picked.has(c.id)); } }, c.name)));
        box.append(h("h2", { class: "ds-h2", style: "font-size:18px;margin-bottom:12px" }, "New project"), h("div", { class: "ds-stack" },
          h("div", { class: "ds-field" }, h("label", {}, "Name"), name), h("div", { class: "ds-field" }, h("label", {}, "Shape (kept for every frame, video and export)"), aspect),
          SRCS.length > 1 ? h("div", { class: "ds-field" }, h("label", {}, "Storyboard image source"), srcSel, srcHint) : null,
          chars.length ? h("div", { class: "ds-field" }, h("label", {}, "Characters"), pick) : null,
          h("div", { class: "ds-row" }, h("button", { class: "ds-btn ghost", style: "flex:1", onclick: close }, "Cancel"), h("button", { class: "ds-btn pri", style: "flex:1", onclick: async () => {
            if (!name.value.trim()) { name.focus(); return APP.toast("Give the project a name."); }
            const a = aspect.querySelector(".on").dataset.a;
            try { const p = await APP.saveProject({}, { name: name.value.trim(), aspect: a, resolution: a === "9:16" ? "768x1344" : a === "1:1" ? "1024x1024" : "1344x768", duration: 30, characters: [...picked], story: "", description: "", data: imgSrc === "ai" ? {} : { image_source: imgSrc } }); close(); APP.go("/projects/" + p.id); } catch (e) { APP.fail(e, "Could not create the project"); } } }, "Create"))));
      });
    }
    APP.newProject = newProject;
    setTimeout(() => { const r = root(); if (r && !r.hidden) draw(); }, 0);   // the shell may already have opened Home before this file finished loading
    APP.on("view:hub", draw); APP.on("changed", () => { if (!root().hidden) draw(); }); APP.on("gpu", () => { const r = root(); if (r && !r.hidden && Date.now() - (draw.last || 0) > 12000) { draw.last = Date.now(); draw(); } });
  }
})();
