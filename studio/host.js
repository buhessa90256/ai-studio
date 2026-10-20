// Mounts the Studio Pro screens inside the phone app's "Studio" view. The screens expect a tab bar (#tabs), a place for their sections
// (#studio-main) and a showTab() function; the PC app provides those itself, here this file does.
"use strict";
(() => {
  window.showTab = name => {
    document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll("#studio-main > .tab").forEach(t => t.classList.toggle("active", t.id === "tab-" + name));
    try { localStorage.setItem("tab", name); } catch {}
    document.querySelector(`#tabs [data-tab="${name}"]`)?.scrollIntoView?.({ inline: "center", block: "nearest" });
    window.scrollTo(0, 0);
  };
  window.StudioHost = {
    open() {
      try { navigator.storage?.persist?.(); } catch {}  // ask the browser not to clear projects when the phone is short of space
      const t = localStorage.getItem("tab");
      window.showTab(t && document.getElementById("tab-" + t) ? t : "dashboard");  // also reloads that screen's data
    },
  };
})();
