// Storyboard sheet extractor: opens the connector's gallery page (upload a storyboard picture, adjust the crop boxes, approve scenes, export a ZIP, import into a movie). Free: CPU work, never starts a GPU job.
(() => {
  const LS = k => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
  function url() {
    const m = LS("connector_url").match(/^(https?:\/\/[^\s/]+)\/ro\/([A-Za-z0-9]+)$/);
    if (!m) return "";
    const a = (LS("connector_act").match(/\/act\/([A-Za-z0-9]+)$/) || [])[1];
    return `${m[1]}/sheets/${m[2]}` + (a ? `?act=${a}` : "");
  }
  window.sheetExtractorUrl = url;
  // Smart Character Creator: Create Character -> Upload Master Sheet -> Auto-Split & Classify (the connector's review page; CPU only, no GPU)
  window.characterCreatorUrl = () => url().replace("/sheets/", "/chars/");
  // Master Character Library: Characters -> select a character -> Master Character (views, identity, history; approve/reject on this page; no generation)
  window.masterCharactersUrl = () => url().replace("/sheets/", "/master/");
  window.openMasterCharacters = () => {
    const u = window.masterCharactersUrl();
    if (!u) { alert("Connect to your chat first: in ChatGPT or Claude say “open in studio app”, then open that link on this device."); return; }
    window.open(u, "_blank", "noopener");
  };
  window.openCharacterCreator = () => {
    const u = window.characterCreatorUrl();
    if (!u) { alert("Connect to your chat first: in ChatGPT or Claude say “open in studio app”, then open that link on this device."); return; }
    window.open(u, "_blank", "noopener");
  };
  window.openSheetExtractor = () => {
    const u = url();
    if (!u) { alert("Connect to your chat first: in ChatGPT or Claude say “open in studio app”, then open that link on this device."); return; }
    window.open(u, "_blank", "noopener");
  };
})();
