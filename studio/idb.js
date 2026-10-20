// Studio Pro storage in the browser: one IndexedDB database on THIS device. Nothing here is ever sent anywhere or kept in the repository.
"use strict";
(() => {
  const STORES = ["projects", "characters", "assets", "blobs", "scenes", "workflows", "jobs", "joblog", "outputs", "kv"];
  let dbp;
  const open = () => dbp ??= new Promise((res, rej) => {
    const o = indexedDB.open("studio-pro", 1);
    o.onupgradeneeded = () => { for (const s of STORES) if (!o.result.objectStoreNames.contains(s)) o.result.createObjectStore(s, { keyPath: s === "outputs" ? "name" : s === "kv" ? "key" : "id" }); };
    o.onsuccess = () => res(o.result); o.onerror = () => rej(o.error);
  });
  const tx = async (store, mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode); let out;
      try { out = fn(t.objectStore(store)); } catch (e) { rej(e); return; }
      t.oncomplete = () => res(out && "result" in out ? out.result : out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  };
  window.SDB = {
    get: (s, k) => tx(s, "readonly", st => st.get(k)),
    all: s => tx(s, "readonly", st => st.getAll()),
    put: (s, v) => tx(s, "readwrite", st => st.put(v)),
    del: (s, k) => tx(s, "readwrite", st => st.delete(k)),
    clear: s => tx(s, "readwrite", st => st.clear()),
    uid: () => crypto.getRandomValues(new Uint8Array(6)).reduce((a, b) => a + b.toString(16).padStart(2, "0"), ""),
  };
})();
