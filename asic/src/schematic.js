/* Drawings over a cell, built from the transistors the exporter found.

   Everything here is in the cell's own micrometres with y up, which is what
   Sketch expects; nothing is placed by hand. A transistor is a poly stripe
   crossing a diffusion region, and its terminals are the diffusion islands
   either side of that crossing, so the leads drawn below land on the real
   source and drain. */

import { theme } from "./theme.js";

const f = n => (+n).toFixed(3);

/** A stroke's width is in pixels, not micrometres. The group is scaled by a
    hundred and more to land on the cell, and `vector-effect` does not inherit
    from a group, so it goes on every shape drawn. */
const px = markup => markup.replace(/<(path|rect|circle|line|polyline)\b/g,
                                    '<$1 vector-effect="non-scaling-stroke"');

/** A label. The sketch's frame has y up and the screen has y down, so the
    group's matrix flips it; each piece of text turns itself back. */
/* A label is a box, not bare text: cream ground, a hairline border in the
   thing's own colour, ink type. Same as the `.tag` labels over the pane, so
   every label in the piece reads the same way and none of them disappears
   into the layout underneath. See README, "Labels".

   The face is monospace, so the box is sized from the character count: the
   advance width is 0.6em and there is no way to measure text at build time. */
const label = (x, y, text, { size = 0.12, fill = "currentColor", anchor = "middle" } = {}) => {
  const t = String(text), w = t.length * size * 0.6 + size * 0.5, h = size * 1.5;
  const dx = anchor === "start" ? -size * 0.25 : anchor === "end" ? -w + size * 0.25 : -w / 2;
  return `<g transform="translate(${f(x)} ${f(y)}) scale(1 -1)" class="lbl">` +
    `<rect x="${f(dx)}" y="${f(-h * 0.75)}" width="${f(w)}" height="${f(h)}" rx="${f(size * 0.18)}" ` +
    `fill="var(--cream)" stroke="${fill}" stroke-width="1"/>` +
    `<text x="0" y="0" font-size="${size}" fill="var(--ink)" text-anchor="${anchor}">${esc(t)}</text></g>`;
};
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** Parallel fingers are one device: same type, same gate, same pair of terminals. */
export function devices(cell) {
  const by = new Map();
  for (const t of cell.transistors || []) {
    const key = `${t.type}|${t.gate}|${[...t.sd].sort().join()}`;
    (by.get(key) || by.set(key, []).get(key)).push(t);
  }
  return [...by.values()].map(fingers => {
    const mid = fingers[Math.floor(fingers.length / 2)];
    return { ...mid, fingers: fingers.length,
             x: fingers.reduce((a, t) => a + (t.ch[0] + t.ch[2]) / 2, 0) / fingers.length };
  });
}

/** net id -> the pin it is, where it has a name. */
function pinOf(cell) {
  const out = new Map();
  for (const [name, net] of Object.entries(cell.nets || {})) out.set(net, name);
  return out;
}

/**
 * One transistor, drawn where it sits: the gate lead down the poly stripe to
 * a plate across the channel, and a lead out to each diffusion island.
 */
/** The transistor the eighth beat draws: an nMOS on an input gate whose source
    sits on the ground rail, nearest the middle of the cell so the leads have
    room either side.

    The rail terminal matters. In an XOR's pull-down mesh most devices have two
    internal nets either side, and a first transistor drawn with "net 9" under
    it teaches nothing. One standing on VGND shows the three terminals a reader
    can name: a gate on an input, a source on ground, a drain going on into the
    cell. */
export function pickTransistor(cell) {
  const mid = (cell.bbox[0] + cell.bbox[2]) / 2;
  const rails = new Set([cell.nets?.VPWR, cell.nets?.VGND].filter(n => n !== undefined));
  const gates = new Set(Object.entries(cell.nets || {})
    .filter(([n]) => n !== "VPWR" && n !== "VGND" && n !== "X" && n !== "Q")
    .map(([, net]) => net));
  const all = cell.transistors || [];
  const near = (a, b) => Math.abs((a.ch[0] + a.ch[2]) / 2 - mid) - Math.abs((b.ch[0] + b.ch[2]) / 2 - mid);
  const tiers = [
    t => t.type === "n" && gates.has(t.gate) && t.sd.some(n => rails.has(n)),
    t => t.type === "n" && gates.has(t.gate),
    t => t.type === "n",
  ];
  for (const ok of tiers) {
    const got = all.filter(ok).sort(near);
    if (got.length) return got[0];
  }
  return all[0];
}

export function transistorSketch(cell) {
  const t = pickTransistor(cell);
  if (!t) return "";
  const pin = pinOf(cell);
  const [x0, y0, x1, y1] = t.ch, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const ink = theme.ink, accent = theme.accent;
  const up = t.gateAt[1] > cy ? 1 : -1;
  // The source is the terminal standing on a rail, where there is one: that is
  // what a source is, and naming them by which is further left put "VGND" on
  // the drain half the time.
  const rails = new Set([cell.nets?.VPWR, cell.nets?.VGND].filter(n => n !== undefined));
  const k = t.sd.findIndex(n => rails.has(n));
  const si = k < 0 ? (t.sdAt[0][0] <= t.sdAt[1][0] ? 0 : 1) : k;
  const sn = t.sd[si], dn = t.sd[1 - si];
  const s = t.sdAt[si], d = t.sdAt[1 - si];
  const name = n => pin.get(n) || `net ${n}`;
  const plate = 0.5, lead = 0.13;

  // The wire each terminal is on: the li1 piece carrying that net. A lead is
  // drawn to a point on that piece rather than stopping at the contact, so
  // the eye follows the current to the rail on one side and out of the cell
  // on the other, which is where it actually goes.
  const wireOn = net => (cell.wires || []).filter(q => q.net === net)
    .sort((a, b) => (b.b[2] - b.b[0]) * (b.b[3] - b.b[1]) - (a.b[2] - a.b[0]) * (a.b[3] - a.b[1]))[0];
  const ws = wireOn(sn), wd = wireOn(dn);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const yMid = cy - up * lead * 0.5;

  /* A lead does not stop at the contact and it does not cut across its wire:
     it turns onto the li1 piece's CENTRELINE and runs down the middle of it to
     the far end -- into the rail on the source side, out of the cell on the
     drain side. Drawn down the middle, the line reads as the li being the wire
     rather than as an arrow pointing at it. */
  const along = (from, w) => {
    if (!w) return { d: `M${f(from[0])} ${f(from[1])}`, end: from };
    const [a0, c0, a1, c1] = w.b, e = 0.05;
    if (a1 - a0 > c1 - c0) {                       // the piece runs across
      const mid = (c0 + c1) / 2;
      const x = clamp(from[0], a0 + e, a1 - e);
      const far = (a1 - e - x) > (x - (a0 + e)) ? a1 - e : a0 + e;
      return { d: `M${f(from[0])} ${f(from[1])} L${f(x)} ${f(from[1])} L${f(x)} ${f(mid)} L${f(far)} ${f(mid)}`,
               end: [far, mid] };
    }
    const mid = (a0 + a1) / 2;                     // the piece runs up and down
    const y = clamp(from[1], c0 + e, c1 - e);
    const far = (c1 - e - y) > (y - (c0 + e)) ? c1 - e : c0 + e;
    return { d: `M${f(from[0])} ${f(from[1])} L${f(from[0])} ${f(y)} L${f(mid)} ${f(y)} L${f(mid)} ${f(far)}`,
             end: [mid, far] };
  };
  const src = along([cx - plate / 2, yMid], ws);
  const drn = along([cx + plate / 2, yMid], wd);
  const sEnd = src.end, dEnd = drn.end;

  const box = w => !w ? "" :
    `<rect x="${f(w.b[0])}" y="${f(w.b[1])}" width="${f(w.b[2] - w.b[0])}" height="${f(w.b[3] - w.b[1])}"
       fill="${accent}" fill-opacity=".16" stroke="${accent}" stroke-width="1.2"/>`;

  return px(`
    ${box(ws)}${box(wd)}
    <rect x="${f(x0 - 0.02)}" y="${f(y0 - 0.02)}" width="${f(x1 - x0 + 0.04)}" height="${f(y1 - y0 + 0.04)}"
          fill="${accent}" fill-opacity=".25" stroke="${accent}" stroke-width="2" stroke-dasharray="5 3"/>
    <g fill="none" stroke="${ink}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M${f(cx)} ${f(t.gateAt[1])} L${f(cx)} ${f(cy + up * lead)}"/>
      <path d="M${f(cx - plate / 2)} ${f(cy + up * lead)} L${f(cx + plate / 2)} ${f(cy + up * lead)}"/>
      <path d="M${f(cx - plate / 2)} ${f(yMid)} L${f(cx + plate / 2)} ${f(yMid)}"/>
      <path d="${src.d}"/>
      <path d="${drn.d}"/>
    </g>
    <g fill="${ink}" stroke="none">
      <circle cx="${f(sEnd[0])}" cy="${f(sEnd[1])}" r="0.055"/>
      <circle cx="${f(dEnd[0])}" cy="${f(dEnd[1])}" r="0.055"/>
    </g>
    ${label(cx, t.gateAt[1] + up * 0.17, `gate \u00b7 ${name(t.gate)}`, { size: 0.15, fill: ink })}
    ${label(sEnd[0], sEnd[1] - up * 0.2, name(sn), { size: 0.15, fill: ink, anchor: "end" })}
    ${label(dEnd[0], dEnd[1] + 0.2, name(dn), { size: 0.15, fill: ink, anchor: "end" })}
    ${label(cx, cy - up * 0.52, t.type === "p" ? "pMOS" : "nMOS", { size: 0.13, fill: accent })}`);
}

/**
 * The whole cell as a schematic laid over its layout: pull-up devices on a row
 * near the power rail, pull-down near ground, each at the x of the poly stripe
 * it is drawn on, so a symbol stands over the transistor it stands for. Every
 * net that is not a rail gets a colour and a line through its terminals.
 */
export function cellSchematic(cell, { labelScale = 1, tints = null } = {}) {
  const L = labelScale;
  // a colour's darker shade, for the outline under a line of that colour
  const darker = hex => {
    const m = /^#([0-9a-f]{6})$/i.exec((hex || "").trim());
    if (!m) return theme.ink;
    const v = parseInt(m[1], 16), r = v >> 16, g = (v >> 8) & 255, b = v & 255;
    return "#" + [r, g, b].map(x => Math.round(x * 0.62).toString(16).padStart(2, "0")).join("");
  };
  const [bx0, by0, bx1, by1] = cell.bbox;
  const dev = devices(cell), pin = pinOf(cell);
  const rails = new Set([cell.nets?.VPWR, cell.nets?.VGND].filter(n => n !== undefined));
  const yP = by1 - 0.62, yN = by0 + 0.62, half = 0.2;
  const ink = theme.ink, accent = theme.accent, ramp = theme.osloSeq;
  // A named pin's net takes the pin's tint when tints are given, so the lines
  // match the wires drawn on the pane; every other net takes the rails' brown.
  // Without tints, the ramp as before.
  const colour = new Map();
  let k = 0;
  for (const d of dev) for (const n of [d.gate, ...d.sd]) {
    if (rails.has(n) || colour.has(n)) continue;
    const nm = pin.get(n);
    colour.set(n, tints ? (tints[nm] || tints.VPWR || accent) : ramp[(k++ * 2 + 1) % ramp.length]);
  }

  const term = new Map();                       // net -> points to join up
  const push = (n, x, y) => { if (!rails.has(n)) (term.get(n) || term.set(n, []).get(n)).push([x, y]); };

  let s = `<g fill="none" stroke="${ink}" stroke-width="1.4" stroke-linecap="round">`;
  s += `<path d="M${f(bx0 + 0.1)} ${f(by1 - 0.12)} L${f(bx1 - 0.1)} ${f(by1 - 0.12)}"/>`;
  s += `<path d="M${f(bx0 + 0.1)} ${f(by0 + 0.12)} L${f(bx1 - 0.1)} ${f(by0 + 0.12)}"/></g>`;
  s += label(bx0 + 0.42, by1 - 0.26, "VPWR", { size: 0.13 * L, fill: ink });
  s += label(bx0 + 0.42, by0 + 0.22, "VGND", { size: 0.13 * L, fill: ink });

  for (const d of dev) {
    const y = d.type === "p" ? yP : yN, x = d.x;
    const railY = d.type === "p" ? by1 - 0.12 : by0 + 0.12;
    const toRail = d.sd.find(n => rails.has(n)), other = d.sd.find(n => !rails.has(n)) ?? d.sd[0];
    const gname = pin.get(d.gate) || "";
    s += `<g data-gate="${gname}" fill="none" stroke="${ink}" stroke-width="1.6" stroke-linecap="round">` +
         `<path d="M${f(x)} ${f(y - half)} L${f(x)} ${f(y + half)}"/>` +               // channel
         `<path d="M${f(x - 0.1)} ${f(y - half)} L${f(x - 0.1)} ${f(y + half)}"/>` +   // gate plate
         `<path d="M${f(x - 0.26)} ${f(y)} L${f(x - 0.1)} ${f(y)}"/>` +                // gate lead
         `<path d="M${f(x)} ${f(y + half)} L${f(x + 0.16)} ${f(y + half)}"/>` +
         `<path d="M${f(x)} ${f(y - half)} L${f(x + 0.16)} ${f(y - half)}"/></g>`;
    if (toRail !== undefined) {
      const ry = d.type === "p" ? y + half : y - half;
      s += `<path d="M${f(x + 0.16)} ${f(ry)} L${f(x + 0.16)} ${f(railY)}" stroke="${ink}" stroke-width="1.2" fill="none"/>`;
    }
    // a pMOS carries the bubble on its gate lead, as the library's own
    // schematics draw it
    if (d.type === "p") s += `<circle cx="${f(x - 0.185)}" cy="${f(y)}" r="0.05" fill="var(--cream)" stroke="${ink}" stroke-width="1.4"/>`;
    if (d.fingers > 1) s += label(x + 0.26, y, `x${d.fingers}`, { size: 0.09 * L, fill: ink, anchor: "start" });
    push(d.gate, x - 0.26, y);
    const far = d.type === "p" ? y - half : y + half;
    push(other, x + 0.16, far);
  }

  for (const [n, pts] of term) {
    if (pts.length < 2) continue;
    const c = colour.get(n) || accent;
    const sorted = [...pts].sort((a, b) => a[0] - b[0]);
    const busY = (by0 + by1) / 2 + (n % 5 - 2) * 0.09;
    const run = `<path d="M${f(sorted[0][0])} ${f(busY)} L${f(sorted[sorted.length - 1][0])} ${f(busY)}"/>` +
      sorted.map(([x, y]) => `<path d="M${f(x)} ${f(y)} L${f(x)} ${f(busY)}"/>`).join("");
    // drawn twice: a wider line in a darker shade of the colour first, then
    // the wire on top, so each line carries its own outline
    s += `<g class="halo" fill="none" stroke="${tints ? darker(c) : "var(--pane)"}" stroke-width="${tints ? 3.6 : 4.4}" stroke-linecap="round">${run}</g>`;
    s += `<g fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round">${run}</g>`;
    const nm = pin.get(n);
    if (nm) s += label(sorted[sorted.length - 1][0] + 0.12, busY, nm, { size: 0.14 * L, fill: c, anchor: "start" });
  }

  // A pin is named once, at the end of its own wire above. A second column of
  // pin names stacked in the cell's corner was read as stranded, so it is gone.
  return px(s);
}


/** A hex colour's luminance, for choosing an outline that reads on it. */
const lum = hex => {
  const m = /^#([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return 0;
  const v = parseInt(m[1], 16);
  return 0.2126 * (v >> 16) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255);
};

/**
 * The local wiring of a cell, drawn as it is: every li1 piece on a named
 * pin's net filled in that pin's tint and outlined in whichever of white or
 * ink reads on it, and the pin's name on the largest piece. Nothing is
 * abstracted; the polygons are the exporter's, so the wire is exactly where
 * it runs.
 */
export function wireSketch(cell, tints) {
  const pin = pinOf(cell);
  let s = "", labelled = new Set();
  const pieces = [...(cell.wires || [])].filter(w => w.ring && pin.has(w.net))
    .sort((a, b) => (b.b[2] - b.b[0]) * (b.b[3] - b.b[1]) - (a.b[2] - a.b[0]) * (a.b[3] - a.b[1]));
  for (const w of pieces) {
    const name = pin.get(w.net), c = tints[name] || theme.accent;
    const edge = lum(c) > 118 ? theme.ink : "#fff";
    const d = "M" + w.ring.map(([x, y]) => `${f(x / 1000)} ${f(y / 1000)}`).join(" L") + " Z";
    s += `<path d="${d}" fill="${c}" fill-opacity=".55" stroke="${edge}" stroke-width="1.6" stroke-linejoin="round"/>`;
    s += `<path d="${d}" fill="none" stroke="${c}" stroke-width="2.4" stroke-linejoin="round"/>`;
  }
  for (const w of pieces) {
    const name = pin.get(w.net);
    if (labelled.has(name)) continue;
    labelled.add(name);
    s += label(w.c[0], w.c[1], name, { size: 0.16, fill: tints[name] || theme.accent });
  }
  return px(s);
}


/** Point in polygon, on a ring of [x, y] pairs. */
const inside = (ring, x, y) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

/** The rings of one exported layer of a cell, in micrometres. */
function ringsOf(cell, name) {
  const L = (cell.layers || []).find(l => l.name === name);
  if (!L) return [];
  const out = [];
  let i = 0;
  for (const n of L.r.flat()) {
    const ring = [];
    for (let k = 0; k < n; k++) { ring.push([L.v[i] / 1000, L.v[i + 1] / 1000]); i += 2; }
    out.push(ring);
  }
  return out;
}

/**
 * One transistor's parts, painted in their layers' colours over a cell drawn
 * grey: the poly stripe that is its gate, the diffusion either side of the
 * gate that is its source and drain, cut to the transistor's own width, and
 * the local interconnect on both terminals. Each part is named.
 */
export function transistorParts(cell, colours) {
  const t = pickTransistor(cell);
  if (!t) return "";
  const pin = pinOf(cell);
  const [x0, y0, x1, y1] = t.ch, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const path = ring => "M" + ring.map(([x, y]) => `${f(x)} ${f(y)}`).join(" L") + " Z";
  const shape = (d, colour, extra = "") =>
    `<path d="${d}" fill="${colour}" fill-opacity=".9" stroke="${theme.ink}" stroke-width="1.2" stroke-linejoin="round"${extra}/>`;
  let s = "";
  // source and drain first: the diffusion either side of the gate, clipped to
  // a window around it so the islands read as this transistor's and not the
  // whole row's; the gate is drawn over them, as the poly lies over the silicon
  const W = 0.62;
  s += `<clipPath id="trwin"><rect x="${f(x0 - W)}" y="${f(y0 - 0.3)}" width="${f(x1 - x0 + 2 * W)}" height="${f(y1 - y0 + 0.6)}"/></clipPath>`;
  for (const [sx, sy] of t.sdAt) {
    const d = ringsOf(cell, "diff").find(r => inside(r, sx, sy));
    if (d) s += shape(path(d), colours.diff, ' clip-path="url(#trwin)"');
  }
  // the gate: the poly stripe through the channel
  const gate = ringsOf(cell, "poly").find(r => inside(r, cx, cy));
  if (gate) s += shape(path(gate), colours.poly);
  // Both terminal wires, selected by net rather than by left/right position.
  const rails = new Set([cell.nets?.VGND].filter(n => n !== undefined));
  const si = t.sd.findIndex(n => rails.has(n));
  const contacts = ringsOf(cell, "licon1").map(r => [
    r.reduce((sum, p) => sum + p[0], 0) / r.length,
    r.reduce((sum, p) => sum + p[1], 0) / r.length,
  ]);
  const terminalAt = t.sd.map((net, k) => {
    const wires = (cell.wires || []).filter(w => w.net === net && w.ring)
      .map(w => w.ring.map(([x, y]) => [x / 1000, y / 1000]));
    for (const ring of wires) s += shape(path(ring), colours.li1);
    const [sx, sy] = t.sdAt[k];
    return contacts.filter(([x, y]) => wires.some(r => inside(r, x, y)))
      .sort((a, b) => Math.hypot(a[0] - sx, a[1] - sy) - Math.hypot(b[0] - sx, b[1] - sy))[0] || t.sdAt[k];
  });
  // names
  const up = t.gateAt[1] > cy ? 1 : -1;
  s += label(cx, cy + up * 0.75, `gate \u00b7 ${pin.get(t.gate) || "poly"}`, { size: 0.16, fill: theme.ink });
  terminalAt.forEach(([sx, sy], k) => {
    const name = k === si ? "source" : "drain";
    const lx = sx + (sx < cx ? -0.25 : 0.25), ly = cy - up * 0.42;
    s += `<path d="M${f(sx)} ${f(sy)} L${f(lx)} ${f(ly)}" fill="none" stroke="${theme.ink}" stroke-width="1.2"/>`;
    s += `<circle cx="${f(sx)}" cy="${f(sy)}" r="0.025" fill="${theme.ink}"/>`;
    s += label(lx, ly, name, { size: 0.16, fill: colours.li1, anchor: sx < cx ? "end" : "start" });
  });
  if (si >= 0) s += label(cx + 1.6, cell.bbox[1] + 0.12, "VGND", { size: 0.16, fill: theme.ink, anchor: "start" });
  return px(s);
}
