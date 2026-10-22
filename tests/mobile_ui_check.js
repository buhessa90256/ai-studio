// Mobile UI regression checks. Runs INSIDE the page (no build, no network, no GPU, nothing is generated):
//   1. serve the folder:   python -m http.server 8800        (in ai-studio-mobile/)
//   2. open http://localhost:8800/index.html?ui=v2 in a browser (or the app's browser pane) at the width you want to test
//   3. in the console:     eval(await (await fetch('/tests/mobile_ui_check.js')).text()); await __mobileCheck({ width: 390 })   (width = the size you resized to; the run aborts if it differs)
// It creates a throw-away project "UI check <time>" (and removes it again), so existing projects and data are never touched.
// Result: { width, failures: [...], passed: n }. An empty failures list = pass. Run it at 320, 360, 390, 430, 768, 1024 and in landscape (e.g. 640x360).
"use strict";
window.__mobileCheck = async function (opts = {}) {
  const fails = [], ok = (c, msg) => { if (!c) fails.push(msg); return !!c; }, wait = ms => new Promise(r => setTimeout(r, ms)), W = innerWidth, phone = W < 900;
  const vis = e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !e.closest("[hidden]") && r.bottom > 0 && r.top < innerHeight * 4; };
  const go = async h => { location.hash = h; await wait(1800); };
  if (opts.width && Math.abs(innerWidth - opts.width) > 1) return { width: W, failures: [`viewport is ${innerWidth}px, expected ${opts.width}px: resize the window and run again`], passed: false };
  const pr = await APP.saveProject({}, { name: "UI check " + Date.now(), aspect: "9:16", resolution: "768x1344", duration: 30, characters: [], story: "", description: "", data: {} });
  const pid = pr.id, key = k => k + ":" + pid;
  try {
    // 1. Manual Editor is the default for a project that has never been opened, and the choice is remembered per project
    try { localStorage.removeItem(key("ws_mode")); localStorage.removeItem(key("ws_sec")); } catch {}
    await go("#/projects/" + pid);
    ok(document.querySelector(".ws-mode button.on")?.textContent.includes("Manual"), "first open must select Manual Editor");
    ok(document.querySelector(".ws-tabs .on")?.textContent === "Storyboard", "first open must show the Storyboard section");
    ok(!document.querySelector(".ws-ai"), "AI Director must not open by itself");
    await go("#/projects/" + pid + "/ai"); ok(document.querySelector(".ws-mode button.on")?.textContent.includes("AI"), "AI Director must open when chosen");
    await go("#/home"); await go("#/projects/" + pid); ok(document.querySelector(".ws-mode button.on")?.textContent.includes("AI"), "the chosen mode must be remembered for this project");
    await go("#/projects/" + pid + "/storyboard"); ok(document.querySelector(".ws-mode button.on")?.textContent.includes("Manual"), "switching back to Manual works");
    // 2. no sideways scrolling and nothing wider than the screen, on every section
    const secs = ["storyboard", "scenes", "characters", "videos", "settings", "ai"];
    // a scene so the gallery/scene screens have content (no image, no job: nothing is generated)
    await APP.api("scenes", { project_id: pid, title: "Check scene", action: "Hessa waves", characters: [] }); APP.changed("scenes");
    for (const s of secs) {
      await go("#/projects/" + pid + "/" + s);
      ok(document.documentElement.scrollWidth <= innerWidth + 1, `${s}: page scrolls sideways (${document.documentElement.scrollWidth} > ${innerWidth})`);
      ok(!/\b(null|undefined|\[object)/.test(document.body.innerText), `${s}: raw null/undefined text on screen`);
      const wide = [...document.querySelectorAll("#ws-root *")].filter(e => vis(e) && !e.closest(".ws-tabs,.ws-strip,.gl-bar,.dir-steps,.ds-chips,.ws-rail,.dir-list,.ws-legacy,.vw") && e.getBoundingClientRect().right > innerWidth + 2).map(e => (e.className || e.tagName).toString().slice(0, 30));
      ok(!wide.length, `${s}: clipped/overflowing elements: ${[...new Set(wide)].slice(0, 5).join(", ")}`);
      if (phone) {
        const small = [...document.querySelectorAll("#ws-root button, #ws-root a[href], #ws-root [role=button], #ws-root [role=tab], #ws-root select, #ws-root input:not([type=hidden]):not([type=file]):not([type=checkbox])")].filter(e => vis(e) && !e.closest(".ws-legacy")).filter(e => { const r = e.getBoundingClientRect(); return r.width < 43.5 || r.height < 43.5; }).map(e => `${(e.className || e.tagName).toString().slice(0, 24)} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
        ok(!small.length, `${s}: touch targets under 44px: ${[...new Set(small)].slice(0, 6).join("; ")}`);
      }
    }
    // 3. the selected section tab is visible (scrolled into view)
    await go("#/projects/" + pid + "/settings"); const on = document.querySelector(".ws-tabs .on"), bar = document.querySelector(".ws-tabs"), a = on.getBoundingClientRect(), b = bar.getBoundingClientRect();
    ok(a.left >= b.left - 1 && a.right <= b.right + 1, "the selected section tab must be fully visible");
    // 4. gallery columns: 2 on phones, 3-4 on larger screens
    await go("#/projects/" + pid + "/storyboard"); const cols = getComputedStyle(document.querySelector(".gl-grid")).gridTemplateColumns.split(" ").length;
    ok(W < 600 ? cols === 2 : W < 900 ? cols === 3 : cols === 4, `gallery columns at ${W}px: ${cols}`);
    // 5. sticky action bar never covers the navigation and the page keeps room under it
    await go("#/projects/" + pid + "/scenes"); const bar2 = document.querySelector(".ws-bar"), nav = document.querySelector("nav");
    if (ok(bar2, "scenes: action bar missing") && phone && nav && vis(nav)) {
      const bb = bar2.getBoundingClientRect(), nb = nav.getBoundingClientRect(); ok(bb.bottom <= nb.top + 1, "action bar overlaps the bottom navigation");
      ok(parseFloat(getComputedStyle(document.querySelector(".ws")).paddingBottom) >= bb.height, "page needs bottom padding at least as tall as the action bar");
    }
    // 6. the full-screen viewer (opened on a synthetic image so nothing depends on generated content)
    const img = document.createElement("canvas"); img.width = 768; img.height = 1344; const g = img.getContext("2d"); g.fillStyle = "#336"; g.fillRect(0, 0, 768, 1344); g.fillStyle = "#fff"; g.fillRect(300, 400, 168, 168);
    const url = URL.createObjectURL(await new Promise(r => img.toBlob(r, "image/png"))), v = APP.viewer([{ url, thumb: "", title: "Check 1", status: "Approved", tone: "ok" }, { url, thumb: "", title: "Check 2", status: "To review", tone: "warn" }], 0, {});
    await wait(500); const root = document.querySelector(".vw"), im = root && root.querySelectorAll(".vw-slide")[1].querySelector("img");
    if (ok(root, "viewer did not open")) {
      ok(im.naturalWidth === 768 && im.naturalHeight === 1344, "viewer must load the original image, not a thumbnail");
      const r = im.getBoundingClientRect(); ok(r.width <= innerWidth + 1 && r.height <= innerHeight + 1 && Math.abs(r.width / r.height - 768 / 1344) < 0.02, "viewer image must fit the screen with its aspect ratio");
      const st = root.querySelector(".vw-stage"), fire = (t, id, x, y) => st.dispatchEvent(new PointerEvent(t, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: "touch" }));
      const cx = innerWidth / 2, cy = innerHeight / 2;
      fire("pointerdown", 1, cx, cy); fire("pointerup", 1, cx, cy); await wait(60); fire("pointerdown", 1, cx, cy); fire("pointerup", 1, cx, cy); await wait(350); ok(root.classList.contains("zoomed"), "double-tap must zoom");
      const t0 = im.style.transform; fire("pointerdown", 1, cx, cy); fire("pointermove", 1, cx - 40, cy - 30); fire("pointerup", 1, cx - 40, cy - 30); await wait(60); ok(im.style.transform !== t0 && root.querySelector(".vw-c").textContent.startsWith("1"), "dragging while zoomed must pan, not change scene");
      [...root.querySelectorAll(".vw-bar button")].find(x => x.textContent === "Fit").click(); await wait(350); ok(!root.classList.contains("zoomed"), "Fit must reset the zoom");
      fire("pointerdown", 1, cx + 90, cy); fire("pointermove", 1, cx, cy + 2); fire("pointermove", 1, cx - 100, cy + 2); fire("pointerup", 1, cx - 100, cy + 2); await wait(500); ok(root.querySelector(".vw-c").textContent.startsWith("2"), "swiping left must go to the next scene");
      fire("pointerdown", 1, cx - 80, cy); fire("pointermove", 1, cx + 20, cy); fire("pointermove", 1, cx + 110, cy); fire("pointerup", 1, cx + 110, cy); await wait(500); ok(root.querySelector(".vw-c").textContent.startsWith("1"), "swiping right must go back");
      fire("pointerdown", 1, cx - 80, cy); fire("pointerdown", 2, cx + 80, cy); fire("pointermove", 1, cx - 120, cy); fire("pointermove", 2, cx + 120, cy); await wait(40); ok(root.classList.contains("zoomed"), "pinch must zoom"); fire("pointerup", 2, cx + 120, cy); fire("pointerup", 1, cx - 120, cy);
      const cb = root.querySelector(".vw-b").getBoundingClientRect(); ok(cb.width >= 44 && cb.height >= 44, "viewer close button must be at least 44x44");
      v.close(); await wait(200); ok(!document.querySelector(".vw"), "viewer must close");
    }
    // 7. keyboard: the chat input is above the bottom navigation, and the navigation steps aside while typing
    await go("#/projects/" + pid + "/ai"); const inp = document.querySelector(".dir-in"), ta = document.querySelector(".dir-in textarea");
    if (ok(inp && ta, "chat input missing")) { const ib = inp.getBoundingClientRect(), nb2 = document.querySelector("nav").getBoundingClientRect(); if (phone) ok(ib.bottom <= nb2.top + 1, "chat input overlaps the bottom navigation"); ok(ta.getBoundingClientRect().height >= 43, "chat input too small"); }
    // 8. Manual Editor again keeps the chat reachable (header button) without covering content
    await go("#/projects/" + pid + "/storyboard"); ok(!!document.querySelector('.ws-head2 button[aria-label="Open AI Director chat"]'), "chat button missing in Manual Editor");
  } catch (e) { fails.push("check crashed: " + (e && e.message)); }
  // clean up: the throw-away project and its scene (nothing else is touched)
  try { for (const s of (await APP.api("scenes?project=" + pid)).items) await APP.api("scenes/" + s.id + "/delete", {}); await SDB.del("projects", pid); await SDB.del("kv", "director:" + pid); localStorage.removeItem(key("ws_mode")); localStorage.removeItem(key("ws_sec")); APP.changed("all"); } catch {}
  return { width: W, height: innerHeight, failures: fails, passed: fails.length === 0 };
};
