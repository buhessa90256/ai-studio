// Settings: interface, AI models, GPU workers, chat/MCP connection, defaults, spending limits, storage, diagnostics. The old cards (key, storage reset) stay below.
"use strict";
(() => {
  if (!window.AppShell || !window.AppShell.v2) return;
  window.__errs = window.__errs || [];
  window.addEventListener("error", e => { window.__errs.push(`${new Date().toLocaleTimeString()} ${e.message} (${(e.filename || "").split("/").pop()}:${e.lineno})`); window.__errs = window.__errs.slice(-30); });
  window.addEventListener("unhandledrejection", e => { window.__errs.push(`${new Date().toLocaleTimeString()} ${String((e.reason && e.reason.message) || e.reason).slice(0, 160)}`); window.__errs = window.__errs.slice(-30); });
  const wait = setInterval(() => { if (window.APP && APP.go) { clearInterval(wait); init(); } }, 80);
  function init() {
    const { h, icon, txt, api, LS } = APP, root = () => document.getElementById("v-settings");
    let host = null;
    const card = (id, title, sub, ...kids) => h("section", { class: "ds-card st-card", id: "st-" + id, style: "margin-bottom:14px" }, h("h3", {}, title), sub ? h("div", { class: "ds-sub", style: "margin-bottom:8px" }, sub) : null, ...kids);
    const kv = (k, v) => h("div", { class: "st-kv" }, h("span", {}, k), h("span", {}, v));
    const toggle = (label, on, fn, sub) => { const b = h("input", { type: "checkbox", style: "width:22px;height:22px;accent-color:var(--accent)" }); b.checked = on; b.onchange = () => fn(b.checked); return h("label", { class: "ds-row", style: "padding:10px 0;cursor:pointer" }, h("div", { class: "ds-grow" }, h("div", { style: "font-weight:600;font-size:14.5px" }, label), sub ? h("div", { class: "ds-small" }, sub) : null), b); };
    const base = () => LS.get("connector_url", "");
    async function draw() {
      const r = root(); if (!r || r.hidden) return;
      if (!host) { host = h("div", { id: "st-v2" }); r.insertBefore(host, r.firstChild); const legacyCards = [...r.querySelectorAll(":scope > .card")]; if (legacyCards.length) { const wrap = h("details", { class: "ws-sec", style: "margin-top:6px" }, h("summary", {}, "Device: RunPod key, saved results"), h("div", { class: "in", style: "padding-top:0" })); legacyCards.forEach(c => wrap.querySelector(".in").append(c)); r.append(wrap); } }
      const g = await APP.refreshGpu().catch(() => APP.gpu);
      const nav = h("div", { class: "ds-chips st-nav" }, [["interface", "Interface"], ["models", "AI models"], ["gpu", "GPU workers"], ["connections", "Connections"], ["defaults", "Defaults"], ["limits", "Limits"], ["storage", "Storage"], ["diag", "Diagnostics"]].map(([k, l]) => h("button", { type: "button", class: "ds-chip", onclick: () => { const el = document.getElementById("st-" + k); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); } }, l)));
      host.replaceChildren(nav, h("div", { style: "height:12px" }),
        card("interface", "Interface", "The redesigned studio: Home, Projects, Library, Settings.", toggle("Use the classic interface", false, on => { if (on) { LS.set("ui_mode", "classic"); location.href = location.pathname + "?ui=classic"; } }, "Go back to the previous layout. Your projects and files are the same in both."), h("div", { class: "ds-small" }, "Desktop shortcuts: Alt+1…4 sections · ←/→ scenes · A approve · R regenerate · Esc close · ? help")),
        card("models", "AI models", "What runs on the GPU for each step.", h("div", { id: "st-models-body" }, h("div", { class: "ds-skel", style: "height:90px" }))),
        card("gpu", "RunPod GPU workers", "Advanced worker details live here; Home only shows the summary.",
          kv("State", h("span", { class: "ds-pill " + ({ running: "run", idle: "ok", initializing: "warn", unavailable: "bad" }[g.state] || "") }, h("i"), g.label)), h("div", { class: "ds-sub", style: "margin:6px 0" }, g.detail),
          kv("Workers", `${g.workers.running || 0} running · ${g.workers.idle || 0} idle · ${g.workers.ready || 0} ready · ${g.workers.initializing || 0} starting`), kv("Unhealthy / throttled", `${g.workers.unhealthy || 0} / ${g.workers.throttled || 0}`),
          kv("Queue", `${g.jobs.inQueue || 0} waiting · ${g.jobs.inProgress || 0} in progress · ${g.jobs.failed || 0} failed overall`), kv("Endpoint", txt((() => { try { return JSON.parse(localStorage.getItem("endpoint")); } catch { return ""; } })(), "–")), kv("Price while awake", "about $1.22 per hour"),
          toggle("Keep the GPU warm while the app is open", (() => { try { return !!JSON.parse(localStorage.getItem("warm")); } catch { return false; } })(), on => { try { localStorage.setItem("warm", JSON.stringify(on)); if (on && window.keepWarm) window.keepWarm(true); APP.refreshGpu(true); } catch {} }, "Costs about $1.22–1.75 per hour while warm; it sleeps by itself 10 minutes after you close the app."),
          h("div", { class: "ds-row ds-wrap" }, h("button", { class: "ds-btn sm", onclick: () => APP.refreshGpu(true).then(draw) }, icon("refresh"), "Refresh now"), window.BULK ? h("button", { class: "ds-btn sm bad", id: "st-cancel-all", onclick: () => window.BULK.cancelEverything({ refresh: () => APP.refreshGpu(true).then(draw) }) }, "⛔ Cancel everything") : null)),
        connectionCard(),
        card("defaults", "Generation defaults", "Used when you create a new project.", (() => { const sel = h("select", { class: "ds-select" }, [["9:16", "9:16 portrait"], ["16:9", "16:9 wide"], ["1:1", "1:1 square"]].map(([v, l]) => h("option", { value: v, selected: LS.get("def_aspect", "9:16") === v }, l))); sel.onchange = () => LS.set("def_aspect", sel.value); return h("div", { class: "ds-field" }, h("label", {}, "Default shape"), sel); })(),
          (() => { const sel = h("select", { class: "ds-select" }, [["high", "High (sharper, slower)"], ["fast", "Fast (cheaper)"]].map(([v, l]) => h("option", { value: v, selected: LS.get("def_quality", "high") === v }, l))); sel.onchange = () => LS.set("def_quality", sel.value); return h("div", { class: "ds-field", style: "margin-top:10px" }, h("label", {}, "Default video quality"), sel); })()),
        limitsCard(g),
        card("storage", "Storage", "Projects, characters and files are stored on this device only.", h("div", { id: "st-storage-body" }, h("div", { class: "ds-skel", style: "height:50px" }))),
        card("diag", "Diagnostics", "For troubleshooting. Nothing here contains your keys.", h("div", { id: "st-diag-body" }, h("div", { class: "ds-skel", style: "height:80px" }))));
      fillModels(); fillStorage(); fillDiag(g);
      const t = APP.state.setSection; if (t) setTimeout(() => { const el = document.getElementById("st-" + t); el && el.scrollIntoView({ block: "start" }); }, 50);
    }
    function connectionCard() {
      const b = base(), act = LS.get("connector_act", ""), last = Number(LS.get("connector_last", 0)), body = h("div", {});
      let host_ = ""; try { host_ = b ? new URL(b).host : ""; } catch {}
      const status = h("span", { class: "ds-pill" }, "Not tested");
      const test = async () => { if (!b) return; status.className = "ds-pill"; status.textContent = "Testing…"; const t0 = Date.now(); try { const r = await fetch(b + "/movies?limit=1"); if (!r.ok) throw new Error("answered " + r.status); await r.json(); status.className = "ds-pill ok"; status.textContent = "Reachable · " + (Date.now() - t0) + " ms"; } catch (e) { status.className = "ds-pill bad"; status.textContent = "Unreachable: " + APP.txt(e.message).slice(0, 60); } };
      body.append(b ? [kv("Chat connector", host_), kv("Link", act ? "Read + approve/reject/regenerate" : "Read only"), kv("Last sync", last ? APP.ago(last / 1000) : "not yet"), kv("Connection test", status),
        h("div", { class: "ds-row ds-wrap", style: "margin-top:10px" }, h("button", { class: "ds-btn sm", onclick: test }, "Test connection"), h("button", { class: "ds-btn sm", onclick: () => APP.syncNow().then(() => APP.toast("Synced", "ok")) }, icon("refresh"), "Sync now"),
          h("button", { class: "ds-btn sm bad", onclick: async () => { if (await APP.confirm("Disconnect from the chat connector?", "Items already copied stay on this device.", "Disconnect", true)) { LS.set("connector_url", ""); try { localStorage.removeItem("connector_url"); localStorage.removeItem("connector_act"); } catch {} draw(); } } }, "Disconnect")),
        h("div", { class: "ds-small", style: "margin-top:10px" }, "The link is kept on this device and stays connected after you close the app. To change what the app may do, ask your chat for “open in studio app” (read only) or “… with actions”, then open the new link here.")]
        : h("div", { class: "ds-empty" }, icon("link"), h("b", {}, "Not connected to a chat"), "In ChatGPT or Claude, say “open in studio app”, then open the link on this device. Movies and characters made in the chat then appear here.", h("button", { class: "ds-btn pri", onclick: () => { const v = (prompt("Paste the link the chat gave you:") || "").trim(); const c = (v.match(/connector=([^&\s]+)/) || [])[1], a = (v.match(/act=([^&\s]+)/) || [])[1]; if (c) { LS.set("connector_url", decodeURIComponent(c)); a ? LS.set("connector_act", decodeURIComponent(a)) : localStorage.removeItem("connector_act"); location.reload(); } else if (v) APP.toast("That is not a connector link.", "bad"); } }, "Paste a link")));
      if (b) setTimeout(test, 200);
      return card("connections", "Connections: MCP and ChatGPT", "The AI Studio connector is what ChatGPT/Claude use to make movies; this app shows the results.", body);
    }
    function limitsCard(g) {
      const lim = Number(LS.get("limit_day", 0)) || 0; const today = new Date().toDateString();
      const spent = (g.recent || []).filter(j => new Date((j.finished || 0) * 1000).toDateString() === today).reduce((a, j) => a + (j.cost || 0), 0);
      const inp = h("input", { class: "ds-input", type: "number", min: 0, step: 1, value: lim || "", placeholder: "No limit", inputmode: "decimal" }); inp.onchange = () => { LS.set("limit_day", String(Math.max(0, +inp.value || 0))); APP.toast("Saved", "ok"); };
      return card("limits", "Spending limits", "A reminder on this device: you are warned before a paid step would pass it. The chat connector has its own hard limits (ask the chat: “get budget”).", kv("GPU spend today (this device)", APP.money(spent)), kv("RunPod credit left", g.balance != null ? APP.money(g.balance) : "–"), h("div", { class: "ds-field", style: "margin-top:8px" }, h("label", {}, "Daily limit (USD)"), inp));
    }
    async function fillModels() { const el = document.getElementById("st-models-body"); if (!el) return; try { const m = await api("models"); el.replaceChildren(...m.items.slice(0, 8).map(x => h("div", { class: "st-kv" }, h("span", {}, x.name), h("span", { class: "ds-small", style: "text-align:right" }, x.last_ok ? "worked " + APP.ago(x.last_ok) : x.kind)))); } catch (e) { el.replaceChildren(h("div", { class: "ds-sub" }, "Could not load models: " + APP.txt(e.message))); } }
    async function fillStorage() { const el = document.getElementById("st-storage-body"); if (!el) return; try { const s = await api("storage"); const used = (s.data_mb || 0) + (s.outputs_mb || 0), q = s.quota_mb || 0; el.replaceChildren(kv("Used on this device", used + " MB"), kv("Available to the app", q ? q + " MB" : "unknown"), q ? h("div", { class: "ds-bar", style: "margin-top:8px" }, h("i", { style: `width:${Math.min(100, Math.round(100 * used / q))}%` })) : null, h("div", { class: "ds-small", style: "margin-top:8px" }, "Frames and videos are cached here so they open instantly and work offline.")); } catch (e) { el.replaceChildren(h("div", { class: "ds-sub" }, "Storage details are not available.")); } }
    async function fillDiag(g) {
      const el = document.getElementById("st-diag-body"); if (!el) return;
      const info = { app: "AI Studio v2", ui: "v2", time: new Date().toISOString(), online: navigator.onLine, viewport: innerWidth + "x" + innerHeight, ua: navigator.userAgent.slice(0, 90), gpu: { state: g.state, workers: g.workers, jobs: g.jobs, error: g.error }, running: (g.running || []).map(j => j.tool), connector: base() ? new URL(base()).host : "none", lastSync: LS.get("connector_last", 0), errors: (window.__errs || []).slice(-10) };
      const pre = h("pre", { style: "white-space:pre-wrap;font-size:11.5px;color:var(--muted);background:var(--bg);border-radius:12px;padding:10px;max-height:240px;overflow:auto;margin:0" }, JSON.stringify(info, null, 1));
      el.replaceChildren(pre, h("div", { class: "ds-row ds-wrap", style: "margin-top:10px" }, h("button", { class: "ds-btn sm", onclick: async () => { try { await navigator.clipboard.writeText(JSON.stringify(info, null, 1)); APP.toast("Copied", "ok"); } catch { APP.toast("Could not copy", "bad"); } } }, "Copy diagnostics"), h("button", { class: "ds-btn sm", onclick: () => { APP.changed("all"); APP.toast("Reloaded data", "ok"); } }, "Reload data")));
    }
    APP.on("view:settings", draw);
    setTimeout(() => { if (root() && !root().hidden) draw(); }, 0);
  }
})();
