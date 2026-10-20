// Studio Pro operations tabs: Dashboard (GPU, money, queue, projects), Queue (jobs, cancel, retry), Models (capabilities, last real run).
(() => {
  const { api, h, err, loaders } = window.SP;
  const nav = document.getElementById("tabs"), main = (document.getElementById("studio-main") || document.querySelector("main")), hist = document.getElementById("tab-history");
  const first = nav.querySelector("button");
  const css = document.createElement("style");
  css.textContent = `
  .op-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:12px; margin-bottom:14px }
  .op-stat { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px } .op-stat small { color:var(--muted); display:block } .op-stat b { font-size:22px; display:block; margin-top:2px }
  .op-tbl { width:100%; border-collapse:collapse; font-size:13.5px } .op-tbl td, .op-tbl th { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top } .op-tbl th { color:var(--muted); font-weight:600; font-size:12px }
  .op-tbl .p { max-width:380px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--muted) }
  .op-ok { color:var(--ok) } .op-bad { color:var(--bad) } .op-m { color:var(--muted) }
  .op-model { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px; margin-bottom:10px } .op-model ul { margin:4px 0 8px; padding-left:18px }
  @media (max-width:820px) { .op-tbl .p { max-width:140px } }`;
  document.head.append(css);

  const add = (id, label, before) => {
    const b = h("button", { "data-tab": id }, label); b.onclick = () => window.showTab(id); nav.insertBefore(b, before);
    main.insertBefore(h("section", { class: "tab wide", id: "tab-" + id }), hist);
    try { if (localStorage.getItem("tab") === id) setTimeout(() => window.showTab(id), 0); } catch {}
  };
  add("dashboard", "Dashboard", first); add("queue", "Queue", nav.querySelector('[data-tab="history"]')); add("models", "Models", nav.querySelector('[data-tab="history"]'));

  const ago = t => { const s = Math.round(Date.now() / 1000 - t); return s < 90 ? s + " s ago" : s < 5400 ? Math.round(s / 60) + " min ago" : s < 129600 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " d ago"; };
  const dur = s => s >= 60 ? Math.floor(s / 60) + " min " + Math.round(s % 60) + " s" : Math.round(s) + " s";
  const stat = (label, value, sub) => h("div", { class: "op-stat" }, h("small", {}, label), h("b", {}, value), sub ? h("small", {}, sub) : null);
  const timers = [];
  const every = (fn, ms) => { const t = setInterval(() => { if (document.getElementById("tab-" + fn.tab)?.classList.contains("active")) fn(); }, ms); timers.push(t); };

  // ---------------------------------------------------------------- Dashboard
  async function dashboard() {
    const r = document.getElementById("tab-dashboard");
    const [health, gpu, bal, q, projects, storage] = await Promise.all([api("../health").catch(() => ({})), api("../gpu").catch(() => ({})), api("../balance").catch(() => ({})),
      api("../queue").catch(() => ({ running: [], recent: [] })), api("projects").then(x => x.items).catch(() => []), api("storage").catch(() => ({}))]);
    const w = health.runpod?.workers || {}, jobs = health.runpod?.jobs || {};
    const awake = (w.idle || 0) + (w.ready || 0) + (w.running || 0) + (w.initializing || 0);
    r.replaceChildren(h("div", { class: "sp-bar" }, h("h2", {}, "Dashboard"), h("button", { class: "sp-btn", onclick: () => dashboard() }, "Refresh")),
      h("div", { class: "op-grid" },
        stat("GPU worker", awake ? (w.running ? "Working" : w.initializing ? "Starting" : "Awake") : "Asleep", health.error ? health.error : `${w.running || 0} running · ${w.idle || 0} idle · ${w.initializing || 0} starting`),
        stat("Sleep mode", gpu.mode === "on" ? "Always on" : "Auto sleep", gpu.until ? "until " + new Date(gpu.until * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "sleeps after 10 min idle"),
        stat("RunPod credit", bal.balance != null ? "$" + bal.balance.toFixed(2) : "?", bal.per_hour ? `$${bal.per_hour.toFixed(2)}/h now` : "spending only while awake"),
        stat("Jobs", `${q.running.length} running`, `${jobs.inQueue || 0} queued · ${jobs.failed || 0} failed overall`),
        stat("Recent GPU spend", "$" + (q.cost_recent || 0).toFixed(2), "last " + q.recent.length + " jobs"),
        stat(window.StudioBackend ? "Storage on this device" : "Storage on this PC", ((storage.data_mb || 0) + (storage.outputs_mb || 0)) + " MB", window.StudioBackend ? `used ${storage.data_mb || 0} MB of ${storage.quota_mb || "?"} MB` : `library ${storage.data_mb || 0} MB · results ${storage.outputs_mb || 0} MB`)),
      h("p", { class: "hint" }, "GPU: 48 GB class serverless worker (about $1.22/h while awake). RunPod serverless does not expose live VRAM use or temperature, so those are not shown."),
      h("div", { class: "sp-bar" }, h("h3", { style: "margin:0;flex:1" }, "Recent projects"),
        h("button", { class: "sp-btn pri", onclick: () => window.showTab("projects") }, "Projects"), h("button", { class: "sp-btn", onclick: () => window.showTab("storyboard") }, "Storyboard"),
        h("button", { class: "sp-btn", onclick: () => window.showTab("editor") }, "Editor"), h("button", { class: "sp-btn", onclick: () => window.showTab("image") }, "Create image")),
      h("div", { class: "sp-grid" }, projects.slice(0, 6).map(p => h("div", { class: "sp-card", onclick: () => { try { localStorage.setItem("sb_project", p.id); } catch {} window.showTab("storyboard"); } },
        h("div", { class: "pic" }, p.cover_url ? h("img", { src: p.cover_url }) : "🎬"), h("div", { class: "info" }, h("b", {}, p.name), `${p.aspect} · ${p.duration}s`))),
        projects.length ? null : h("div", { class: "sp-empty" }, "No projects yet.")),
      q.running.length ? h("div", {}, h("h3", {}, "Running now"), ...q.running.map(j => h("div", { class: "op-stat", style: "margin-bottom:8px" }, h("b", { style: "font-size:15px" }, j.tool + (j.scene ? " · " + j.scene : "")), h("small", {}, `${dur(j.elapsed)} so far · usually ${j.typical ? dur(j.typical) : "?"}`)))) : null);
  }
  dashboard.tab = "dashboard"; loaders.dashboard = () => dashboard().catch(err); every(dashboard, 20000);

  // ---------------------------------------------------------------- Queue
  async function queue() {
    const r = document.getElementById("tab-queue");
    const q = await api("../queue");
    const badge = s => h("span", { class: s === "COMPLETED" ? "op-ok" : s === "CANCELLED" ? "op-m" : "op-bad" }, s === "COMPLETED" ? "Done" : s === "CANCELLED" ? "Cancelled" : s === "TIMED_OUT" ? "Timed out" : "Failed");
    r.replaceChildren(h("div", { class: "sp-bar" }, h("h2", {}, "Queue"), h("button", { class: "sp-btn", onclick: () => queue() }, "Refresh")),
      h("h3", { style: "margin:6px 0" }, `Running (${q.running.length})`),
      q.running.length ? h("table", { class: "op-tbl" }, h("tr", {}, ["Tool", "For", "Prompt", "Elapsed", ""].map(t => h("th", {}, t))), ...q.running.map(j => h("tr", {}, h("td", {}, j.tool), h("td", {}, j.scene || "–"), h("td", { class: "p" }, j.prompt),
        h("td", {}, dur(j.elapsed) + (j.typical ? " / ~" + dur(j.typical) : "")),
        h("td", {}, h("button", { class: "sp-btn bad", onclick: async () => { if (confirm("Cancel this job?")) { await fetch("/api/cancel/" + j.id, { method: "POST" }); setTimeout(queue, 1500); } } }, "Cancel"))))) : h("p", { class: "hint" }, "Nothing is running."),
      h("h3", { style: "margin:18px 0 6px" }, `Recent (${q.recent.length}) · spent $${(q.cost_recent || 0).toFixed(2)}`),
      q.recent.length ? h("table", { class: "op-tbl" }, h("tr", {}, ["When", "Tool", "For", "Prompt / error", "Result", "GPU", ""].map(t => h("th", {}, t))), ...q.recent.map(j => h("tr", {}, h("td", {}, ago(j.finished)), h("td", {}, j.tool), h("td", {}, j.scene || "–"),
        h("td", { class: "p", title: j.error || j.prompt }, j.error || j.prompt), h("td", {}, badge(j.status)), h("td", {}, j.gpu_seconds ? dur(j.gpu_seconds) + " · $" + (j.cost || 0).toFixed(3) : "–"),
        h("td", {}, h("button", { class: "sp-btn", onclick: async () => { try { const x = await fetch("/api/queue/retry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: j.id }) }); const d = await x.json(); if (!x.ok) throw new Error(d.error); setTimeout(queue, 1000); } catch (e) { err(e); } } }, "Run again"),
          j.files?.length ? (window.StudioBackend
          ? h("button", { class: "sp-btn", style: "margin-left:6px", onclick: async () => { const u = await window.StudioBackend.outputUrl(j.files[0]); if (u) window.open(u, "_blank"); else alert("This result is no longer kept on this device (results are cleared after 2 days). It was copied to Assets if you used it."); } }, "Open")
          : h("a", { class: "sp-btn", href: j.files[0], target: "_blank", style: "text-decoration:none;margin-left:6px" }, "Open")) : null)))) : h("p", { class: "hint" }, "No finished jobs recorded yet."),
      h("p", { class: "hint" }, "“Run again” works for jobs without uploaded files (text-only images, sounds). For video or photo jobs use the Storyboard or the page where you started them."));
  }
  queue.tab = "queue"; loaders.queue = () => queue().catch(err); every(queue, 15000);

  // ---------------------------------------------------------------- Models
  async function models() {
    const r = document.getElementById("tab-models");
    const m = await api("models");
    r.replaceChildren(h("div", { class: "sp-bar" }, h("h2", {}, "Models")), h("p", { class: "sb-warn" }, m.note),
      ...m.items.map(x => h("div", { class: "op-model" }, h("div", { class: "sp-bar", style: "margin:0" }, h("b", { style: "flex:1;font-size:15px" }, x.name + " · " + x.kind),
        x.last_ok ? h("span", { class: "op-ok" }, "Last worked " + ago(x.last_ok) + (x.last_ok_gpu_seconds ? " (" + dur(x.last_ok_gpu_seconds) + ")" : "")) : h("span", { class: "op-m" }, "no recorded run here yet")),
        h("div", { class: "hint" }, "Can do:"), h("ul", {}, x.modes.map(t => h("li", {}, t))), x.limits ? h("div", { class: "hint" }, "Limits: " + x.limits) : null,
        x.not_supported.length ? h("div", { class: "hint", style: "color:var(--warn)" }, "Not supported: " + x.not_supported.join("; ")) : null,
        h("details", { style: "margin-top:6px" }, h("summary", { class: "hint", style: "cursor:pointer" }, "Model files (" + x.files.length + ")"), h("div", { class: "hint", style: "overflow-wrap:anywhere" }, x.files.join(", "))))),
      h("p", { class: "hint" }, "Retired (files can be deleted in Settings → Free up space): " + m.retired.join(", ")));
  }
  loaders.models = () => models().catch(err);
})();
