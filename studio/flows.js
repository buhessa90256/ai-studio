// Studio Pro Workflows tab: reusable step lists that run on a project (plan → frames → approval → videos → timeline → audio → export).
(() => {
  const { api, h, err, loaders, modal } = window.SP;
  const nav = document.getElementById("tabs"), main = (document.getElementById("studio-main") || document.querySelector("main"));
  const btn = h("button", { "data-tab": "studioflows" }, "Workflows");
  btn.onclick = () => window.showTab("studioflows");
  nav.insertBefore(btn, nav.querySelector('[data-tab="history"]'));
  main.insertBefore(h("section", { class: "tab wide", id: "tab-studioflows" }), document.getElementById("tab-history"));
  try { if (localStorage.getItem("tab") === "studioflows") setTimeout(() => window.showTab("studioflows"), 0); } catch {}

  const W = { items: [], types: {}, projectId: localStorage.getItem("sb_project") || "", projects: [], running: false };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const FIELDS = { seconds: ["Seconds", "number"], clip: ["Seconds per scene", "number"], kind: ["Kind", ["music", "sfx"]], prompt: ["Describe it", "text"], volume: ["Volume", "number"], resolution: ["Size", ["source", "hd"]] };

  loaders.studioflows = async function () {
    const d = await api("workflows"); W.items = d.items; W.types = d.types; W.projects = (await api("projects")).items;
    draw();
  };

  function draw() {
    const root = document.getElementById("tab-studioflows");
    root.replaceChildren(h("div", { class: "sp-bar" }, h("h2", {}, "Workflows"), h("button", { class: "sp-btn pri", onclick: () => edit({ name: "", description: "", steps: [] }) }, "New workflow")),
      h("p", { class: "sb-warn" }, "A workflow runs the same steps you would do by hand, in order, on one project. GPU steps ask for confirmation first and can be stopped; finished scenes are skipped, so a stopped run can be started again."),
      h("div", { class: "sp-grid" }, W.items.map(w => h("div", { class: "sp-card", style: "cursor:default" }, h("div", { class: "info" }, h("b", {}, w.name + (w.builtin ? " · built-in" : "")), w.description,
        h("ol", { style: "margin:8px 0 0;padding-left:18px" }, w.steps.map(s => h("li", {}, W.types[s.type]?.label || s.type))),
        h("div", { class: "actions" }, h("button", { class: "sp-btn pri", onclick: () => runDialog(w) }, "Run"),
          h("button", { class: "sp-btn", onclick: async () => { try { await api(`workflows/${w.id}/duplicate`, {}); loaders.studioflows(); } catch (e) { err(e); } } }, "Duplicate"),
          w.builtin ? null : h("button", { class: "sp-btn", onclick: () => edit(w) }, "Edit"),
          w.builtin ? null : h("button", { class: "sp-btn bad", onclick: async () => { if (confirm("Delete this workflow?")) { await api(`workflows/${w.id}/delete`, {}); loaders.studioflows(); } } }, "Delete")))))));
  }

  function edit(w) {
    const m = modal(); const st = { id: w.id, steps: JSON.parse(JSON.stringify(w.steps)) };
    const name = h("input", { type: "text", value: w.name }), desc = h("input", { type: "text", value: w.description });
    const list = h("div", {});
    const drawSteps = () => list.replaceChildren(...st.steps.map((s, i) => h("div", { class: "ed-item" }, h("div", { class: "sp-bar", style: "margin:0" }, h("b", { style: "flex:1" }, `${i + 1}. ${W.types[s.type].label}`),
      h("button", { class: "sp-btn", onclick: () => { if (i) { [st.steps[i - 1], st.steps[i]] = [st.steps[i], st.steps[i - 1]]; drawSteps(); } } }, "▲"),
      h("button", { class: "sp-btn", onclick: () => { if (i < st.steps.length - 1) { [st.steps[i + 1], st.steps[i]] = [st.steps[i], st.steps[i + 1]]; drawSteps(); } } }, "▼"),
      h("button", { class: "sp-btn bad", onclick: () => { st.steps.splice(i, 1); drawSteps(); } }, "Remove")),
      h("div", { class: "sp-three" }, Object.keys(W.types[s.type].defaults).map(k => { const [label, kind] = FIELDS[k]; const el = Array.isArray(kind)
        ? h("select", {}, kind.map(o => h("option", { value: o, selected: s.config[k] === o }, o))) : h("input", { type: kind, value: s.config[k], step: kind === "number" ? "any" : null });
        el.onchange = el.oninput = () => { s.config[k] = kind === "number" ? parseFloat(el.value) || 0 : el.value; }; return h("div", {}, h("label", {}, label), el); })))));
    drawSteps();
    const add = h("select", {}, [h("option", { value: "" }, "+ Add a step…"), ...Object.entries(W.types).map(([k, v]) => h("option", { value: k }, v.label + (v.gpu ? " (GPU)" : "")))]);
    add.onchange = () => { if (add.value) { st.steps.push({ type: add.value, config: { ...W.types[add.value].defaults } }); add.value = ""; drawSteps(); } };
    m.firstChild.append(h("h3", {}, w.id ? "Edit workflow" : "New workflow"), h("label", {}, "Name"), name, h("label", {}, "Description"), desc, h("label", {}, "Steps"), list, add,
      h("div", { class: "actions" }, h("button", { class: "sp-btn pri", onclick: async () => { try { await api("workflows", { id: st.id, name: name.value, description: desc.value, steps: st.steps }); m.close(); loaders.studioflows(); } catch (e) { err(e); } } }, "Save"), h("button", { class: "sp-btn", onclick: m.close }, "Cancel")));
  }

  function runDialog(w) {
    const m = modal();
    const sel = h("select", {}, [h("option", { value: "" }, "Choose a project…"), ...W.projects.map(p => h("option", { value: p.id, selected: p.id === W.projectId }, p.name))]);
    const gpu = w.steps.filter(s => W.types[s.type].gpu).length;
    const log = h("div", { class: "hint", style: "white-space:pre-wrap;margin-top:10px" });
    let stop = false;
    const go = h("button", { class: "sp-btn pri", onclick: async () => {
      if (!sel.value) return alert("Choose a project first.");
      W.projectId = sel.value; try { localStorage.setItem("sb_project", W.projectId); } catch {}
      if (gpu && !confirm(`This workflow has ${gpu} GPU step${gpu === 1 ? "" : "s"} (RunPod credit; videos take about 7 minutes each). Continue?`)) return;
      go.disabled = true; stop = false; W.running = true;
      try { await run(w, sel.value, t => { log.textContent += t + "\n"; }, () => stop); log.textContent += "Finished.\n"; }
      catch (e) { log.textContent += "Stopped: " + e.message + "\n"; }
      W.running = false; go.disabled = false;
    } }, "Run");
    m.firstChild.append(h("h3", {}, "Run: " + w.name), h("p", { class: "hint" }, w.description), h("label", {}, "Project"), sel,
      h("p", { class: "hint" }, "Keep this page open while it runs. You can close this window; progress of scenes is saved either way."),
      h("div", { class: "actions" }, go, h("button", { class: "sp-btn", onclick: () => { stop = true; } }, "Stop after this step"), h("button", { class: "sp-btn", onclick: m.close }, "Close")), log);
  }

  async function run(w, pid, say, stopped) {
    const SB = window.SP.sb;
    await SB.use(pid);
    let project = (await api("projects")).items.find(p => p.id === pid);
    for (const [i, s] of w.steps.entries()) {
      if (stopped()) throw new Error("stopped by you");
      const label = `${i + 1}/${w.steps.length} ${W.types[s.type].label}`;
      say(label + "…");
      if (s.type === "plan") {
        const existing = (await api("scenes?project=" + pid)).items;
        if (existing.length) say("  scenes already exist, skipping");
        else await api("scenes/plan", { project: pid, idea: project.story, seconds: s.config.seconds, clip: s.config.clip, characters: project.characters });
        await SB.use(pid);
      } else if (s.type === "keyframes") say("  made " + await SB.keyframes() + " start frame(s)");
      else if (s.type === "approve") {
        window.showTab("storyboard");
        if (!confirm("Review the storyboard now (it is open behind this window).\n\nOK = approve it and continue. Cancel = stop here.")) throw new Error("storyboard not approved");
        await SB.approve(true);
      } else if (s.type === "videos") {
        project = (await api("projects")).items.find(p => p.id === pid);
        if (!project.data.approved) throw new Error("approve the storyboard first");
        say("  made " + await SB.videos() + " video(s)");
      } else if (s.type === "enhance") { say("  enhanced " + await SB.enhance() + " video(s)");
      } else if (s.type === "timeline") { const tl = await api("timeline/from_scenes", { project: pid, replace: true }); say("  " + tl.clips.length + " clip(s) on the timeline"); }
      else if (s.type === "audio") {
        const tl = await api("timeline?project=" + pid);
        if (!s.config.prompt.trim()) throw new Error("this audio step has no description");
        const a = await window.SP.runJob("stable_audio", { prompt: s.config.prompt, seconds: Math.min(47, s.config.seconds || 30) });
        tl.audio.push({ asset_id: a.id, start: 0, in: 0, out: 9999, volume: s.config.volume || 0.25, fade_in: 1, fade_out: 2, kind: s.config.kind === "sfx" ? "sfx" : "music" });
        await api("timeline", { project: pid, timeline: tl }); say("  audio added");
      } else if (s.type === "export") {
        let j = await api("export", { project: pid, resolution: s.config.resolution === "hd" ? "hd" : "source" });
        while (j.status === "queued" || j.status === "rendering") { await sleep(2000); j = await api("export/" + j.id); }
        if (j.status !== "done") throw new Error(j.error || "export failed");
        say("  exported " + j.asset.filename + " (Assets → export)");
      }
    }
  }
  window.SP.use = Object.assign(window.SP.use || {}, { flows: pid => { W.projectId = pid; return loaders.studioflows(); } });
})();
