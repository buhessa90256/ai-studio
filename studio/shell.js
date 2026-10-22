// AI Studio v2 shell: four primary sections (Home, Projects, Library, Settings), hash routing, shared header state.
// ?ui=classic (or Settings -> Interface) switches back to the previous interface without losing anything: all data and screens are the same.
"use strict";
(() => {
  const params = new URLSearchParams(location.search);
  if (params.get("ui") === "classic") { try { localStorage.setItem("ui_mode", "classic"); } catch {} }
  if (params.get("ui") === "v2") { try { localStorage.removeItem("ui_mode"); } catch {} }
  const classic = (() => { try { return localStorage.getItem("ui_mode") === "classic"; } catch { return false; } })();
  window.AppShell = { v2: !classic, onShow() {}, landing: () => "home" };
  if (classic) return;
  document.documentElement.setAttribute("data-ui", "v2");

  const wait = setInterval(() => { if (window.APP && window.SP && document.getElementById("studio-main") && window.StudioBackend) { clearInterval(wait); boot(); } }, 80);
  function boot() {
    const { h, icon } = APP, main = document.querySelector("main"), nav = document.getElementById("nav");
    // --- sections owned by the shell (the old ones stay: studio = Projects workspace host, settings = extended, home/tool = Quick create)
    for (const id of ["hub", "library"]) if (!document.getElementById("v-" + id)) main.insertBefore(h("section", { id: "v-" + id, hidden: true }), document.getElementById("v-home"));
    // --- four primary navigation items, fixed bottom bar on phones, side rail on desktop
    const items = [["hub", "Home", "home"], ["studio", "Projects", "film"], ["library", "Library", "lib"], ["settings", "Settings", "gear"]];
    nav.replaceChildren(...items.map(([view, label, ico]) => {
      const b = h("button", { type: "button", "data-view": view, "aria-label": label }, icon(ico), h("span", {}, label));
      if (view === "hub") b.append(h("b", { class: "badge", id: "busy-badge", hidden: true }));
      b.onclick = () => go(view === "hub" ? "/home" : view === "studio" ? "/projects" : "/" + view); return b;
    }));

    function go(path) { if (location.hash === "#" + path) route(); else location.hash = path; }
    APP.go = go;
    function setNav(view) { const m = { hub: "hub", home: "hub", tool: "hub", studio: "studio", library: "library", gallery: "library", settings: "settings" }[view]; nav.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.view === m)); }
    const TITLES = { hub: "Home", studio: "Projects", library: "Library", settings: "Settings", home: "Quick create", gallery: "Results" };
    window.AppShell.onShow = (view, title) => {
      setNav(view); if (!title && TITLES[view]) document.getElementById("title").textContent = TITLES[view];
      document.getElementById("back").hidden = !(view === "tool" || view === "home");
      if (view === "hub") APP.emit("view:hub"); if (view === "library") APP.emit("view:library"); if (view === "studio") APP.emit("view:studio"); if (view === "settings") APP.emit("view:settings");
    };
    window.AppShell.landing = () => (location.hash && location.hash.length > 2 ? "route" : "hub");
    const back = document.getElementById("back"); back.onclick = () => { if (!document.getElementById("v-tool").hidden) window.show("home"); else go("/home"); };   // tool -> tool picker -> Home

    // --- routes: #/home  #/projects  #/projects/<id>[/<mode>[/<sceneId>]]  #/library[/<filter>]  #/settings[/<section>]
    function route() {
      const parts = (location.hash || "#/home").slice(2).split("/").filter(Boolean), top = parts[0] || "home";
      if (top === "projects") { APP.state.projectId = parts[1] || ""; APP.state.mode = parts[2] || "storyboard"; APP.state.sceneId = parts[3] || ""; APP.state.review = parts[4] === "review"; if (parts[1]) APP.LS.set("sb_project", parts[1]); window.show("studio"); APP.emit("route", APP.state); }
      else if (top === "library") { APP.state.libFilter = parts[1] || "characters"; window.show("library"); APP.emit("route", APP.state); }
      else if (top === "settings") { APP.state.setSection = parts[1] || ""; window.show("settings"); APP.emit("route", APP.state); }
      else if (top === "create") window.show("home");
      else window.show("hub");
      window.scrollTo(0, 0);
    }
    window.addEventListener("hashchange", route);
    window.AppShell.route = route;
    const gated = ["v-setup", "v-lock"].some(id => { const e = document.getElementById(id); return e && !e.hidden; });   // first run / unlock screens stay in charge
    if (!gated) { if (location.hash.length > 2) route(); else window.show("hub"); }
    // quick create / keyboard shortcuts (desktop)
    window.addEventListener("keydown", e => {
      if (e.target.closest && e.target.closest("input,textarea,select,[contenteditable]")) return;
      if (e.altKey && !e.ctrlKey && !e.metaKey) { const k = { "1": "/home", "2": "/projects", "3": "/library", "4": "/settings" }[e.key]; if (k) { e.preventDefault(); go(k); } }
      if (e.key === "?" ) APP.toast("Shortcuts: Alt+1 Home · Alt+2 Projects · Alt+3 Library · Alt+4 Settings · ←/→ scenes · A approve · R regenerate · Esc close", "", 7000);
    });
    APP.refreshGpu(true).catch(() => {});
    APP.emit("shell:ready");
  }
})();
