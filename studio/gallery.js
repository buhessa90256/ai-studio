// Mobile gallery pieces: cached thumbnails (small copies for grids, the ORIGINAL only in the viewer) and the full-screen viewer
// (pinch-zoom, double-tap, pan, swipe between scenes, download/share). No library: pointer events only, so it behaves the same on Android Chrome, iPhone Safari and desktop.
"use strict";
(() => {
  if (!window.AppShell || !window.AppShell.v2) return;
  const wait = setInterval(() => { if (window.APP && APP.go && window.SDB) { clearInterval(wait); init(); } }, 60);
  function init() {
    const { h, icon } = APP, D = window.SDB;

    // ------------------------------------------------------------------ thumbnails: a small copy per picture, made once, kept in memory and in IndexedDB (kv) so grids stay light and fast
    const mem = new Map(), pending = new Map();
    async function makeThumb(url, w) {
      const blob = await (await fetch(url)).blob();
      let bmp; try { bmp = await createImageBitmap(blob); } catch { return url; }   // not decodable here: fall back to the picture itself
      const k = Math.min(1, w / Math.max(bmp.width, 1)), cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(bmp.width * k)); cv.height = Math.max(1, Math.round(bmp.height * k));   // same aspect ratio: nothing is cropped, so faces are never cut off
      cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height); if (bmp.close) bmp.close();
      return new Promise(res => cv.toBlob(b => res(b || blob), "image/webp", 0.82));
    }
    APP.thumbUrl = (key, url, w = 360) => {
      const id = `${key}:${w}`;
      if (mem.has(id)) return Promise.resolve(mem.get(id));
      if (pending.has(id)) return pending.get(id);
      const p = (async () => {
        let blob = null;
        try { const r = await D.get("kv", "thumb:" + id); if (r && r.blob) blob = r.blob; } catch {}
        if (!blob) { blob = await makeThumb(url, w); if (typeof blob === "string") { mem.set(id, blob); return blob; } try { await D.put("kv", { key: "thumb:" + id, blob, at: Date.now() }); } catch {} }
        const u = URL.createObjectURL(blob); mem.set(id, u); return u;
      })().finally(() => pending.delete(id));
      pending.set(id, p); return p;
    };
    APP.thumbPeek = (key, w = 360) => mem.get(`${key}:${w}`) || "";
    // lazy <img>: nothing is fetched or decoded until it is near the screen
    const io = "IntersectionObserver" in window ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); e.target.__load && e.target.__load(); } }), { rootMargin: "400px" }) : null;
    APP.lazyThumb = (key, url, alt = "", w = 360) => {
      const img = h("img", { alt, decoding: "async", draggable: false, class: "gl-img" });
      img.__load = () => APP.thumbUrl(key, url, w).then(u => { img.onload = () => img.classList.add("in"); img.src = u; }).catch(() => { img.src = url; });
      if (io) io.observe(img); else img.__load();
      return img;
    };

    // ------------------------------------------------------------------ full-screen viewer
    let open = null;
    function viewer(items, start = 0, opts = {}) {
      if (open) open.close(true);
      let i = Math.max(0, Math.min(start, items.length - 1)), scale = 1, tx = 0, ty = 0, track = 0, anim = false, closed = false;
      const root = h("div", { class: "vw", role: "dialog", "aria-modal": "true", "aria-label": "Image viewer" });
      const title = h("div", { class: "vw-t" }), pill = h("span", { class: "ds-pill" }), count = h("span", { class: "vw-c" });
      const closeBtn = h("button", { class: "vw-b", type: "button", "aria-label": "Close viewer", onclick: () => close() }, icon("x"));
      const stage = h("div", { class: "vw-stage" }), slides = [0, 1, 2].map(() => h("div", { class: "vw-slide" }, h("div", { class: "vw-ph" }), h("img", { alt: "", draggable: false }), h("div", { class: "vw-spin", "aria-hidden": "true" })));
      const trackEl = h("div", { class: "vw-track" }, slides); stage.append(trackEl);
      const prev = h("button", { class: "vw-nav l", type: "button", "aria-label": "Previous scene", onclick: () => go(-1) }, icon("back")), next = h("button", { class: "vw-nav r", type: "button", "aria-label": "Next scene", onclick: () => go(1) }, h("span", { style: "display:inline-flex;transform:scaleX(-1)" }, icon("back")));
      const dl = h("button", { class: "ds-btn sm", type: "button", onclick: () => download() }, icon("down"), "Save"), share = navigator.share ? h("button", { class: "ds-btn sm", type: "button", onclick: () => doShare() }, "Share") : null;
      const rev = opts.onReview ? h("button", { class: "ds-btn sm pri", type: "button", onclick: () => { const it = items[i]; close(); opts.onReview(it); } }, icon("check"), "Review") : null;
      const reset = h("button", { class: "ds-btn sm", type: "button", onclick: () => setZoom(1, 0, 0, true) }, "Fit");
      root.append(h("div", { class: "vw-top" }, closeBtn, h("div", { class: "vw-meta" }, title, h("div", { class: "vw-sub" }, pill, count)), h("div", { class: "vw-hint" }, "Double-tap or pinch to zoom")), stage, prev, next, h("div", { class: "vw-bar" }, reset, dl, share, rev));

      const cur = () => slides[1], imgOf = el => el.querySelector("img");
      const fitted = () => { const im = imgOf(cur()), r = stage.getBoundingClientRect(); if (!im.naturalWidth) return { w: r.width, h: r.height, sw: r.width, sh: r.height }; const k = Math.min(r.width / im.naturalWidth, r.height / im.naturalHeight); return { w: im.naturalWidth * k, h: im.naturalHeight * k, sw: r.width, sh: r.height }; };
      const clamp = () => { const f = fitted(), mx = Math.max(0, (f.w * scale - f.sw) / 2), my = Math.max(0, (f.h * scale - f.sh) / 2); tx = Math.max(-mx, Math.min(mx, tx)); ty = Math.max(-my, Math.min(my, ty)); };
      const paint = () => { cur().firstElementChild.nextElementSibling.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`; trackEl.style.transform = `translate3d(${track}px,0,0)`; root.classList.toggle("zoomed", scale > 1.02); };
      function setZoom(s, cx, cy, animate) { const r = stage.getBoundingClientRect(), ox = cx - (r.left + r.width / 2), oy = cy - (r.top + r.height / 2), k = s / scale; tx = scale === 1 && s > 1 ? -ox * (k - 1) : tx * k - ox * (k - 1) * (s > 1 ? 1 : 0); ty = scale === 1 && s > 1 ? -oy * (k - 1) : ty * k - oy * (k - 1) * (s > 1 ? 1 : 0); scale = Math.max(1, Math.min(s, 6)); if (scale === 1) { tx = 0; ty = 0; } clamp(); const im = imgOf(cur()); im.style.transition = animate ? "transform .22s cubic-bezier(.2,.7,.2,1)" : "none"; paint(); }

      function fill(slide, it, hi) {
        const im = imgOf(slide), ph = slide.firstElementChild, sp = slide.lastElementChild;
        im.style.transform = ""; im.classList.remove("ready"); im.removeAttribute("src"); slide.querySelector("video")?.remove();
        if (!it) { ph.style.backgroundImage = ""; sp.hidden = true; return; }
        if (it.video) { ph.style.backgroundImage = it.thumb ? `url(${it.thumb})` : ""; sp.hidden = true; const v = h("video", { src: it.video, controls: true, playsinline: true, preload: "metadata", poster: it.thumb || null, class: "vw-video" }); slide.append(v); return; }
        ph.style.backgroundImage = it.thumb ? `url(${it.thumb})` : "";   // the small copy shows at once, the original replaces it when decoded
        sp.hidden = false;
        if (!hi) return;
        im.onload = () => { sp.hidden = true; im.classList.add("ready"); ph.style.backgroundImage = ""; };
        im.onerror = () => { sp.hidden = true; ph.classList.add("err"); };
        im.src = it.url;   // ORIGINAL generated picture (full resolution), never the thumbnail
      }
      function render() {
        const it = items[i];
        title.textContent = it.title || "Image"; pill.className = "ds-pill " + (it.tone || ""); pill.textContent = it.status || ""; count.textContent = `${i + 1} / ${items.length}`;
        fill(slides[0], items[i - 1], false); fill(slides[1], it, true); fill(slides[2], items[i + 1], false);
        slides[0].classList.toggle("e", !items[i - 1]); slides[2].classList.toggle("e", !items[i + 1]);
        prev.hidden = i === 0; next.hidden = i === items.length - 1; scale = 1; tx = ty = 0; track = 0; paint();
        for (const j of [i - 1, i + 1]) if (items[j] && items[j].url && !items[j].video) { const pre = new Image(); pre.decoding = "async"; pre.src = items[j].url; }   // neighbours are fetched ahead so swiping feels instant
        slides[1].querySelector("video")?.setAttribute("tabindex", "0");
      }
      function go(d) { const j = i + d; if (!items[j] || anim) return; const w = stage.getBoundingClientRect().width; anim = true; trackEl.style.transition = "transform .24s cubic-bezier(.2,.7,.2,1)"; track = -d * w; paint(); setTimeout(() => { trackEl.style.transition = "none"; i = j; render(); anim = false; }, 250); }

      // pointer handling: one finger = pan (zoomed) or swipe (fit); two fingers = pinch; double tap = zoom
      const ptrs = new Map(); let pinch0 = null, pan0 = null, lastTap = 0, lastXY = [0, 0], swipe = null;
      const dist = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y); }, mid = () => { const [a, b] = [...ptrs.values()]; return [(a.x + b.x) / 2, (a.y + b.y) / 2]; };
      stage.addEventListener("pointerdown", e => {
        if (e.target.closest("video")) return;
        try { stage.setPointerCapture(e.pointerId); } catch {} ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (ptrs.size === 2) { pinch0 = { d: dist(), s: scale }; swipe = null; pan0 = null; imgOf(cur()).style.transition = "none"; }
        else { pan0 = { x: e.clientX, y: e.clientY, tx, ty }; swipe = scale <= 1.02 ? { x: e.clientX, y: e.clientY, t: Date.now(), on: false } : null; const now = Date.now(); if (now - lastTap < 300 && Math.hypot(e.clientX - lastXY[0], e.clientY - lastXY[1]) < 30) { setZoom(scale > 1.2 ? 1 : 2.6, e.clientX, e.clientY, true); lastTap = 0; swipe = null; } else lastTap = now; lastXY = [e.clientX, e.clientY]; }
      });
      stage.addEventListener("pointermove", e => {
        if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (ptrs.size === 2 && pinch0) { const [cx, cy] = mid(); const s = Math.max(1, Math.min(6, pinch0.s * dist() / pinch0.d)); const k = s / scale; const r = stage.getBoundingClientRect(); tx = tx * k - (cx - (r.left + r.width / 2)) * (k - 1); ty = ty * k - (cy - (r.top + r.height / 2)) * (k - 1); scale = s; clamp(); paint(); return; }
        if (ptrs.size !== 1 || !pan0) return;
        const dx = e.clientX - pan0.x, dy = e.clientY - pan0.y;
        if (scale > 1.02) { tx = pan0.tx + dx; ty = pan0.ty + dy; clamp(); paint(); }
        else if (swipe) { if (!swipe.on && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) swipe.on = true; if (swipe.on && !anim) { const edge = (dx > 0 && !items[i - 1]) || (dx < 0 && !items[i + 1]); track = edge ? dx / 4 : dx; trackEl.style.transition = "none"; paint(); } }
      });
      const end = e => {
        if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId);
        if (ptrs.size < 2) pinch0 = null;
        if (scale < 1.05 && scale !== 1) setZoom(1, 0, 0, true);
        if (ptrs.size === 1) { const [p] = [...ptrs.values()]; pan0 = { x: p.x, y: p.y, tx, ty }; }
        if (ptrs.size === 0) {
          if (swipe && swipe.on) { const dx = e.clientX - swipe.x, v = Math.abs(dx) / Math.max(1, Date.now() - swipe.t), w = stage.getBoundingClientRect().width; if ((Math.abs(dx) > w * 0.22 || v > 0.5) && items[i + (dx < 0 ? 1 : -1)]) go(dx < 0 ? 1 : -1); else { trackEl.style.transition = "transform .2s"; track = 0; paint(); } }
          swipe = null; pan0 = null;
        }
      };
      stage.addEventListener("pointerup", end); stage.addEventListener("pointercancel", end);
      stage.addEventListener("wheel", e => { e.preventDefault(); setZoom(Math.max(1, Math.min(6, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15))), e.clientX, e.clientY, false); }, { passive: false });
      const key = e => { if (e.key === "Escape") close(); else if (e.key === "ArrowLeft" && scale <= 1.02) go(-1); else if (e.key === "ArrowRight" && scale <= 1.02) go(1); else if (e.key === "+" || e.key === "=") setZoom(Math.min(6, scale * 1.4), innerWidth / 2, innerHeight / 2, true); else if (e.key === "-") setZoom(Math.max(1, scale / 1.4), innerWidth / 2, innerHeight / 2, true); else if (e.key === "0") setZoom(1, 0, 0, true); };
      window.addEventListener("keydown", key);
      const onResize = () => { clamp(); paint(); }; window.addEventListener("resize", onResize); window.addEventListener("orientationchange", onResize);

      async function blobOf(it) { return (await fetch(it.video || it.url)).blob(); }
      async function download() { const it = items[i]; try { const b = await blobOf(it), a = h("a", { href: URL.createObjectURL(b), download: (it.filename || (it.title || "scene").replace(/[^\w-]+/g, "_")) + (it.video ? ".mp4" : ".png") }); document.body.append(a); a.click(); a.remove(); } catch (e) { APP.fail(e, "Download"); } }
      async function doShare() { const it = items[i]; try { const b = await blobOf(it), f = new File([b], (it.title || "scene").replace(/[^\w-]+/g, "_") + (it.video ? ".mp4" : ".png"), { type: b.type }); if (navigator.canShare && navigator.canShare({ files: [f] })) await navigator.share({ files: [f], title: it.title || "AI Studio" }); else await download(); } catch (e) { if (e && e.name !== "AbortError") APP.fail(e, "Share"); } }

      // Android back button / iPhone swipe-back closes the viewer instead of leaving the project
      let pushed = false; try { history.pushState({ vw: 1 }, ""); pushed = true; } catch {}
      const onPop = () => { if (!closed) { pushed = false; close(); } }; window.addEventListener("popstate", onPop);
      const prevFocus = document.activeElement, prevOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = "hidden"; document.body.append(root); closeBtn.focus();
      function close(silent) { if (closed) return; closed = true; window.removeEventListener("keydown", key); window.removeEventListener("resize", onResize); window.removeEventListener("orientationchange", onResize); window.removeEventListener("popstate", onPop); root.remove(); document.documentElement.style.overflow = prevOverflow; if (pushed && !silent) { pushed = false; try { history.back(); } catch {} } open = null; try { prevFocus && prevFocus.focus && prevFocus.focus(); } catch {} opts.onClose && opts.onClose(i); }
      open = { close, index: () => i, el: root, go, zoomTo: (s) => setZoom(s, innerWidth / 2, innerHeight / 2, false), state: () => ({ scale, tx, ty, i }) };
      render(); return open;
    }
    // keyboard: --vvh follows the visible viewport (iOS Safari does not resize the layout viewport), and html.kbd hides the bottom navigation while a field is focused,
    // so the chat input sits right above the keyboard and nothing overlaps it
    const vv = window.visualViewport, typing = () => /^(TEXTAREA|INPUT)$/.test((document.activeElement || {}).tagName || "");
    const vvUpdate = () => { const hh = vv ? vv.height : innerHeight; document.documentElement.style.setProperty("--vvh", Math.round(hh) + "px"); document.documentElement.classList.toggle("kbd", !!vv && innerHeight - vv.height > 140 && typing()); };
    if (vv) { vv.addEventListener("resize", vvUpdate); vv.addEventListener("scroll", vvUpdate); }
    window.addEventListener("orientationchange", () => setTimeout(vvUpdate, 250)); document.addEventListener("focusin", () => setTimeout(vvUpdate, 300)); document.addEventListener("focusout", () => setTimeout(vvUpdate, 150)); vvUpdate();
    APP.viewer = viewer;
    document.dispatchEvent(new Event("gallery-ready"));
  }
})();
