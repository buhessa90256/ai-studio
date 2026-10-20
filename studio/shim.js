// Makes the Studio Pro screens (written for the PC app's server) work in this static page: requests to /api/... are answered here,
// by the browser-side backend, instead of going over the network. Everything else (RunPod, voices, files) is passed through untouched.
"use strict";
(() => {
  const real = window.fetch.bind(window);
  const B = () => window.StudioBackend, J = () => window.StudioJobs;
  const reply = (data, status = 200) => new Response(JSON.stringify(data ?? null), { status, headers: { "Content-Type": "application/json" } });

  async function handle(method, path, q, body) {
    const parts = path.replace(/^\/api\//, "").split("/").filter(Boolean);
    const [a, b, ...rest] = parts;
    if (a === "studio") {
      if (b === "export") return window.StudioExport ? (method === "GET" ? window.StudioExport.status(rest[0]) : window.StudioExport.start(body.project, body.resolution === "hd")) : (() => { throw B().bad("Export is not available yet."); })();
      return B().route(method, [b, ...rest], q, body);
    }
    switch (a) {
      case "generate": return J().generate(body.tool, body.params || {});
      case "status": return J().poll(b);
      case "cancel": return J().cancel(b);
      case "health": return J().health();
      case "balance": { const m = typeof money !== "undefined" ? money : null; return m ? { balance: m.balance, per_hour: m.per_hour, limit: m.limit } : {}; }
      case "gpu": return { mode: store.get("warm") ? "on" : "auto", until: null, backup_timer: false };
      case "jobs": return J().jobsList();
      case "running": case "history": return { jobs: [], items: [] };
      case "queue": return b === "retry" ? J().retry(body.id) : J().queue();
      case "phone": throw Object.assign(new Error("only available on the PC itself"), { status: 403 });
      default: return undefined;
    }
  }

  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url;
    let u; try { u = new URL(url, location.href); } catch { return real(input, init); }
    if (u.origin === location.origin && u.pathname.startsWith("/voices/")) return real("voices/" + u.pathname.slice(8), init);  // the page lives under /ai-studio/
    if (!(u.origin === location.origin && u.pathname.startsWith("/api/"))) return real(input, init);
    const method = (init.method || (typeof input !== "string" && input.method) || "GET").toUpperCase();
    let body = {}; try { if (init.body) body = JSON.parse(init.body); } catch {}
    try {
      const data = await handle(method, u.pathname, Object.fromEntries(u.searchParams), body);
      return data === undefined ? reply({ error: "not found" }, 404) : reply(data);
    } catch (e) { return reply({ error: e.message || String(e) }, e.status || (e instanceof InputError ? 400 : 500)); }
  };
})();
