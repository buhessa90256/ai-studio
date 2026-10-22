// Library: characters and assets in one place, with filters, search, sorting and lazy-loaded previews.
"use strict";
(() => {
  if (!window.AppShell || !window.AppShell.v2) return;
  const wait = setInterval(() => { if (window.APP && APP.go && window.SP && SP.openAsset) { clearInterval(wait); init(); } }, 80);
  function init() {
    const { h, icon, txt, api } = APP, root = () => document.getElementById("v-library");
    const FILTERS = [["characters", "Characters"], ["images", "Images"], ["videos", "Videos"], ["audio", "Audio"], ["sheets", "Reference sheets"], ["frames", "Generated frames"], ["favorites", "Favorites"], ["results", "Quick results"]];
    const S = { filter: "characters", q: "", sort: "new", limit: 48 };
    let my = 0;
    // media is only fetched when it scrolls into view
    const io = "IntersectionObserver" in window ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { const el = e.target; io.unobserve(el); if (el.dataset.src) { el.src = el.dataset.src; delete el.dataset.src; } } }), { rootMargin: "300px" }) : null;
    const lazy = (el, url) => { if (io) { el.dataset.src = url; io.observe(el); } else el.src = url; return el; };

    async function draw() {
      const r = root(); if (!r || r.hidden) return; const mine = ++my;
      S.filter = APP.state.libFilter || S.filter;
      const bar = h("div", { class: "lb-bar" },
        h("div", { class: "ds-row" }, h("div", { class: "ds-grow ds-sub" }, "Characters and files for all your projects"), S.filter === "characters" ? h("button", { class: "ds-btn pri sm", onclick: () => SP.editCharacter({ name: "", kind: "human", refs: [], costumes: [] }, draw) }, icon("plus"), "New character") : h("button", { class: "ds-btn pri sm", onclick: () => upload.click() }, icon("up"), "Upload")),
        h("div", { class: "ds-row" }, h("div", { class: "ds-grow" }, (() => { const i = h("input", { class: "ds-input", placeholder: "Search name or tag", value: S.q, "aria-label": "Search the library" }); i.oninput = () => { S.q = i.value; clearTimeout(draw.t); draw.t = setTimeout(draw, 280); }; return i; })()),
          S.filter === "characters" || S.filter === "results" ? null : (() => { const s = h("select", { class: "ds-select", style: "width:auto", "aria-label": "Sort" }, [["new", "Newest"], ["old", "Oldest"], ["name", "Name"], ["size", "Largest"]].map(([v, l]) => h("option", { value: v, selected: S.sort === v }, l))); s.onchange = () => { S.sort = s.value; draw(); }; return s; })()),
        h("div", { class: "ds-chips", role: "tablist" }, FILTERS.map(([k, l]) => h("button", { type: "button", class: "ds-chip" + (S.filter === k ? " on" : ""), role: "tab", onclick: () => { S.filter = k; S.limit = 48; APP.go("/library/" + k); } }, l))));
      const upload = h("input", { type: "file", multiple: true, hidden: true, accept: "image/*,video/*,audio/*" });
      upload.onchange = async () => { try { const r2 = await SP.uploadFiles([...upload.files]); APP.toast(r2.length + " added to the library", "ok"); APP.changed("all"); draw(); } catch (e) { APP.fail(e, "Upload"); } };
      const body = h("div", { id: "lb-body" }, h("div", { class: "ds-grid" }, [1, 2, 3, 4, 5, 6].map(() => h("div", { class: "ds-skel", style: "height:150px" }))));
      r.replaceChildren(bar, body, upload);
      try { await fill(body, mine); } catch (e) { if (mine === my) { body.replaceChildren(h("div", { class: "ds-empty" }, icon("warn"), h("b", {}, "Could not load the library"), APP.txt(e.message, "Unknown error"), h("button", { class: "ds-btn", onclick: draw }, "Try again"))); } }
    }
    const empty = (title, text, btn) => h("div", { class: "ds-empty" }, icon("lib"), h("b", {}, title), text, btn || null);
    async function fill(body, mine) {
      const q = S.q.trim().toLowerCase();
      if (S.filter === "characters") {
        let items = await APP.chars(true); if (mine !== my) return; if (q) items = items.filter(c => (c.name + " " + (c.description || "")).toLowerCase().includes(q));
        body.replaceChildren(items.length ? h("div", { class: "ds-grid" }, items.map(c => h("div", { class: "lb-tile tall", role: "button", tabindex: 0, onclick: () => SP.editCharacter(c, () => { APP.changed("chars"); draw(); }) },
          h("div", { class: "ds-thumb" }, c.thumb ? lazy(h("img", { alt: c.name, decoding: "async" }), c.thumb) : icon("user")), h("div", { class: "cap" }, h("b", {}, txt(c.name, "Unnamed")), h("span", { class: "ds-small", style: "display:block" }, `${(c.refs || []).length} reference${(c.refs || []).length === 1 ? "" : "s"}`)))))
          : empty(q ? "No characters match" : "No characters yet", "Characters keep faces and outfits consistent across scenes.", q ? null : h("button", { class: "ds-btn pri", onclick: () => SP.editCharacter({ name: "", kind: "human", refs: [], costumes: [] }, draw) }, "Create a character")));
        return;
      }
      if (S.filter === "results") { body.replaceChildren(empty("Quick create results", "Images, videos and sounds from the Quick create tools are saved here.", h("button", { class: "ds-btn pri", onclick: () => window.show("gallery") }, "Open results"))); return; }
      const type = { images: "image", videos: "video", audio: "audio" }[S.filter] || "";
      const qs = new URLSearchParams({ type, q: S.q, favorite: S.filter === "favorites" ? 1 : "", deleted: "" });
      let items = (await api("assets?" + qs)).items; if (mine !== my) return;
      if (S.filter === "images") items = items.filter(a => !/_frame_v\d+|_final/.test(a.filename));
      if (S.filter === "sheets") items = items.filter(a => a.type === "character" || (a.tags || []).some(t => /reference|turnaround|sheet/i.test(t)) || /sheet|turnaround|reference/i.test(a.filename));
      if (S.filter === "frames") {
        const ids = new Set(); for (const p of await APP.projects()) for (const s of await APP.scenes(p.id)) { if (s.start_asset) ids.add(s.start_asset); for (const x of ((s.settings || {}).frame_history || [])) ids.add(x.asset); }
        items = items.filter(a => ids.has(a.id) || /_frame_v\d+/.test(a.filename));
      }
      const by = { new: (a, b) => b.created - a.created, old: (a, b) => a.created - b.created, name: (a, b) => a.filename.localeCompare(b.filename), size: (a, b) => b.size - a.size }[S.sort];
      items = items.slice().sort(by);
      if (!items.length) { body.replaceChildren(empty(q ? "Nothing matches" : "Nothing here yet", S.filter === "frames" ? "Start frames you generate appear here, with all their versions." : "Upload files or generate something, and it shows up here.")); return; }
      const shown = items.slice(0, S.limit);
      body.replaceChildren(h("div", { class: "ds-grid" }, shown.map(a => {
        const media = a.type === "video" ? lazy(h("video", { muted: true, preload: "metadata", playsinline: true }), a.url + "#t=0.2") : a.type === "audio" ? icon("mic") : lazy(h("img", { alt: a.filename, decoding: "async" }), a.url);
        const tall = a.height && a.width && a.height / a.width > 1.3;
        return h("div", { class: "lb-tile" + (tall ? " tall" : ""), role: "button", tabindex: 0, onclick: () => SP.openAsset(a, () => { APP.changed("all"); draw(); }) }, h("div", { class: "ds-thumb" }, media, a.favorite ? h("span", { class: "tag ds-pill warn" }, icon("star")) : null),
          h("div", { class: "cap" }, APP.txt(a.filename, "Untitled"), h("span", { class: "ds-small", style: "display:block" }, `${a.type}${a.width ? " · " + a.width + "×" + a.height : ""} · ${SP.fmtSize(a.size)}`)));
      })), items.length > shown.length ? h("div", { style: "text-align:center;margin:16px" }, h("button", { class: "ds-btn", onclick: () => { S.limit += 48; fill(body, ++my); } }, `Show more (${items.length - shown.length})`)) : null);
    }
    APP.on("view:library", draw); APP.on("route", () => { if (location.hash.startsWith("#/library")) draw(); });
    APP.on("changed", () => { if (!root().hidden) draw(); });
    setTimeout(() => { if (root() && !root().hidden) draw(); }, 0);
  }
})();
