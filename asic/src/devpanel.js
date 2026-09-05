/* A panel for tuning a beat's camera by hand. Off unless the page is opened
   with ?dev, or the backtick key is pressed.

   It edits the beat objects in place, so the engine picks the change up on
   the next frame. "Hold" pins the pane to the beat being tuned so it stops
   following the scroll. "Copy" puts the tuned fields on the clipboard as the
   fragment to paste back into acts/actN.js; nothing is saved otherwise. */

import { AZ } from "./engine.js";

const FIELDS = [
  ["az",    -Math.PI, Math.PI, 0.01, v => v - AZ, v => v + AZ, "az − AZ"],
  ["elev",  0, Math.PI / 2, 0.005, v => v, v => v, "elev"],
  ["fov",   5, 60, 0.5, v => v, v => v, "fov"],
  ["ortho", 0, 1, 0.01, v => v, v => v, "ortho"],
  ["gap",   0, 8, 0.05, v => v, v => v, "gap"],
  ["drift", 0, 1.5, 0.01, v => v, v => v, "drift"],
];
const DEFAULTS = { gap: 0, drift: 0, az: AZ, elev: 0.5, fov: 30, ortho: 0, col: 1 };

export class DevPanel {
  constructor(engine, host) {
    this.engine = engine;
    this.beat = 0;
    this.el = document.createElement("div");
    this.el.className = "dev";
    host.appendChild(this.el);
    this.build();
    this.el.hidden = true;
    addEventListener("keydown", e => {
      if (e.key === "`" && !e.metaKey && !e.ctrlKey) this.toggle();
    });
    this.tick = () => { if (!this.el.hidden) this.readout(); requestAnimationFrame(this.tick); };
    requestAnimationFrame(this.tick);
  }

  toggle(on = this.el.hidden) {
    this.el.hidden = !on;
    if (on) this.select(Math.round(this.engine.position()));
    else this.hold(false);
  }

  build() {
    const b = this.engine.beats;
    this.el.innerHTML = `
      <div class="dev-row">
        <button data-act="prev">‹</button>
        <select data-act="pick">${b.map((x, i) => `<option value="${i}">${i} · ${x.id}</option>`).join("")}</select>
        <button data-act="next">›</button>
        <label><input type="checkbox" data-act="hold"> hold</label>
        <label><input type="checkbox" data-act="edit"> edit prose</label>
      </div>
      <div class="dev-beat" data-beat></div>
      <div class="dev-live" data-live></div>
      ${FIELDS.map(([k, lo, hi, st, , , label]) => `
        <div class="dev-row">
          <span class="dev-k">${label}</span>
          <input type="range" data-f="${k}" min="${lo}" max="${hi}" step="${st}">
          <output data-o="${k}"></output>
        </div>`).join("")}
      <div class="dev-row"><span class="dev-k">focus x</span>
        <input type="range" data-f="fx" min="0" max="1" step="0.005"><output data-o="fx"></output></div>
      <div class="dev-row"><span class="dev-k">focus y</span>
        <input type="range" data-f="fy" min="0" max="1" step="0.005"><output data-o="fy"></output></div>
      <div class="dev-row"><span class="dev-k">focus size</span>
        <input type="range" data-f="fs" min="0.02" max="1" step="0.005"><output data-o="fs"></output></div>
      <div class="dev-row">
        <button data-act="save">save</button>
        <button data-act="copy">copy</button>
        <button data-act="reset">reset</button>
        <span class="dev-note" data-note></span>
      </div>`;
    this.el.addEventListener("click", e => {
      const a = e.target.dataset.act;
      if (a === "prev") this.select(this.beat - 1);
      if (a === "next") this.select(this.beat + 1);
      if (a === "copy") this.copy();
      if (a === "save") this.save();
      if (a === "reset") this.reset();
    });
    this.el.querySelector("[data-act=pick]").onchange = e => this.select(+e.target.value);
    this.el.querySelector("[data-act=hold]").onchange = e => this.hold(e.target.checked);
    this.el.querySelector("[data-act=edit]").onchange = e => this.onEdit?.(e.target.checked);
    for (const r of this.el.querySelectorAll("input[type=range]")) {
      r.oninput = () => this.set(r.dataset.f, +r.value);
    }
  }

  get current() { return this.engine.beats[this.beat]; }

  select(i) {
    this.beat = Math.max(0, Math.min(this.engine.beats.length - 1, i));
    this.original ??= new Map();
    if (!this.original.has(this.beat)) this.original.set(this.beat, JSON.stringify(this.current));
    this.el.querySelector("[data-act=pick]").value = this.beat;
    if (this.engine.lock !== null) this.engine.lock = this.beat;
    this.refresh();
  }

  hold(on) {
    this.engine.lock = on ? this.beat : null;
    this.el.querySelector("[data-act=hold]").checked = on;
  }

  refresh() {
    const b = this.current;
    for (const [k, , , , show] of FIELDS) {
      const v = b[k] ?? DEFAULTS[k];
      this.el.querySelector(`[data-f=${k}]`).value = v;
      this.el.querySelector(`[data-o=${k}]`).textContent = show(v).toFixed(3);
    }
    const f = b.focus ?? [0.5, 0.5, 1];
    for (const [k, i] of [["fx", 0], ["fy", 1], ["fs", 2]]) {
      this.el.querySelector(`[data-f=${k}]`).value = f[i];
      this.el.querySelector(`[data-o=${k}]`).textContent = f[i].toFixed(3);
    }
  }

  set(k, v) {
    const b = this.current;
    if (k === "fx" || k === "fy" || k === "fs") {
      b.focus = b.focus ? [...b.focus] : [0.5, 0.5, 1];
      b.focus[{ fx: 0, fy: 1, fs: 2 }[k]] = v;
    } else b[k] = v;
    this.refresh();
  }

  /** The fields the panel owns, as the object to save. */
  fields() {
    const b = this.current, out = {};
    for (const [k] of FIELDS) if (b[k] !== undefined) out[k] = b[k];
    if (b.focus) out.focus = b.focus;
    return out;
  }

  async api() {
    if (this._api !== undefined) return this._api;
    for (const base of ["", "http://localhost:8733"]) {
      try {
        const r = await fetch(base + "/api/comments", { cache: "no-store" });
        if (r.ok && (r.headers.get("content-type") || "").includes("json")) return (this._api = base);
      } catch (e) {}
    }
    return (this._api = null);
  }

  /** Write the beat's tuned fields to overrides.json, through serve.py. */
  async save(fields = this.fields()) {
    const note = this.el.querySelector("[data-note]");
    const api = await this.api();
    if (api === null) { note.textContent = "not saved: run  python3 tools/serve.py 8733"; return; }
    const r = await fetch(api + "/api/overrides", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: this.current.id, fields }) });
    note.textContent = r.ok ? (fields ? "saved to overrides.json " : "override removed ") + new Date().toLocaleTimeString()
                            : "save failed";
  }

  /** Back to the authored values, and the saved override removed with them. */
  reset() {
    // the authored values from acts/, not the beat as it was when the panel
    // first saw it, which may already carry a saved override
    const s = this.authored?.[this.current.id] ?? this.original?.get(this.beat);
    if (!s) return;
    const o = JSON.parse(s), b = this.current;
    for (const k of Object.keys(b)) delete b[k];
    Object.assign(b, o);
    this.refresh();
    this.save(null);
  }

  copy() {
    const b = this.current, out = {};
    for (const [k, , , , show] of FIELDS) {
      if (b[k] === undefined) continue;
      out[k] = +show(b[k]).toFixed(3);
    }
    if (b.focus) out.focus = b.focus.map(v => +v.toFixed(3));
    const text = Object.entries(out)
      .map(([k, v]) => k === "az" ? `az: AZ + ${v}` : `${k}: ${JSON.stringify(v)}`)
      .join(", ");
    navigator.clipboard?.writeText(text);
    this.el.querySelector("[data-note]").textContent = text;
  }

  readout() {
    const pos = this.engine.position();
    const i = Math.floor(pos), f = pos - i;
    const A = this.engine.beats[i], B = this.engine.beats[Math.min(i + 1, this.engine.beats.length - 1)];
    // the beat's key, large and first, and the picker kept on it while the
    // reader scrolls, so the panel always says which beat the pane is on
    const held = this.engine.lock !== null;
    this.el.querySelector("[data-beat]").textContent =
      held ? `${A?.id}  (held)` : f < 0.02 ? A?.id : `${A?.id} → ${B?.id}`;
    const pick = this.el.querySelector("[data-act=pick]");
    if (!held && pick && document.activeElement !== pick && +pick.value !== i) pick.value = i;
    this.el.querySelector("[data-live]").textContent =
      `scroll ${pos.toFixed(2)}  ·  ${A?.id} → ${B?.id}  ·  f ${f.toFixed(2)}` +
      (held ? `  ·  held on ${this.engine.beats[this.engine.lock].id}` : "");
  }
}
