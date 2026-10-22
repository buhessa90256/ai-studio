// AI Director, chat UI: one chat node per project (reused across redraws), used full-size in "AI Director" mode and as a collapsible dock in "Manual Editor" mode.
// Shows real saved media from the project (never placeholders): if a picture cannot be loaded it says so and links to the Library.
"use strict";
(() => {
  if (!window.AppShell || !window.AppShell.v2) return;
  const wait = setInterval(() => { if (window.APP && window.DIR && DIR.runTool && DIR.handleUser) { clearInterval(wait); init(); } }, 80);
  function init() {
    const { h, icon } = APP, B = StudioBackend, api = APP.api;
    const LABEL = { DRAFT: "Ready", STORYBOARD_GENERATING: "Drawing storyboard", STORYBOARD_AWAITING_APPROVAL: "Approve storyboard", CHARACTERS_CHECKING: "Checking characters", CHARACTERS_GENERATING: "Drawing characters", CHARACTERS_AWAITING_APPROVAL: "Approve characters", FIRST_TWO_FRAMES_GENERATING: "Making first frames", FIRST_TWO_FRAMES_AWAITING_APPROVAL: "Approve first frames", REMAINING_FRAMES_GENERATING: "Making frames", FRAMES_AWAITING_APPROVAL: "Approve frames", VIDEO_AWAITING_AUTHORIZATION: "Authorize videos", VIDEO_GENERATING: "Making videos", VIDEO_REVIEW: "Review videos", ASSEMBLING: "Assembling movie", FINAL_REVIEW: "Review movie", COMPLETED: "Done", FAILED: "Failed", CANCELLED: "Cancelled" };
    const STEPS = [["Story", ["STORYBOARD_GENERATING", "STORYBOARD_AWAITING_APPROVAL"]], ["Characters", ["CHARACTERS_CHECKING", "CHARACTERS_GENERATING", "CHARACTERS_AWAITING_APPROVAL"]], ["Frames", ["FIRST_TWO_FRAMES_GENERATING", "FIRST_TWO_FRAMES_AWAITING_APPROVAL", "REMAINING_FRAMES_GENERATING", "FRAMES_AWAITING_APPROVAL"]], ["Videos", ["VIDEO_AWAITING_AUTHORIZATION", "VIDEO_GENERATING", "VIDEO_REVIEW"]], ["Movie", ["ASSEMBLING", "FINAL_REVIEW", "COMPLETED"]]];
    const urlCache = new Map();
    const url = id => { if (!urlCache.has(id)) urlCache.set(id, B.blobUrl(id).catch(() => "")); return urlCache.get(id); };
    function lightbox(item) {
      const wrap = h("div", { class: "dir-lb", role: "dialog", "aria-label": "Preview", onclick: e => { if (e.target === wrap) wrap.remove(); } });
      url(item.asset).then(u => { if (!u) { wrap.append(h("div", { class: "ds-empty" }, "This file is not on this device any more.")); return; } const el = item.kind === "video" ? h("video", { src: u, controls: true, autoplay: true, playsinline: true }) : h("img", { src: u, alt: item.caption || "" }); wrap.append(el, h("button", { class: "ds-btn", onclick: () => wrap.remove() }, "Close")); });
      document.body.append(wrap);
    }
    function media(m) {   // one real picture or video from the project
      const box = h("figure", { class: "dir-media" + (m.full ? " full" : "") });
      const fail = () => box.replaceChildren(h("div", { class: "dir-miss" }, icon("warn"), "Preview unavailable. ", h("a", { href: "#/library/" + (m.kind === "video" ? "videos" : "images"), onclick: () => {} }, "Open it in the Library")), m.caption ? h("figcaption", {}, m.caption) : null);
      url(m.asset).then(u => {
        if (!u) return fail();
        if (m.kind === "video") { const v = h("video", { src: u, controls: true, playsinline: true, preload: "metadata", "aria-label": m.caption || "video" }); v.onerror = fail; box.prepend(v); }
        else { const i = h("img", { src: u, alt: m.caption || "", decoding: "async", loading: "lazy", title: "Tap to enlarge", onclick: () => lightbox(m) }); i.onerror = fail; box.prepend(i); }
      });
      box.append(m.caption ? h("figcaption", {}, m.caption, (m.flags || []).length ? h("span", { class: "ds-pill warn" }, "⚠ " + m.flags[0]) : null, m.download ? h("a", { class: "ds-pill", download: "movie.mp4", href: "#", onclick: async e => { e.preventDefault(); const u = await url(m.asset); const a = h("a", { href: u, download: "ai-studio-movie.mp4" }); document.body.append(a); a.click(); a.remove(); } }, "Download MP4") : null) : null);
      return box;
    }
    function bubble(pid, s, m) {
      const mine = m.role === "user", el = h("div", { class: "dir-msg " + (mine ? "me" : "ai") + (m.type ? " t-" + m.type : "") });
      if (m.type === "progress") {
        el.append(h("div", { class: "dir-title" }, m.done ? "✓ " : "", m.title), h("div", { class: "dir-prog" }, (m.items || []).map(it => { const c = h("div", { class: "pi " + it.state, title: "Scene " + it.n }, h("span", { class: "n" }, it.n)); if (it.asset) url(it.asset).then(u => { if (u) c.prepend(h("img", { src: u, alt: "", loading: "lazy" })); }); return c; })));
        return el;
      }
      if (m.text) el.append(h("div", { class: "dir-text" }, m.text));
      if (m.facts) el.append(h("dl", { class: "dir-facts" }, m.facts.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])));
      if (m.scenes && m.type === "story") el.append(h("details", { class: "dir-more" }, h("summary", {}, `Scene list (${m.scenes.length})`), h("ol", {}, m.scenes.map(x => h("li", {}, h("b", {}, x.title), " — " + x.text)))));
      if (m.media && m.media.length) el.append(h("div", { class: "dir-grid" + (m.media.length === 1 ? " one" : "") }, m.media.map(media)));
      if (m.type === "final") {
        if (m.sheet) el.append(h("div", { class: "dir-sub" }, "Storyboard"), h("div", { class: "dir-grid one" }, media({ asset: m.sheet, kind: "image", caption: "Storyboard", full: true })));
        if ((m.scenes || []).length) el.append(h("details", { class: "dir-more" }, h("summary", {}, "Individual scene clips"), h("div", { class: "dir-grid" }, m.scenes.filter(x => x.asset).map(x => media({ asset: x.asset, kind: "video", caption: `Scene ${x.n} · ${x.title}` })))), h("div", { class: "dir-sub" }, h("a", { href: "#/library/videos" }, "All files in the Library")));
      }
      if (m.buttons && m.buttons.length) el.append(h("div", { class: "dir-btns" }, m.buttons.map((b, i) => h("button", { type: "button", class: "ds-btn sm " + (b.style || ""), disabled: !!b.used, onclick: () => click(pid, m, b, i) }, b.used ? "✓ " + b.label : b.label))));
      return el;
    }
    let input = null;
    async function click(pid, m, b, i) { if (b.act === "prefill") { const ta = document.querySelector(".dir-chat .dir-in textarea"); if (ta) { ta.value = (b.ref || {}).text || ""; ta.focus(); } return; } await APP.once("dir:" + pid + ":" + m.id + ":" + i, () => DIR.act(pid, b.act, b.ref, m.id, i)); }

    function createChat(pid) {
      const root = h("section", { class: "dir-chat", "aria-label": "AI Director chat" }), list = h("div", { class: "dir-list", role: "log", "aria-live": "polite" }), bar = h("div", { class: "dir-bar" }), steps = h("div", { class: "dir-steps" });
      const ta = h("textarea", { rows: 1, placeholder: "Describe your movie, or tell me what to change…", "aria-label": "Message to AI Director", enterkeyhint: "send" }), file = h("input", { type: "file", accept: "image/*", hidden: true });
      let busy = false;
      const send = async () => {
        const t = ta.value.trim(); if (!t || busy) return; busy = true; ta.value = ""; ta.style.height = ""; sendBtn.disabled = true;
        try { await DIR.handleUser(pid, t, []); } finally { busy = false; sendBtn.disabled = false; }
      };
      const sendBtn = h("button", { class: "ds-btn pri", type: "button", onclick: send }, "Send");
      ta.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } }; ta.oninput = () => { ta.style.height = "auto"; ta.style.height = Math.min(140, ta.scrollHeight) + "px"; };
      file.onchange = async () => {
        const f = file.files[0]; if (!f) return; try {
          const data = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); }), a = await api("assets", { filename: f.name, data, type: "image", tags: ["director-upload"] });
          await DIR.userSay(pid, "Uploaded " + f.name, [{ asset: a.id, kind: "image", caption: f.name }]); await DIR.say(pid, { type: "text", text: "Saved to the project's assets. To use it as a character reference, open the Library → Characters and add it there; I will use the saved references." }); APP.changed("all");
        } catch (e) { APP.fail(e, "Upload"); } file.value = "";
      };
      const attach = h("button", { class: "ds-btn icon ghost", type: "button", "aria-label": "Attach an image", onclick: () => file.click() }, icon("up"));
      const gear = h("button", { class: "ds-btn icon sm ghost", type: "button", "aria-label": "AI Director settings", onclick: () => settingsSheet(pid) }, icon("dots"));
      root.append(bar, steps, list, h("div", { class: "dir-in" }, attach, ta, sendBtn, file));
      let shown = 0, lastKey = "", pinUntil = 0;   // pictures load after the first render: keep the newest message in view for a few seconds
      for (const ev of ["load", "loadedmetadata"]) list.addEventListener(ev, () => { if (Date.now() < pinUntil) list.scrollTop = list.scrollHeight; }, true);
      list.addEventListener("wheel", () => { pinUntil = 0; }, { passive: true }); list.addEventListener("touchstart", () => { pinUntil = 0; }, { passive: true });
      async function render(kind) {
        const s = await DIR.get(pid), near = list.scrollHeight - list.scrollTop - list.clientHeight < 140, running = DIR.running.has(pid);
        await DIR.settle(pid).catch(() => {});
        const idx = STEPS.findIndex(x => x[1].includes(s.state));
        steps.replaceChildren(...STEPS.map(([n], i) => h("span", { class: "st" + (s.state === "COMPLETED" || i < idx ? " done" : i === idx ? " cur" : "") }, h("i"), n)));
        bar.replaceChildren(h("span", { class: "ds-pill " + (s.halted ? "bad" : s.paused ? "warn" : DIR.WAITING.has(s.state) ? "warn" : running ? "run" : "") }, s.halted ? "Stopped" : s.paused ? "Paused" : (running ? "● " : "") + (LABEL[s.state] || s.state)), h("span", { class: "ds-small ds-grow" }, `Spent ${APP.money(s.spend.total)} / ${APP.money(s.cfg.budget.project)}`), s.paused ? h("button", { class: "ds-btn sm", onclick: () => DIR.runTool(pid, "resume_production", {}) }, "Resume") : (running || !DIR.IDLE.has(s.state) && !DIR.WAITING.has(s.state)) ? h("button", { class: "ds-btn sm", onclick: () => DIR.runTool(pid, "pause_production", {}) }, "Pause") : null, gear);
        const key = s.msgs.length + ":" + s.msgs.map(m => (m.items ? m.items.map(i => i.state + i.asset).join("") : "") + (m.title || "") + (m.buttons ? m.buttons.map(b => b.used ? 1 : 0).join("") : "")).join("|").length;
        if (key !== lastKey || shown !== s.msgs.length) {
          lastKey = key; shown = s.msgs.length;
          list.replaceChildren(...(s.msgs.length ? s.msgs.map(m => bubble(pid, s, m)) : [welcome(pid)]));
          if (near || kind === "first") { list.scrollTop = list.scrollHeight; if (kind === "first") pinUntil = Date.now() + 5000; }
        }
      }
      const welcome = pid => h("div", { class: "dir-welcome" }, h("h3", {}, "AI Director"), h("p", { class: "ds-sub" }, "Tell me the movie you want. I write the story, draw a storyboard for your approval, reuse your saved characters, make start frames, and — only after you authorize the cost — the videos and the final movie."),
        h("div", { class: "dir-chips" }, ["Create a 16-scene 9:16 cinematic movie about Hessa joining the K-Pop Demon Hunters. Use the existing Hessa, Rumi, Mira, and Zoey character references.", "Create an 8-scene 9:16 movie about a small robot learning to dance.", "How much have I spent?"].map(t => h("button", { type: "button", class: "ds-chip", onclick: () => { ta.value = t; ta.focus(); } }, t.length > 70 ? t.slice(0, 68) + "…" : t))));
      const on = (p, kind) => { if (p === pid) render(kind).catch(e => console.warn("director ui", e)); };
      DIR.ui.add(on); root.destroy = () => DIR.ui.delete(on);
      render("first"); DIR.resume(pid).catch(() => {});
      const vis = () => { if (document.visibilityState === "visible") DIR.resume(pid).catch(() => {}); }; document.addEventListener("visibilitychange", vis); window.addEventListener("online", vis);
      return root;
    }
    function settingsSheet(pid) {
      DIR.get(pid).then(s => APP.sheet((box, close) => {
        const num = (v, step = 1) => h("input", { class: "ds-input", type: "number", step, value: v, style: "width:100px" }), mc = num(s.cfg.maxConcurrent), rt = num(s.cfg.maxRetries), pb = num(s.cfg.budget.project, .5), sb = num(s.cfg.budget.storyboard, .5), cb = num(s.cfg.budget.characters, .5), fb = num(s.cfg.budget.frames, .5);
        const key = h("input", { class: "ds-input", type: "password", placeholder: "sk-ant-… (optional)", value: DIR.llm.key(), autocomplete: "off" }), model = h("input", { class: "ds-input", value: DIR.llm.model() });
        const row = (l, el, hint) => h("div", { class: "ds-field" }, h("label", {}, l), el, hint ? h("div", { class: "ds-small" }, hint) : null);
        box.append(h("h2", { class: "ds-h2", style: "font-size:17px" }, "AI Director settings"),
          row("Project budget ($)", pb, "Hard ceiling for everything in this project."), row("Storyboard limit ($)", sb), row("Characters limit ($)", cb), row("Start frames limit ($)", fb, "Videos have no preset limit: you set it when you authorize them."), row("Jobs at the same time", mc, "Independent frames/videos run in parallel on RunPod workers."), row("Retries per scene", rt),
          h("hr", { style: "border:0;border-top:1px solid var(--line);margin:12px 0" }), h("div", { class: "ds-small" }, "Optional AI key for free conversation and written stories. Stored only on this device, sent only to Anthropic. Without it I use a built-in template and fixed commands."), row("Anthropic API key", key), row("Model", model, "A small, cheap model is plenty for planning (default claude-haiku-5-5)."),
          h("div", { class: "ds-row" }, h("button", { class: "ds-btn ghost", style: "flex:1", onclick: close }, "Cancel"), h("button", { class: "ds-btn pri", style: "flex:1", onclick: async () => {
            await DIR.runTool(pid, "set_settings", { max_concurrent_jobs: +mc.value, max_retries: +rt.value, project_budget: +pb.value, storyboard_budget: +sb.value, characters_budget: +cb.value, frames_budget: +fb.value }, "ui"); try { APP.LS.set("dir_llm_key", key.value.trim()); APP.LS.set("dir_llm_model", model.value.trim()); } catch {} APP.toast("Saved", "ok"); close(); } }, "Save")));
      }));
    }
    DIR.createChat = createChat;
    document.dispatchEvent(new Event("dir-ui-ready"));
  }
})();
