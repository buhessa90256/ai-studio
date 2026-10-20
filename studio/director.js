// Studio Pro Director tab: cinematic presets for a project's default look. Scenes can override them in the Storyboard.
(() => {
  const { api, h, err, loaders } = window.SP;
  const nav = document.getElementById("tabs"), main = (document.getElementById("studio-main") || document.querySelector("main"));
  const btn = h("button", { "data-tab": "director" }, "Director");
  btn.onclick = () => window.showTab("director");
  nav.insertBefore(btn, nav.querySelector('[data-tab="history"]'));
  main.insertBefore(h("section", { class: "tab wide", id: "tab-director" }), document.getElementById("tab-history"));
  try { if (localStorage.getItem("tab") === "director") setTimeout(() => window.showTab("director"), 0); } catch {}

  const st = { projectId: localStorage.getItem("sb_project") || "" };
  loaders.director = async function () {
    const root = document.getElementById("tab-director");
    const [presets, projects] = [await api("director"), (await api("projects")).items];
    const project = projects.find(p => p.id === st.projectId);
    const sel = h("select", { style: "max-width:260px" }, [h("option", { value: "" }, "Choose a project…"), ...projects.map(p => h("option", { value: p.id, selected: p.id === st.projectId }, p.name))]);
    sel.onchange = () => { st.projectId = sel.value; try { localStorage.setItem("sb_project", st.projectId); } catch {} loaders.director(); };
    root.replaceChildren(h("div", { class: "sp-bar" }, h("h2", {}, "Director"), sel),
      h("p", { class: "sb-warn" }, "These presets are written into the prompt. They steer the video model but are not guaranteed camera controls: results vary. Set a default look for the whole project here; each scene can override it in the Storyboard."));
    if (!project) { root.append(h("p", { class: "sp-empty" }, "Choose a project to set its default look.")); return; }
    const look = { ...(project.data.director || {}) };
    const preview = h("p", { class: "hint" });
    const saved = h("span", { class: "sp-saved" });
    let timer;
    const persist = () => { clearTimeout(timer); timer = setTimeout(async () => { try { await api("projects", { ...project, data: { ...project.data, director: look } }); saved.textContent = "Saved ✓"; } catch (e) { saved.textContent = e.message; } }, 500); };
    const show = () => { preview.textContent = "Wording added to every scene: " + (Object.entries(look).map(([g, id]) => presets[g]?.items.find(i => i.id === id)?.text).filter(Boolean).join(", ") || "(nothing selected)"); };
    root.append(h("div", { class: "sp-bar" }, h("b", {}, project.name), saved));
    for (const [g, def] of Object.entries(presets)) {
      const chips = h("div", { class: "chips" }, [h("button", { type: "button", class: look[g] ? "" : "on" }, "None"), ...def.items.map(it => h("button", { type: "button", class: look[g] === it.id ? "on" : "", title: it.text }, it.label))]);
      const btns = [...chips.children];
      btns.forEach((b, i) => b.onclick = () => { btns.forEach(x => x.classList.remove("on")); b.classList.add("on"); if (i === 0) delete look[g]; else look[g] = def.items[i - 1].id; show(); persist(); });
      root.append(h("div", { class: "card", style: "margin-bottom:10px;padding:14px" }, h("b", { style: "font-size:14px" }, def.label), h("div", { style: "margin-top:8px" }, chips)));
    }
    root.append(preview); show();
  };
})();
