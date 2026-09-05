/* Edit mode: every section of the prose gets its Markdown source in a box,
   saved back into script.md, and a second box for comments on what the pane
   should show, saved to comments.json. Both go through the API in
   tools/serve.py; under a plain static server the boxes say so and stay
   read-only.

   On ?edit, or from the dev panel. */

const WRITER = "http://localhost:8733";     // where tools/serve.py is run for writing

export class Editor {
  constructor() {
    this.on = false;
    this.api = null;
    this.sections = [...document.querySelectorAll(".prose [id]")].filter(el => /^(section|header)$/i.test(el.tagName));
  }

  /** The API may be on this origin (serve.py is serving the page) or on the
      writing port (the page came from a plain static server). Try both. */
  async findApi() {
    for (const base of ["", WRITER]) {
      try {
        const r = await fetch(base + "/api/comments", { cache: "no-store" });
        if (r.ok && (r.headers.get("content-type") || "").includes("json")) return base;
      } catch (e) {}
    }
    return null;
  }

  async toggle(on = !this.on) {
    this.on = on;
    document.documentElement.classList.toggle("editing", on);
    if (!on) { for (const el of this.sections) el.querySelector(".edit")?.remove(); return; }
    this.api = await this.findApi();
    let script = null, comments = {};
    if (this.api !== null) {
      try {
        script = await (await fetch(this.api + "/api/script", { cache: "no-store" })).text();
        comments = await (await fetch(this.api + "/api/comments", { cache: "no-store" })).json();
      } catch (e) { script = null; }
    }
    for (const el of this.sections) this.attach(el, script, comments[el.id]?.show || "");
  }

  /** A section's heading text, without the level marks or the {#id}. Editing
      it is safe: the id is what everything else points at, and the server
      keeps it. */
  static title(script, id) {
    if (!script) return null;
    const m = [...script.matchAll(/^(#{1,2}) (.*?)\s*\{#([\w-]+)\}\s*$/gm)].find(x => x[3] === id);
    return m ? m[2] : null;
  }

  /** The Markdown body of one section, sliced out of the script by its id. */
  static body(script, id) {
    const heads = [...script.matchAll(/^#{1,2} .*?\{#([\w-]+)\}\s*$/gm)];
    const k = heads.findIndex(m => m[1] === id);
    if (k < 0) return null;
    const start = heads[k].index + heads[k][0].length + 1;
    const end = k + 1 < heads.length ? heads[k + 1].index : script.length;
    return script.slice(start, end).replace(/\n+$/, "");
  }

  attach(el, script, comments) {
    el.querySelector(".edit")?.remove();
    const box = document.createElement("div");
    box.className = "edit";
    let body = script ? Editor.body(script, el.id) : null;   // what the box holds; updated on each save
    const canWrite = script !== null;
    box.innerHTML = `
      <div class="edit-row"><span class="edit-k">title · ${el.id}</span></div>
      <input class="edit-title" spellcheck="false" ${canWrite ? "" : "readonly"}
             value="${(Editor.title(script, el.id) ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">
      <div class="edit-row"><span class="edit-k">say · ${el.id}</span>
        <button data-act="save" ${canWrite ? "" : "disabled"}>save</button>
        <span class="edit-note" data-note>${canWrite ? "" : "read-only: run  python3 tools/serve.py 8733  to save"}</span></div>
      <textarea class="edit-say" spellcheck="false" ${canWrite ? "" : "readonly"}>${(body ?? "(section not found in script.md)").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</textarea>
      <div class="edit-row"><span class="edit-k">show · comment</span>
        <button data-act="note" ${canWrite ? "" : "disabled"}>save comment</button>
        <span class="edit-note" data-cnote></span></div>
      <textarea class="edit-show" spellcheck="false" placeholder="a note on what the pane should do here; saved as a new entry, never overwritten" ${canWrite ? "" : "readonly"}></textarea>
      ${comments.length ? `<div class="edit-log">${comments.slice(-3).reverse().map(x =>
        `<div><span class="edit-t">${x.time.replace("T", " ").slice(0, 16)}${x.by ? " · " + x.by : ""}</span> ` +
        x.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")
              .replace(/\n&gt; ?(.*)/g, '<div class="edit-done">$1</div>') + `</div>`).join("")}</div>` : ""}`;
    el.appendChild(box);
    const say = box.querySelector(".edit-say"), show = box.querySelector(".edit-show"), note = box.querySelector("[data-note]");
    const title = box.querySelector(".edit-title");
    const grow = t => { t.style.height = "auto"; t.style.height = t.scrollHeight + 4 + "px"; };
    for (const t of [say, show]) { grow(t); t.addEventListener("input", () => grow(t)); }

    box.querySelector("[data-act=save]").onclick = async () => {
      // The box holds the section as it was when edit mode opened. If the
      // file has moved on since (another session, another tab), saving would
      // put the old text back over the new: refuse, and say why.
      note.textContent = "checking…";
      try {
        const now = await (await fetch(this.api + "/api/script", { cache: "no-store" })).text();
        if (Editor.body(now, el.id) !== body) {
          note.textContent = "this section changed on disk since you opened it; reload the page, then edit";
          return;
        }
      } catch (e) {}
      note.textContent = "saving…";
      const r = await fetch(this.api + "/api/section", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: el.id, body: say.value, title: title.value }) });
      if (!r.ok) { note.textContent = "save failed"; return; }
      // re-render this section from the writing server, so the page shows the
      // saved text without a reload, through the same renderer as the build
      const html = await (await fetch(this.api + "/", { cache: "no-store" })).text();
      const fresh = new DOMParser().parseFromString(html, "text/html").getElementById(el.id);
      if (fresh) {
        for (const c of [...el.children]) if (!c.classList.contains("edit")) c.remove();
        for (const c of [...fresh.children]) el.insertBefore(c, box);
      }
      body = say.value;                 // the box now holds what is on disk
      note.textContent = "saved " + new Date().toLocaleTimeString();
    };
    const cnote = box.querySelector("[data-cnote]");
    box.querySelector("[data-act=note]").onclick = async () => {
      if (!show.value.trim()) { cnote.textContent = "nothing to save"; return; }
      const r = await fetch(this.api + "api/comments", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: el.id, text: show.value }) });
      if (!r.ok) { cnote.textContent = "not saved"; return; }
      const log = box.querySelector(".edit-log") || box.appendChild(Object.assign(document.createElement("div"), { className: "edit-log" }));
      log.insertAdjacentHTML("afterbegin", `<div><span class="edit-t">just now</span> ${show.value.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`);
      show.value = ""; grow(show);
      cnote.textContent = "saved";
    };
  }
}
