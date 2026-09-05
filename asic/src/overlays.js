/* Everything drawn over the chip pane in HTML instead of WebGL: projected
   labels, arrows from a word in the prose to a pad on the chip, the panels
   that stand in for figures, and the monospace sidebar. */

import { theme } from "./theme.js";
import { isFlop } from "./regionmap.js";

const v = new THREE.Vector3();

/** World point -> pixels within the canvas's box. */
function project(p, camera, rect) {
  v.copy(p).project(camera);
  return [(v.x * 0.5 + 0.5) * rect.width, (-v.y * 0.5 + 0.5) * rect.height, v.z < 1];
}

// ---------------------------------------------------------------- tags

export class Tags {
  constructor(host) { this.host = host; this.items = []; }

  /**
   * @param set   the label set: num, name, ports, pins
   * @param subj  subject key the label attaches to
   * @param layer stack index the label attaches to
   * @param edge  true to pin it to the left edge of the stack instead of (x, y)
   */
  add({ set, subj, layer, text, x = 0, y = 0, edge = false, cls = "", rank = 0, colour = "" }) {
    const el = document.createElement("div");
    el.className = "tag " + cls;
    el.textContent = text;
    this.host.appendChild(el);
    this.items.push({ set, subj, layer, x, y, edge, el, rank, colour });
    this.items.sort((a, b) => b.rank - a.rank);   // high rank claims its spot first
  }

  /**
   * Labels are placed in order and a label that would land on one already
   * placed in the same set is dropped. Fifteen layer numbers up the side of a
   * stack do not fit at any explode the die can take, so the set thins itself
   * out instead of the beat having to name a subset.
   */
  update({ camera, rect, subjects, presence, weights, minRank = 0, want = null }) {
    const placed = new Map();          // set -> [[x, y], ...] already drawn
    for (const t of this.items) {
      const sub = subjects[t.subj];
      const g = sub && sub.groups[t.layer];
      // a label goes with its layer: if the layer is not drawn, nor is it
      const shown = (!g || !want) ? 1 : ((want[g.name] ?? 1) > 0.15 ? 1 : 0);
      const o = (t.rank < minRank ? 0 : 1) * shown * (presence[t.set] || 0) * (weights[t.subj] || 0);
      if (o < 0.02 || !sub || !g || g.userData.empty) { t.el.style.display = "none"; continue; }
      const dx = sub.labelX(t.layer);
      const yw = sub.labelY(t.layer);
      // An edge label sits against the right-hand edge of the layer's own
      // extent, not of the subject's box: the plates are different sizes and
      // a label on the box edge points at nothing.
      const bb = g.userData.bb;
      const [px, py] = project(
        t.edge ? v.set(sub.worldX(bb[2] + sub.W * 0.07 + dx), yw, sub.worldZ((bb[1] + bb[3]) / 2))
               : v.set(sub.worldX(t.x + dx), yw, sub.worldZ(t.y)),
        camera, rect);
      const near = placed.get(t.set) || [];
      if (near.some(([x, y]) => Math.abs(x - px) < 90 && Math.abs(y - py) < 15)) {
        t.el.style.display = "none"; continue;
      }
      near.push([px, py]); placed.set(t.set, near);

      t.el.style.display = "";
      t.el.style.opacity = o;
      t.el.style.left = (rect.left + px) + "px";
      t.el.style.top = (rect.top + py) + "px";
      t.el.style.transform = t.edge ? "translate(0, -50%)" : "translate(-50%, -50%)";
      if (t.edge && t.colour) t.el.style.borderColor = t.colour;
    }
  }
}

// -------------------------------------------------------------- arrows

/** A curve from a word in the prose to a pad on the chip. */
export class Arrows {
  constructor(svg) {
    this.svg = svg;
    this.items = [];
  }

  /** @param from a element in the prose; @param pin the label text to aim at */
  add({ from, subj, pin, layer, x, y }) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", "arrow");
    // presentation attributes, not just the stylesheet: the SVG has to survive
    // being serialised on its own when the page is captured as a still
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", theme.accent);
    path.setAttribute("stroke-width", "1.2");
    this.svg.appendChild(path);
    this.items.push({ from, subj, pin, layer, x, y, path });
  }

  update({ camera, canvas, subjects, weights, alpha }) {
    const box = this.svg.getBoundingClientRect();
    const rect = canvas.getBoundingClientRect();
    for (const a of this.items) {
      const sub = subjects[a.subj];
      const on = alpha * (weights[a.subj] || 0);
      if (on < 0.02 || !sub) { a.path.style.opacity = 0; continue; }
      // The line starts at the prose column's right edge, level with the
      // word, not at the word itself: from the word it would run across the
      // rest of the line. The word is marked by its own styling.
      const w = a.from.getBoundingClientRect();
      const col = a.from.closest(".prose")?.getBoundingClientRect() || w;
      const x0 = col.right - box.left - 6, y0 = w.top + w.height / 2 - box.top;
      const dx = sub.labelX(a.layer);
      const [px, py] = project(v.set(sub.worldX(a.x + dx), sub.labelY(a.layer),
                                     sub.worldZ(a.y)), camera,
                               { width: rect.width, height: rect.height });
      const x1 = rect.left - box.left + px, y1 = rect.top - box.top + py;
      const bend = Math.min(120, Math.abs(x1 - x0) * 0.45);
      a.path.setAttribute("d", `M ${x0 - 5} ${y0} m 0 -3 l 5 3 l -5 3 M ${x0} ${y0} C ${x0 + bend} ${y0}, ${x1 - bend} ${y1}, ${x1} ${y1}`);
      a.path.style.opacity = on;
    }
  }
}

// -------------------------------------------------------------- panels

/** Figures that cover or sit inside the pane, declared in the HTML as
    [data-panel="name"]. A beat names one; the rest fade out. */
export class Panels {
  constructor(root) {
    this.els = new Map([...root.querySelectorAll("[data-panel]")]
      .map(el => [el.dataset.panel, el]));
  }
  show(name) {
    for (const [k, el] of this.els) el.classList.toggle("on", k === name);
  }
}

// ------------------------------------------------------------- sidebar

/** Monospace only. Labels cut over; numerals tween. */
export class Sidebar {
  constructor(root) {
    this.pill = root.querySelector("[data-pill]");
    this.slots = [...root.querySelectorAll("[data-stat]")].map(el => ({
      k: el.querySelector(".k"), v: el.querySelector(".v"), cur: 0,
    }));
  }
  update(pill, stats) {
    this.pill.textContent = pill;
    this.slots.forEach((s, i) => {
      const [k, val] = stats[i] || ["", ""];
      s.k.textContent = k;
      if (typeof val === "number") {
        s.cur += (val - s.cur) * 0.16;
        if (Math.abs(val - s.cur) < 0.6) s.cur = val;
        s.v.textContent = Math.round(s.cur).toLocaleString("en-US");
      } else { s.cur = 0; s.v.textContent = val; }
    });
  }
}

// ------------------------------------------------------------- symbols

/** Which gate shape a cell draws as. Ported from netlist_view/render.py. */
export function family(base) {
  base = base.replace(/_\d+$/, "");
  if (/^(inv|clkinv|invlp)/.test(base)) return "inv";
  if (/^(buf|bufbuf|clkbuf)/.test(base)) return "buf";
  if (base.startsWith("xnor")) return "xnor";
  if (base.startsWith("xor")) return "xor";
  if (base.startsWith("mux")) return "mux";
  if (base.startsWith("df")) return "flop";
  const simple = base.match(/^(and|or|nand|nor)(\d)(b*)$/);
  if (simple) return simple[1];
  const compound = base.match(/^([ao])((?:\db*)+)(oi|o|ai|a)$/);
  if (compound) return compound[1] === "a" ? "aoi" : "oai";
  return "box";
}

const andPath = (x, y, w, h) => {
  const r = h / 2;
  return `M${x} ${y} L${x + w - r} ${y} A${r} ${r} 0 0 1 ${x + w - r} ${y + h} L${x} ${y + h} Z`;
};
const orPath = (x, y, w, h) =>
  `M${x} ${y} Q${x + w * 0.72} ${y + h * 0.05} ${x + w} ${y + h / 2} ` +
  `Q${x + w * 0.72} ${y + h * 0.95} ${x} ${y + h} Q${x + w * 0.26} ${y + h / 2} ${x} ${y} Z`;
const orBack = (x, y, w, h, dx) =>
  `M${x - dx} ${y} Q${x + w * 0.26 - dx} ${y + h / 2} ${x - dx} ${y + h}`;

/** One symbol, drawn into a 40 x 24 box, as SVG markup. */
export function symbolMarkup(base) {
  const fam = family(base), w = 40, h = 24, x = 0, y = 0;
  // A compound cell inverts when its name ends in i: a21oi does, a21o does not,
  // and `family` collapses both to the same shape. Without this the design's
  // 46 inverting compounds were drawn with no bubble beside 157 that genuinely
  // have none, which is the one thing the bubble is for.
  const compoundInv = ["aoi", "oai"].includes(fam) && /i$/.test(base.replace(/_\d+$/, ""));
  const inv = ["nand", "nor", "xnor", "inv"].includes(fam) || compoundInv;
  const bw = w - (inv ? 6 : 0);
  let s = "";
  if (fam === "and" || fam === "nand" || fam === "oai") s += `<path class="g" d="${andPath(x, y, bw, h)}"/>`;
  else if (["or", "nor", "xor", "xnor", "aoi"].includes(fam)) {
    s += `<path class="g" d="${orPath(x, y, bw, h)}"/>`;
    if (fam === "xor" || fam === "xnor") s += `<path class="gl" d="${orBack(x, y, bw, h, 4)}"/>`;
  } else if (fam === "inv" || fam === "buf") s += `<path class="g" d="M${x} ${y} L${x + bw} ${y + h / 2} L${x} ${y + h} Z"/>`;
  else if (fam === "mux") {
    const d = h * 0.18;
    s += `<path class="g" d="M${x} ${y} L${x + bw} ${y + d} L${x + bw} ${y + h - d} L${x} ${y + h} Z"/>`;
  } else if (fam === "flop") s += `<rect class="g" x="${x}" y="${y}" width="${bw}" height="${h}" rx="2"/>` +
    `<path class="gl" d="M${x} ${y + h * 0.6 - 3} L${x + 5} ${y + h * 0.6} L${x} ${y + h * 0.6 + 3}"/>`;
  else s += `<rect class="g" x="${x}" y="${y}" width="${bw}" height="${h}" rx="2"/>`;
  if (inv) s += `<circle class="bub" cx="${x + bw + 3}" cy="${y + h / 2}" r="3"/>`;
  if (["aoi", "oai", "box", "flop", "mux"].includes(fam))
    s += `<text class="bl" x="${x + bw / 2}" y="${y + h / 2 + 3}">${fam === "flop" ? "DFF" : fam === "mux" ? "M" : base.replace(/_\d+$/, "")}</text>`;
  return s;
}

/**
 * Gate symbols drawn over placed cells. One <g> per instance, positioned each
 * frame by projecting the instance's box, so a symbol sits on its cell at any
 * zoom and the wires between cells stay where the metal actually runs.
 */
export class Symbols {
  /** @param host key of the subject the instances are placed on */
  constructor(svg, host) { this.svg = svg; this.host = host; this.items = []; }

  /** @param inst {ref, cell, x, y, b: [x0,y0,x1,y1]} in die coordinates */
  add(inst) {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "sym");
    g.innerHTML = symbolMarkup(inst.cell);
    g.style.opacity = 0;
    this.svg.appendChild(g);
    this.items.push({ ...inst, g });
  }

  /**
   * @param weights  ref -> 0..1, how much of each symbol to show
   * @param subject  the die the instances are placed on
   */
  update({ camera, canvas, subject, weights }) {
    const box = this.svg.getBoundingClientRect();
    const rect = canvas.getBoundingClientRect();
    const dims = { width: rect.width, height: rect.height };
    const y = subject.stackTop * 1.6 + 0.5;
    for (const it of this.items) {
      const w = weights[it.ref] || 0;
      if (w < 0.02) { it.g.style.opacity = 0; it.g.style.display = "none"; continue; }
      const [x0, y0, x1, y1] = it.b;
      const [ax, ay] = project(v.set(subject.worldX(x0), y, subject.worldZ(y1)), camera, dims);
      const [bx, by] = project(v.set(subject.worldX(x1), y, subject.worldZ(y0)), camera, dims);
      const pw = Math.abs(bx - ax), ph = Math.abs(by - ay);
      // A symbol is an annotation, not geometry: it has a legible size on
      // screen whatever the zoom. Below ten pixels of cell it is not drawn at
      // all, and above that its width is held between 16 and 90 pixels.
      // Strokes do not scale (see the stylesheet), so a zoomed-in symbol is
      // not a fat one.
      if (pw < 10) { it.g.style.opacity = 0; it.g.style.display = "none"; continue; }
      const s = Math.max(16, Math.min(90, Math.min(pw, ph * 40 / 24) * 0.9)) / 40;
      const cx = rect.left - box.left + (ax + bx) / 2, cy = rect.top - box.top + (ay + by) / 2;
      it.g.style.display = "";
      it.g.style.opacity = w;
      it.g.setAttribute("transform", `translate(${cx - 20 * s} ${cy - 12 * s}) scale(${s})`);
    }
  }
}


// ------------------------------------------------------------ waveform

/**
 * The vendor's run as a waveform, drawn once from the trace, with a cursor
 * the engine moves. `mode` is "inputs" (rst_n, enable, I, success, and the
 * text on O) or "compare" (O as we computed it over O as the vendor
 * recorded it, one drawn over the other).
 */
export class Waveform {
  constructor(svg, trace, mode = "inputs", lanes = []) {
    this.svg = svg; this.trace = trace; this.mode = mode; this.lanes = lanes;
    this.W = 560; this.H = mode === "compare" ? 96 : mode === "nets" ? 22 + lanes.length * 22 : 150;
    this.x0 = 64; this.x1 = this.W - 12;
    svg.setAttribute("viewBox", `0 0 ${this.W} ${this.H}`);
    this.draw();
  }

  x(c) { return this.x0 + (c / Math.max(1, this.trace.cycles - 1)) * (this.x1 - this.x0); }

  lane(bits, y, h, cls = "") {
    let d = "";
    for (let c = 0; c < bits.length; c++) {
      const yy = y + h - bits[c] * h;
      d += (c ? `L${this.x(c).toFixed(1)} ${yy.toFixed(1)} ` : `M${this.x(0).toFixed(1)} ${yy.toFixed(1)} `);
      if (c + 1 < bits.length) d += `L${this.x(c + 1).toFixed(1)} ${yy.toFixed(1)} `;
    }
    return `<path class="wv ${cls}" d="${d}"/>`;
  }

  draw() {
    const T = this.trace, I = T.inputs, n = T.cycles;
    const mono = `font-family="ui-monospace,Menlo,monospace" font-size="9" letter-spacing="1"`;
    let s = "";
    if (this.mode === "inputs") {
      const lanes = [["rst_n", I.map(f => f.rst_n)], ["enable", I.map(f => f.enable)],
                     ["I", I.map(f => f.I)], ["success", I.map(f => f.success)]];
      lanes.forEach(([name, bits], k) => {
        const y = 14 + k * 26;
        s += `<text x="${this.x0 - 8}" y="${y + 13}" text-anchor="end" ${mono} class="wl">${name}</text>`;
        s += this.lane(bits, y, 14);
      });
      // O, decoded: a character where the byte changes
      const y = 14 + 4 * 26;
      s += `<text x="${this.x0 - 8}" y="${y + 13}" text-anchor="end" ${mono} class="wl">O</text>`;
      // a letter per byte change, but the readout changes every cycle or two
      // and the lane is 1.8px a cycle, so each letter also keeps a minimum
      // distance from the one before: the word stays in order and readable
      let last = null, lastX = -Infinity;
      for (let c = 0; c < n; c++) {
        const b = I[c].O;
        if (b !== last && b >= 32 && b < 127) {
          const x = Math.max(this.x(c), lastX + 8);
          s += `<text x="${x.toFixed(1)}" y="${y + 13}" ${mono} class="wo">${String.fromCharCode(b).replace("<", "&lt;").replace("&", "&amp;")}</text>`;
          lastX = x;
        }
        last = b;
      }
    } else if (this.mode === "nets") {
      const bit = (packed, c) => packed ? (packed[c >> 3] >> (c & 7)) & 1 : 0;
      this.lanes.forEach(([name, id], k) => {
        const y = 6 + k * 22, packed = T.bits[String(id)];
        const bits = Array.from({ length: n }, (_, c) => bit(packed, c));
        s += `<text x="${this.x0 - 8}" y="${y + 12}" text-anchor="end" ${mono} class="wl">${name}</text>`;
        s += this.lane(bits, y, 12);
      });
    } else {
      const ours = I.map(f => f.O / 255), theirs = I.map(f => (f.O_vendor ?? 0) / 255);
      s += `<text x="${this.x0 - 8}" y="26" text-anchor="end" ${mono} class="wl">O vendor</text>`;
      s += this.lane(theirs, 12, 30, "wv-them");
      s += `<text x="${this.x0 - 8}" y="70" text-anchor="end" ${mono} class="wl">O ours</text>`;
      s += this.lane(ours, 56, 30, "wv-us");
      const c = T.compared || {};
      s += `<text x="${this.x1}" y="${this.H - 4}" text-anchor="end" ${mono} class="wl">${c.match ?? "?"} bits match · ${c.mismatch ?? "?"} differ</text>`;
    }
    s += `<line class="wc" x1="${this.x0}" x2="${this.x0}" y1="4" y2="${this.H - 12}"/>`;
    s += `<text class="wl wcl" x="${this.x0}" y="${this.H - 2}" ${mono} text-anchor="middle">cycle 0</text>`;
    this.svg.innerHTML = s;
    this.cursor = this.svg.querySelector(".wc");
    this.cursorLabel = this.svg.querySelector(".wcl");
  }

  update({ cycle, on }) {
    const x = this.x(cycle).toFixed(1);
    this.cursor.setAttribute("x1", x); this.cursor.setAttribute("x2", x);
    this.cursorLabel.setAttribute("x", x);
    this.cursorLabel.textContent = `cycle ${cycle}`;
    this.svg.style.opacity = on > 0.02 ? 1 : 0.35;
  }
}


// -------------------------------------------------------------- frames

/** Rectangles drawn over the die, with a label: the regions of Act III. */
export class Frames {
  /** @param plain  outlines only: no label, no fill, ink stroke (cell boxes) */
  constructor(svg, host, plain = false) { this.svg = svg; this.host = host; this.plain = plain; this.items = []; }

  /** @param r {id, name, b: [x0, y0, x1, y1]} in die coordinates */
  add(r) {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", this.plain ? "frame plain" : r.sub ? "frame sub" : "frame");
    // eleven pieces in a column have no room for eleven names: `quiet` draws the block alone
    g.innerHTML = this.plain || r.quiet ? `<path/>` : `<path/><rect class="lb"/><text>${r.id}</text>`;
    if (r.colour) { g.style.setProperty("--fc", r.colour); g.style.setProperty("--ol", light(r.colour) ? "var(--ink)" : "#fff"); g.style.setProperty("--ow", light(r.colour) ? "2px" : "3.5px"); }
    if (r.tone !== undefined) g.style.setProperty("--fo", (0.5 + 0.22 * (r.tone % 2)).toFixed(2));   // neighbours differ in depth
    g.style.opacity = 0;
    this.svg.appendChild(g);
    this.items.push({ ...r, g, path: g.querySelector("path"), label: g.querySelector("text") });
  }

  update({ camera, canvas, subject, weights, named, labels = true, solid = false, labelAlpha = 1 }) {
    const box = this.svg.getBoundingClientRect();
    const rect = canvas.getBoundingClientRect();
    const dims = { width: rect.width, height: rect.height };
    const y = subject.stackTop * 1.6 + 0.8;
    for (const it of this.items) {
      const w = weights[it.id] || 0;
      if (w < 0.02) { it.g.style.opacity = 0; it.g.style.display = "none"; continue; }
      it.g.classList.toggle("solid", solid);
      // With the orbs up the chip is redundant, so it is dropped and the orb
      // carries the name instead. The name is a result: it appears only once the
      // reader has reached the beat that derives it.
      // a hidden label first fades, over the crossfade the orbs come up on
      if (it.label && !labels && labelAlpha < 0.02) { it.label.style.display = "none"; it.g.querySelector(".lb").style.display = "none"; }
      else if (it.label) {
        it.label.style.display = ""; it.g.querySelector(".lb").style.display = "";
        it.label.style.opacity = labels ? 1 : labelAlpha;
        const want = named && named.has(it.id) ? `${it.id} · ${it.name}` : it.id;
        if (it.label.textContent !== want) it.label.textContent = want;
      }
      const [x0, y0, x1, y1] = it.b;
      const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, yy]) => {
        const [px, py] = project(v.set(subject.worldX(x), y, subject.worldZ(yy)), camera, dims);
        return [rect.left - box.left + px, rect.top - box.top + py];
      });
      // a box under six pixels across is not an outline, it is noise
      const pw = Math.max(...pts.map(p => p[0])) - Math.min(...pts.map(p => p[0]));
      if (this.plain && pw < 6) { it.g.style.opacity = 0; it.g.style.display = "none"; continue; }
      if (it.spans) {
        // the footprint: one rectangle per merged run of cells along a row
        const proj = (x, yy) => {
          const [px, py] = project(v.set(subject.worldX(x), y, subject.worldZ(yy)), camera, dims);
          return [rect.left - box.left + px, rect.top - box.top + py];
        };
        let d = "";
        for (const [sx0, sy0, sx1, sy1] of it.spans) {
          const q = [[sx0, sy0], [sx1, sy0], [sx1, sy1], [sx0, sy1]].map(([x, yy]) => proj(x, yy));
          d += "M" + q.map(p => p.map(c => c.toFixed(1)).join(" ")).join(" L") + " Z";
        }
        it.path.setAttribute("d", d);
      } else it.path.setAttribute("d", "M" + pts.map(p => p.map(c => c.toFixed(1)).join(" ")).join(" L") + " Z");
      if (it.label) {
        // the top-left corner: least y, then least x
        const top = pts.reduce((a, p) => (p[1] < a[1] - 0.5 || (Math.abs(p[1] - a[1]) <= 0.5 && p[0] < a[0])) ? p : a);
        // above the frame as a rule; inside its corner when the frame is the
        // box itself, so the box carries its own mark
        const dy = solid ? 30 : 0;
        // a piece's label goes in its top-right corner, so it does not sit on
        // its box's own label when the two corners coincide
        const sub = it.g.classList.contains("sub");
        const lb = it.g.querySelector(".lb"), tw = it.label.getComputedTextLength?.() || 80;
        const right = Math.max(...pts.map(p => p[0]));
        const lx = sub ? right - 8 - tw : top[0] + 8;
        it.label.setAttribute("x", lx.toFixed(1));
        it.label.setAttribute("y", (top[1] - 9 + dy).toFixed(1));
        if (lb) { lb.setAttribute("x", (lx - 5).toFixed(1)); lb.setAttribute("y", (top[1] - 26 + dy).toFixed(1));
                  lb.setAttribute("width", (tw + 10).toFixed(1)); lb.setAttribute("height", 23); }
      }
      it.g.style.display = "";
      it.g.style.opacity = w;
    }
  }
}

// --------------------------------------------------------------- wires

/**
 * The region graph drawn ON the die: an orb over each region where it actually
 * sits in the pane, and an arrow for every net crossing between two of them.
 *
 * It is the same projection the frames use, so an orb stays over its rectangle
 * as the camera moves. Drawing it here rather than in a panel is the point:
 * the reader is looking at the chip, and the graph is an annotation of what
 * they are looking at, not a second picture of it beside the first.
 *
 * The edges come from src/regionmap.js, which strips the clock tree, the reset
 * connections and the buffers first. Without that the picture is a hairball.
 */
/** Is this fill light enough that a pale label on it would disappear? */
function light(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return false;
  const v = parseInt(m[1], 16);
  // 118 puts the olive and gold of the ramp on the light side, where ink
  // reads on them, and leaves the deep teals and blues to cream
  return (0.2126 * (v >> 16) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) > 118;
}

/** Fit a card rect behind a text element, with a little air, or hide it
    when the text is empty. Measured, so it fits whatever the font does. */
function card(rect, text, px = 5, py = 1) {
  if (!rect) return;
  if (!text.textContent || text.style.display === "none") { rect.style.display = "none"; return; }
  let bb;
  try { bb = text.getBBox(); } catch (e) { rect.style.display = "none"; return; }
  if (!bb.width) { rect.style.display = "none"; return; }
  rect.setAttribute("x", (bb.x - px).toFixed(1)); rect.setAttribute("y", (bb.y - py + 1).toFixed(1));
  rect.setAttribute("width", (bb.width + 2 * px).toFixed(1)); rect.setAttribute("height", (bb.height + 2 * py - 2).toFixed(1));
  rect.style.display = "";
}

export class Wires {
  /** @param regions [{id, name, b}]  @param edges Map "A>B" -> wire count
      @param ports [{id, x, y}] the chip's own pins, at their pads */
  constructor(svg, host, regions, edges, clock, ports, colourOf, layout = null) {
    this.svg = svg; this.host = host;
    this.regions = regions; this.ports = ports; this.colourOf = colourOf;
    // where each node goes when the die drops away and the graph orders itself
    // by flow; see trophicLayout in regionmap.js
    this.layout = layout;
    // The clock is carried alongside the data edges, not mixed into them: it
    // is inferred from a region holding flops rather than traced, and it is
    // not dataflow, so it is drawn dashed and thin and never sets an arrow's
    // weight against the wires that carry values.
    this.edges = [
      ...[...edges].map(([k, w]) => {
        const [a, b] = k.split(">");
        return { a, b, w, both: edges.has(`${b}>${a}`) };
      }),
      ...[...(clock || [])].map(([k, w]) => {
        const [a, b] = k.split(">");
        return { a, b, w, both: false, clock: true };
      }),
    ];
    this.widest = Math.max(1, ...this.edges.filter(e => !e.clock).map(e => e.w));

    const g = t => { const n = document.createElementNS("http://www.w3.org/2000/svg", t); this.svg.appendChild(n); return n; };
    // Every edge is a thin ink line with a proper head: the head is a fixed
    // size in pixels (markerUnits userSpaceOnUse), so it does not scale with
    // the line's weight and the line never shows past its tip. Weight still
    // says how many wires the edge carries.
    this.svg.innerHTML = `<defs><marker id="warrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" ` +
      `markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--ink)"/></marker></defs>`;
    this.arcs = this.edges.map(e => {
      const w = e.clock ? 0.7 : 0.5 + 1.5 * Math.sqrt(e.w / this.widest);
      const path = g("path");
      path.setAttribute("class", e.clock ? "warc clk" : "warc");
      path.setAttribute("marker-end", "url(#warrow)");
      path.setAttribute("stroke-width", w.toFixed(2));
      path.innerHTML = e.clock
        ? `<title>${e.b} holds ${e.w} flop${e.w === 1 ? "" : "s"}, so the clock reaches it</title>`
        : `<title>${e.a} to ${e.b}: ${e.w} wire${e.w === 1 ? "" : "s"}</title>`;
      return { path };
    });
    // the wire count, said on the arrow itself in the black-box view
    this.counts = this.edges.map(e => {
      const t = g("text"); t.setAttribute("class", "wcnt"); t.textContent = e.w; t.style.display = "none"; return t;
    });
    // every label drawn over the die stands on a cream card with a rim, or it
    // is lost in the routing: the counts, the pin names and the orb names
    this.countCards = this.counts.map(t => { const r = g("rect"); r.setAttribute("class", "wlb"); this.svg.insertBefore(r, t); return r; });
    this.pins = ports.map(p => {
      const n = g("g");
      n.setAttribute("class", p.clock ? "wpin clk" : "wpin");
      n.innerHTML = `<circle r="4"/><rect class="wlb"/><text>${p.id}</text>`;
      return n;
    });
    this.orbs = regions.map(r => {
      const n = g("g"); n.setAttribute("class", "worb");
      n.style.setProperty("--fc", colourOf[r.id]);
      // the palette spans batlow end to end, so some fills are light: the
      // label takes ink on those and the pane colour on the dark ones
      n.style.setProperty("--tc", light(colourOf[r.id]) ? "var(--ink)" : "var(--pane)");
      // a light name is outlined in ink, a dark one in white
      n.style.setProperty("--ol", light(colourOf[r.id]) ? "var(--ink)" : "#fff");
      n.style.setProperty("--ow", light(colourOf[r.id]) ? "2px" : "3.5px");   // ink needs less of it
      n.innerHTML = `<circle r="21"/><text class="wid">${r.id}</text><rect class="wlb"/><text class="wnm"/>`;
      return n;
    });
  }

  update({ camera, canvas, subject, alpha, only, named, morph = 0, box: black = null, subs = null, settle = 1 }) {
    if (!subject || alpha < 0.02) { this.svg.style.opacity = 0; this.svg.style.display = "none"; return; }
    const box = this.svg.getBoundingClientRect();
    const rect = canvas.getBoundingClientRect();
    const dims = { width: rect.width, height: rect.height };
    const y = subject.stackTop * 1.6 + 1.2;
    const at = (x, z) => {
      const [px, py] = project(v.set(subject.worldX(x), y, subject.worldZ(z)), camera, dims);
      return [rect.left - box.left + px, rect.top - box.top + py];
    };
    // An orb rises out of its frame's label: while the orbs are still coming
    // up (`settle` below one) each stands between the label's corner and the
    // centre of its region, and arrives at the centre as the label goes.
    const P = {};
    for (const r of this.regions) {
      const c = at((r.b[0] + r.b[2]) / 2, (r.b[1] + r.b[3]) / 2), l = at(r.b[0], r.b[3]);
      const k = Math.min(1, Math.max(0, settle));
      P[r.id] = [l[0] + 22 + (c[0] - l[0] - 22) * k, l[1] + 10 + (c[1] - l[1] - 10) * k];
    }
    for (const p of this.ports) P[p.id] = at(p.x, p.y);
    // `morph` slides every node from where it sits on the die to where the
    // flow puts it. The same orbs, rearranged, rather than a second picture.
    if (morph > 0.001 && this.layout) {
      const L = rect.left - box.left, T = rect.top - box.top;
      const padX = rect.width * 0.14, padY = rect.height * 0.09;
      const gx = v => L + padX + v * (rect.width - 2 * padX);
      const gy = v => T + padY + v * (rect.height - 2 * padY);
      for (const [id, q] of Object.entries(this.layout)) {
        if (!P[id]) continue;
        P[id] = [P[id][0] + (gx(q.x) - P[id][0]) * morph,
                 P[id][1] + (gy(q.y) - P[id][1]) * morph];
      }
    }
    const RAD = 21, PR = 5;
    const rad = id => (this.colourOf[id] ? RAD : PR);

    // The black-box view: one region's frame is the box, and everything it
    // talks to stands beside it as a stand-in, sources in a column on the
    // left and readers in a column on the right, wherever they really sit.
    // A neighbour that both feeds the box and reads it stands once, on the
    // left, and its return arrow comes back to it.
    let frame = null, live = null, both = new Set();
    const RP = {};                        // right-column positions, box view only
    if (black) {
      const R = this.regions.find(r => r.id === black);
      const c = [[R.b[0], R.b[1]], [R.b[2], R.b[1]], [R.b[2], R.b[3]], [R.b[0], R.b[3]]].map(([x, z]) => at(x, z));
      frame = { left: Math.min(...c.map(p => p[0])), right: Math.max(...c.map(p => p[0])),
                top: Math.min(...c.map(p => p[1])), bottom: Math.max(...c.map(p => p[1])) };
      const ins = this.edges.filter(e => e.b === black);
      const outs = this.edges.filter(e => e.a === black);
      const midY = (frame.top + frame.bottom) / 2, GAP = 46, OFF = 120;
      // Two columns with their own positions, so a neighbour that both feeds
      // the box and reads it stands on the left as a source AND on the right
      // as a reader, with an arrow at each. It used to stand once, on the
      // left, with the return arrow coming back to it, which read as one wire.
      // each column in the order its arrows land, top to bottom, so an arrow
      // into the lowest piece comes from the lowest stand-in and none cross
      const landY = e => {
        const bs = subs && subs[`${e.a}>${e.b}`];
        if (!bs || !bs.length) return midY;
        return bs.reduce((acc, sb) => acc + (at(sb[0], sb[1])[1] + at(sb[2], sb[3])[1]) / 2, 0) / bs.length;
      };
      ins.sort((p, q) => landY(p) - landY(q));
      outs.sort((p, q) => landY(p) - landY(q));
      ins.forEach((e, k) => { P[e.a] = [frame.left - OFF, midY + (k - (ins.length - 1) / 2) * GAP]; });
      outs.forEach((e, k) => { RP[e.b] = [frame.right + OFF, midY + (k - (outs.length - 1) / 2) * GAP]; });
      // P holds a projected spot for every region, so "also on the left" has
      // to be asked of the sources themselves. A reader that is not also a
      // source has one place, the right column, and its own orb goes there.
      const leftIds = new Set(ins.map(e => e.a));
      for (const id of Object.keys(RP)) if (!leftIds.has(id)) P[id] = RP[id];
      both = new Set(Object.keys(RP).filter(id => leftIds.has(id)));
      live = new Set([...ins.map(e => e.a), ...outs.map(e => e.b)]);
    }
    const on = id => black ? live.has(id) : (!only || only.has(id));
    const onEdge = e => black ? (e.a === black || e.b === black) : (on(e.a) && on(e.b));

    // an arrow per piece: a wire that enters two pieces is drawn twice, into
    // each. The first arrow is the edge's own path; the rest are clones made
    // as needed and hidden again when the beat moves on.
    for (const arc of this.arcs) for (const x of arc.extra || []) x.style.display = "none";
    this.edges.forEach((e, i) => {
      const arc = this.arcs[i], { path } = arc, cnt = this.counts[i];
      const A = P[e.a], B = (black && e.a === black) ? RP[e.b] : P[e.b];
      if (!A || !B || !onEdge(e)) { path.style.display = cnt.style.display = "none"; return; }
      const targets = black ? (subs && subs[`${e.a}>${e.b}`]) || [null] : [null];
      targets.forEach((sb, t) => {
        let line = path;
        if (t > 0) {
          arc.extra ||= [];
          if (!arc.extra[t - 1]) { const c = path.cloneNode(false); this.svg.insertBefore(c, path); arc.extra[t - 1] = c; }
          line = arc.extra[t - 1];
        }
        let ax, ay, ex, ey;
        if (black) {
          // from the stand-in to inside the piece it enters (or out of the
          // piece it leaves), the head just past the piece's edge
          const other = e.a === black ? B : A, orbR = rad(e.a === black ? e.b : e.a);
          let fr = frame;
          if (sb) {
            const c = [[sb[0], sb[1]], [sb[2], sb[1]], [sb[2], sb[3]], [sb[0], sb[3]]].map(([x, z]) => at(x, z));
            fr = { left: Math.min(...c.map(p => p[0])), right: Math.max(...c.map(p => p[0])),
                   top: Math.min(...c.map(p => p[1])), bottom: Math.max(...c.map(p => p[1])) };
          }
          const leftSide = other[0] < frame.left;
          const fy = Math.max(fr.top + 8, Math.min(fr.bottom - 8, other[1]));
          if (e.b === black) {
            const fx = leftSide ? fr.left + 10 : fr.right - 10;
            const dx = fx - other[0], dy = fy - other[1], d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
            ax = other[0] + ux * (orbR + 2); ay = other[1] + uy * (orbR + 2); ex = fx; ey = fy;
          } else {
            const fx = leftSide ? fr.left + 10 : fr.right - 10;
            const dx = other[0] - fx, dy = other[1] - fy, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
            ax = fx; ay = fy; ex = other[0] - ux * (orbR + 6); ey = other[1] - uy * (orbR + 6);
          }
        } else {
          const dx = B[0] - A[0], dy = B[1] - A[1], d = Math.hypot(dx, dy) || 1;
          const ux = dx / d, uy = dy / d;
          ax = A[0] + ux * (rad(e.a) + 2); ay = A[1] + uy * (rad(e.a) + 2);
          ex = B[0] - ux * (rad(e.b) + 6); ey = B[1] - uy * (rad(e.b) + 6);
        }
        const dx = ex - ax, dy = ey - ay, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
        // a pair that talks both ways gets a bow each, so the two read apart;
        // in the box view the two directions stand on opposite sides, so the
        // arrows run straight
        const bow = e.both && !black ? 16 : 0;
        const mx = (ax + ex) / 2 - uy * bow, my = (ay + ey) / 2 + ux * bow;
        line.setAttribute("d", `M${ax.toFixed(1)} ${ay.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`);
        // a wire fanned out to many pieces is drawn as a bundle of fine lines
        line.setAttribute("stroke-width", targets.length > 4 ? "0.6" : path.dataset.w || path.getAttribute("stroke-width"));
        if (!path.dataset.w) path.dataset.w = path.getAttribute("stroke-width");
        line.style.display = "";
        if (t === 0) {
          if (black && !e.clock) {
            // the count sits just off the first arrow's middle
            cnt.setAttribute("x", ((ax + ex) / 2 - uy * (bow / 2 + 13)).toFixed(1));
            cnt.setAttribute("y", ((ay + ey) / 2 + ux * (bow / 2 + 13) + 6).toFixed(1));
            cnt.style.display = "";
            this.countCards[i].style.display = "none";     // a count is text; its outline carries it
          } else { cnt.style.display = "none"; this.countCards[i].style.display = "none"; }
        }
      });
    });
    this.ports.forEach((p, i) => {
      const n = this.pins[i], q = P[p.id];
      const live = this.edges.some(e => (e.a === p.id || e.b === p.id) && onEdge(e));
      if (!live) { n.style.display = "none"; return; }
      n.querySelector("circle").setAttribute("cx", q[0].toFixed(1));
      n.querySelector("circle").setAttribute("cy", q[1].toFixed(1));
      // the label goes outward, away from the die, or it lands on the chip
      const t = n.querySelector("text"), rightHalf = q[0] > rect.left - box.left + rect.width / 2;
      t.setAttribute("x", (q[0] + (rightHalf ? PR + 10 : -PR - 10)).toFixed(1));
      t.setAttribute("y", (q[1] + 6).toFixed(1));
      t.setAttribute("text-anchor", rightHalf ? "start" : "end");
      n.style.display = "";
      card(n.querySelector(".wlb"), t);
    });
    this.regions.forEach((r, i) => {
      const n = this.orbs[i], q = P[r.id];
      if (!on(r.id)) { n.style.display = "none"; return; }
      n.querySelector("circle").setAttribute("cx", q[0].toFixed(1));
      n.querySelector("circle").setAttribute("cy", q[1].toFixed(1));
      const t = n.querySelector(".wid");
      t.setAttribute("x", q[0].toFixed(1));
      t.setAttribute("y", (q[1] + 5.5).toFixed(1));
      // the name is a result: it appears only once the beat has derived it
      const nm = n.querySelector(".wnm"), want = named && named.has(r.id) ? r.name : "";
      if (nm.textContent !== want) nm.textContent = want;
      // in the box view the arrow leaves the orb toward the frame, so the name
      // goes on the other side of it; drawn inward it sat on the arrow
      const outward = black && frame && q[0] < frame.left;
      nm.setAttribute("x", (q[0] + (outward ? -(RAD + 12) : RAD + 12)).toFixed(1));
      nm.setAttribute("text-anchor", outward ? "end" : "start");
      nm.setAttribute("y", (q[1] + 6).toFixed(1));
      n.style.display = "";
      card(n.querySelector(".wlb"), nm);
    });
    // the reciprocal neighbours, standing a second time on the right
    if (!this.dupes) this.dupes = new Map();
    for (const d of this.dupes.values()) d.style.display = "none";
    if (black) for (const [id, q] of Object.entries(RP)) {
      if (!both.has(id)) continue;                       // only those also standing on the left
      let d = this.dupes.get(id);
      if (!d) { d = this.orbs[this.regions.findIndex(r => r.id === id)].cloneNode(true); this.svg.appendChild(d); this.dupes.set(id, d); }
      d.querySelector("circle").setAttribute("cx", q[0].toFixed(1)); d.querySelector("circle").setAttribute("cy", q[1].toFixed(1));
      const t = d.querySelector(".wid"); t.setAttribute("x", q[0].toFixed(1)); t.setAttribute("y", (q[1] + 5.5).toFixed(1));
      const nm = d.querySelector(".wnm"); nm.textContent = named && named.has(id) ? this.regions.find(r => r.id === id).name : "";
      nm.setAttribute("x", (q[0] + RAD + 12).toFixed(1)); nm.setAttribute("text-anchor", "start"); nm.setAttribute("y", (q[1] + 6).toFixed(1));
      d.style.display = "";
      card(d.querySelector(".wlb"), nm);
    }
    this.svg.style.display = "";
    this.svg.style.opacity = alpha;
  }
}

// ---------------------------------------------------------------- grid

/**
 * The 121 input bits laid out as an 11 by 11 grid, filled as far as the
 * current cycle. The feed starts on the first cycle with enable high.
 */
export class Grid {
  constructor(svg, trace) {
    this.svg = svg; this.trace = trace;
    this.start = trace.inputs.findIndex(f => f.enable === 1);
    const N = 11, C = 18, P = 8;
    svg.setAttribute("viewBox", `0 0 ${N * C + 2 * P + 120} ${N * C + 2 * P}`);
    this.cells = [];
    let s = "";
    for (let k = 0; k < N * N; k++) {
      const x = P + (k % N) * C, y = P + Math.floor(k / N) * C;
      s += `<rect class="gc" x="${x}" y="${y}" width="${C - 2}" height="${C - 2}"/>`;
    }
    s += `<text class="wl gcap" x="${N * C + 2 * P + 8}" y="${P + 12}"></text>`;
    svg.innerHTML = s;
    this.cells = [...svg.querySelectorAll(".gc")];
    this.cap = svg.querySelector(".gcap");
  }

  update({ cycle, on }) {
    const I = this.trace.inputs, k0 = this.start;
    let ones = 0;
    this.cells.forEach((c, k) => {
      const cyc = k0 + k;
      const arrived = cyc <= cycle && k0 >= 0;
      const bit = arrived ? I[cyc]?.I : 0;
      c.setAttribute("class", "gc" + (arrived ? (bit ? " on" : " zero") : ""));
      if (arrived && bit) ones++;
    });
    const filled = Math.max(0, Math.min(121, cycle - k0 + 1));
    this.cap.textContent = `${filled} of 121 · ${ones} ones`;
    this.svg.style.opacity = on > 0.02 ? 1 : 0.35;
  }
}


// ---------------------------------------------------------- code window

/** A makeshift editor: lines carry data-phase, and the line whose phase the
    current cycle is in is marked hot. Phases are read off the trace. */
export class CodeWindow {
  constructor(pre, trace) {
    this.pre = pre; this.lines = [...pre.querySelectorAll("[data-phase]")];
    const inp = trace.inputs, N = trace.cycles;
    this.resetEnd = inp.findIndex(f => f.rst_n === 1);
    this.feedStart = inp.findIndex(f => f.enable === 1);
    const after = inp.findIndex((f, i) => i > this.feedStart && f.enable === 0);
    this.feedEnd = (after < 0 ? N : after) - 1;
    this.cap = pre.parentElement.querySelector("[data-code-cap]");
  }
  phase(c) {
    if (c < this.resetEnd) return "reset";
    if (c < this.feedStart) return "wait";
    if (c <= this.feedEnd) return "feed";
    return "readout";
  }
  update({ cycle, on }) {
    const ph = this.phase(cycle);
    for (const l of this.lines) l.classList.toggle("hot", l.dataset.phase === ph);
    if (this.cap) this.cap.textContent = ph === "feed" ? `cycle ${cycle} · bit ${cycle - this.feedStart + 1} of 121` : `cycle ${cycle} · ${ph}`;
    this.pre.style.opacity = on > 0.02 ? 1 : 0.5;
  }
}


// -------------------------------------------------------------- sketch

/**
 * A drawing in a subject's own coordinates, laid over the pane: the transistor
 * diagram on a cell, the schematic over the XOR.
 *
 * The markup is authored once in micrometres with y up, and each frame the
 * group takes an affine transform built by projecting three points of that
 * space. These beats are plan views, so the mapping is exactly affine and one
 * matrix is the whole placement. Strokes keep their width through it; see the
 * stylesheet.
 */
export class Sketch {
  constructor(svg) { this.svg = svg; this.items = new Map(); }

  add(id, subj, markup) {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "sketch");
    g.innerHTML = markup;
    g.style.opacity = 0;
    this.svg.appendChild(g);
    this.items.set(id, { id, subj, g });
  }

  update({ camera, canvas, subjects, weights }) {
    const box = this.svg.getBoundingClientRect();
    const rect = canvas.getBoundingClientRect();
    const dims = { width: rect.width, height: rect.height };
    for (const it of this.items.values()) {
      const w = weights[it.id] || 0;
      const sub = subjects[it.subj];
      if (w < 0.02 || !sub) { it.g.style.opacity = 0; it.g.style.display = "none"; continue; }
      const h = sub.stackTop * 1.6 + 0.6;
      const at = (x, y) => {
        const [px, py] = project(v.set(sub.worldX(x), h, sub.worldZ(y)), camera, dims);
        return [rect.left - box.left + px, rect.top - box.top + py];
      };
      const o = at(0, 0), ex = at(1, 0), ey = at(0, 1);
      it.g.setAttribute("transform",
        `matrix(${ex[0] - o[0]} ${ex[1] - o[1]} ${ey[0] - o[0]} ${ey[1] - o[1]} ${o[0]} ${o[1]})`);
      it.g.style.display = "";
      it.g.style.opacity = w;
    }
  }
}

// ---------------------------------------------------------------- flow

/**
 * The whole netlist as a flow: every gate a dot, every wire a line, the
 * chip's inputs on the left and its outputs on the right, placed by
 * gateFlow in regionmap.js. `morph` slides each dot from where its cell sits
 * on the die to where the flow puts it, so the picture is the die's cells
 * rearranging, the way the region orbs do one act later.
 */
/* One colour per cell type, taken along batlow.

   Sampled straight from U(0,1) the sixty-three types in this design collide:
   five pairs land on the same colour, among them a flip-flop and a NAND. So
   the sampled values are pushed apart to a minimum separation while keeping
   their order -- still a random draw, but no two types come out the same.

   That needs the whole set at once, so `prime` is called with every cell in
   the design before anything is drawn. The seed is a hash of the type name,
   so a type keeps its colour across reloads, and the ramp is read from the
   theme, so it follows the scheme picker. */
const typeColour = (() => {
  const cache = new Map();
  let ramp = null;
  const base = c => String(c).replace(/_\d+$/, "");
  const mix = (p, q, f) => "#" + [0, 1, 2].map(k =>
    Math.round(p[k] + (q[k] - p[k]) * f).toString(16).padStart(2, "0")).join("");
  const hash = t => {
    let h = 2166136261;
    for (const ch of t) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return ((h >>> 0) % 100000) / 100000;
  };
  const load = () => {
    // theme.oslo is --layer-0..14, which is batlow shuffled so no two layers
    // next to each other look alike. Sorting by luminance puts it back in order.
    ramp = theme.oslo.map(h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16)))
      .sort((p, q) => (p[0] + p[1] + p[2]) - (q[0] + q[1] + q[2]));
  };
  const at = u => {
    if (!ramp) load();
    const x = Math.max(0, Math.min(1, u)) * (ramp.length - 1);
    const i = Math.min(Math.floor(x), ramp.length - 2);
    return mix(ramp[i], ramp[i + 1], x - i);
  };
  const fn = cell => cache.get(base(cell)) ?? at(hash(base(cell)));
  fn.prime = cells => {
    const types = [...new Set(cells.map(base))];
    const u = new Map(types.map(t => [t, hash(t)]));
    const ord = [...types].sort((p, q) => u.get(p) - u.get(q));
    const gap = 0.98 / Math.max(1, ord.length - 1);
    for (let pass = 0; pass < 200; pass++) {
      for (let k = 1; k < ord.length; k++)
        if (u.get(ord[k]) < u.get(ord[k - 1]) + gap) u.set(ord[k], u.get(ord[k - 1]) + gap);
      const hi = u.get(ord[ord.length - 1]);
      if (hi > 1) for (const t of ord) u.set(t, u.get(t) - (hi - 1));
      const lo = u.get(ord[0]);
      if (lo < 0) for (const t of ord) u.set(t, u.get(t) - lo);
    }
    cache.clear();
    for (const t of types) cache.set(t, at(u.get(t)));
  };
  return fn;
})();

/** A five-pointed star as a path, centred, for the boards. */
function star(cx, cy, r) {
  let d = "";
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r * 0.42 : r;
    d += (i ? "L" : "M") + (cx + q * Math.cos(a)).toFixed(2) + " " + (cy + q * Math.sin(a)).toFixed(2);
  }
  return d + "z";
}

/* Small boards floating in the pane.

   Three sets of them, and a beat names the one it wants. `rules` is the five
   conditions, `solution` is the single board that satisfies them, `answers`
   is the five runs and what came back on O. They are not figures in the
   prose: on these beats the boards are the picture, so they sit on the right.

   Each card drifts on its own: the period, the phase, how far it goes and how
   much it leans are all taken from a hash of its name, so no two are ever in
   step and the group never reads as a grid being animated. */
const hash = str => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
};

export class Cards {
  /** @param sets  {name: [{cap, at, w, k, cells, stars, cross, count, msg}]} */
  constructor(svg, sets) {
    this.svg = svg; this.sets = sets;
    const ns = "http://www.w3.org/2000/svg";
    for (const [name, cards] of Object.entries(sets)) {
      for (const c of cards) {
        const W = c.w || 110, PAD = 11, lines = (c.cap ? 1 : 0) + (c.msg ? 1 : 0);
        const H = 110 + PAD + lines * 22;
        const g = document.createElementNS(ns, "g");
        g.setAttribute("class", "rk");
        // a card to float ON: without it the pale cells sit straight on
        // whatever is behind and read as part of it
        let h = `<rect class="rbg" x="${-PAD + (110 - W) / 2}" y="${-PAD}" width="${W + 2 * PAD}" height="${H + PAD}" rx="7"/>`;
        for (let k = 0; k < 121; k++)
          h += `<rect class="rc" x="${(k % 11) * 10 + 0.5}" y="${(k / 11 | 0) * 10 + 0.5}" width="9" height="9" rx="1.5" fill="${c.cells(k)}"/>`;
        for (const k of c.stars || [])
          h += `<path class="rs" d="${star(((k % 11) + 0.5) * 10, ((k / 11 | 0) + 0.5) * 10, 4.4)}" fill="${c.starFill || "var(--ink)"}"/>`;
        for (const k of c.cross || []) {
          const x = ((k % 11) + 0.5) * 10, y = ((k / 11 | 0) + 0.5) * 10, r = 2;
          h += `<path class="rx" d="M${x - r} ${y - r}L${x + r} ${y + r}M${x - r} ${y + r}L${x + r} ${y - r}"/>`;
        }
        if (c.count) h += `<text class="rn" x="55" y="66" text-anchor="middle">${c.count}</text>`;
        let y = 110 + 20;
        if (c.cap) { h += `<text class="rl" x="55" y="${y}" text-anchor="middle">${c.cap}</text>`; y += 22; }
        if (c.msg) h += `<text class="rm" x="55" y="${y}" text-anchor="middle">${c.msg}</text>`;
        g.innerHTML = h;
        this.svg.appendChild(g);
        c.g = g; c.set = name;
        const seed = name + "/" + (c.cap || c.msg || "");
        c.sway = { per: 7 + hash(seed) * 9, ph: hash(seed + "p") * 6.283, amp: 3 + hash(seed + "a") * 5,
                   rper: 9 + hash(seed + "r") * 11, rph: hash(seed + "q") * 6.283,
                   ramp: 0.5 + hash(seed + "t") * 1.3, xamp: 1 + hash(seed + "x") * 3 };
      }
    }
  }

  /** @param alphaOf  set name -> how much of it is on screen */
  update({ canvas, alphaOf }) {
    const box = this.svg.getBoundingClientRect(), rect = canvas.getBoundingClientRect();
    const L = rect.left - box.left, T = rect.top - box.top;
    const t = performance.now() / 1000;
    let any = 0;
    for (const [name, cards] of Object.entries(this.sets)) {
      const alpha = alphaOf(name);
      any = Math.max(any, alpha);
      for (const c of cards) {
        if (alpha < 0.02) { c.g.style.display = "none"; continue; }
        c.g.style.display = ""; c.g.style.opacity = alpha;
        const k = (c.k || 1) * Math.max(0.55, Math.min(1.15, Math.min(rect.width, rect.height) / 820));
        const w = c.sway;
        const dy = Math.sin(t / w.per * 2 * Math.PI + w.ph) * w.amp;
        const dx = Math.cos(t / (w.per * 1.31) * 2 * Math.PI + w.ph) * w.xamp;
        const rot = Math.sin(t / w.rper * 2 * Math.PI + w.rph) * w.ramp;
        const x = L + c.at[0] * rect.width - 55 * k + dx, y = T + c.at[1] * rect.height - 55 * k + dy;
        c.g.setAttribute("transform",
          `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${k.toFixed(3)}) rotate(${rot.toFixed(2)} 55 55)`);
      }
    }
    this.svg.style.display = any < 0.02 ? "none" : "";
  }
}

export class Flow {
  /** @param flow {pos, edges, ports} from gateFlow  @param nets the design, for die positions */
  constructor(svg, host, flow, nets) {
    this.svg = svg; this.host = host; this.flow = flow;
    const byRef = new Map(nets.instances.map(i => [i.ref, i]));
    this.ids = Object.keys(flow.pos).map(k => (/^\d+$/.test(k) ? +k : k));
    typeColour.prime(nets.instances.map(i => i.cell));
    const pad = {};
    for (const l of nets.die.labels || []) pad[l.text] = [l.x, l.y];
    const [bx0, by0, , by1] = nets.die.bbox;
    this.die = {};
    for (const id of this.ids)
      this.die[id] = typeof id === "number" ? [byRef.get(id).x, byRef.get(id).y] : (pad[id] || [bx0, (by0 + by1) / 2]);
    const g = t => { const n = document.createElementNS("http://www.w3.org/2000/svg", t); this.svg.appendChild(n); return n; };
    this.lines = g("path"); this.lines.setAttribute("class", "fl");
    this.dots = new Map();
    for (const id of this.ids) {
      if (typeof id === "number") {
        const n = g("circle"), inst = byRef.get(id);
        n.setAttribute("class", "fd " + family(inst.cell));
        n.style.fill = typeColour(inst.cell);
        n.setAttribute("r", isFlop(inst) ? 3 : 2);
        this.dots.set(id, n);
      } else {
        const n = g("g");
        n.setAttribute("class", "fp");
        n.innerHTML = `<circle r="4"/><text>${id}</text>`;
        this.dots.set(id, n);
      }
    }
    this.inPort = new Set(flow.ports.in);
  }

  update({ camera, canvas, subject, alpha, morph = 0 }) {
    if (!subject || alpha < 0.02) { this.svg.style.opacity = 0; this.svg.style.display = "none"; return; }
    const box = this.svg.getBoundingClientRect();
    const rect = canvas.getBoundingClientRect();
    const dims = { width: rect.width, height: rect.height };
    const h = subject.stackTop * 1.6 + 1.2;
    const L = rect.left - box.left, T = rect.top - box.top;
    const padX = rect.width * 0.1, padY = rect.height * 0.06;
    const P = {};
    for (const id of this.ids) {
      const [dx, dy] = this.die[id];
      const [px, py] = project(v.set(subject.worldX(dx), h, subject.worldZ(dy)), camera, dims);
      const q = this.flow.pos[id];
      const fx = L + padX + q[0] * (rect.width - 2 * padX), fy = T + padY + q[1] * (rect.height - 2 * padY);
      P[id] = [L + px + (fx - L - px) * morph, T + py + (fy - T - py) * morph];
    }
    // a wire leaves and arrives level, bending in between, so the columns read
    let d = "";
    for (const [a, b] of this.flow.edges) {
      const A = P[a], B = P[b];
      if (!A || !B) continue;
      const mx = ((A[0] + B[0]) / 2).toFixed(1);
      d += `M${A[0].toFixed(1)} ${A[1].toFixed(1)}C${mx} ${A[1].toFixed(1)} ${mx} ${B[1].toFixed(1)} ${B[0].toFixed(1)} ${B[1].toFixed(1)}`;
    }
    this.lines.setAttribute("d", d);
    for (const [id, n] of this.dots) {
      const q = P[id];
      if (typeof id === "number") { n.setAttribute("cx", q[0].toFixed(1)); n.setAttribute("cy", q[1].toFixed(1)); continue; }
      const c = n.querySelector("circle"), t = n.querySelector("text"), left = this.inPort.has(id);
      c.setAttribute("cx", q[0].toFixed(1)); c.setAttribute("cy", q[1].toFixed(1));
      t.setAttribute("x", (q[0] + (left ? -8 : 8)).toFixed(1)); t.setAttribute("y", (q[1] + 3.5).toFixed(1));
      t.setAttribute("text-anchor", left ? "end" : "start");
    }
    this.svg.style.display = "";
    this.svg.style.opacity = alpha;
  }
}
