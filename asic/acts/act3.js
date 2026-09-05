/* Act III: the chip taken apart region by region, from the outside in.

   Every region is treated as a black box first: what comes in, what goes out,
   what it remembers. All three are read off the data. An instance belongs to
   the region whose 220/0 rectangle holds its centre; a net whose driver is in
   one region and a reader in another is an edge between them; a flop inside is
   memory. The deeper beats after the pass use the groups the analysis found in
   puzzle_structure.json. Nothing here rediscovers either. */

import { AZ } from "../src/engine.js";
import { logo, ABOVE_MET3 } from "./common.js";
import { theme } from "../src/theme.js";
import { regionGraph, trophicLayout, isFlop } from "../src/regionmap.js";

const TOP = { az: AZ, elev: Math.PI / 2, ortho: 1, fov: 12 };
const NET = "dienet";
const INSIDE = { nwell: 0.12, diff: 0.12, poly: 0.12, licon1: 0.12 };
/* Every layer a spec does not name is drawn FULLY OPAQUE: `wants` falls back
   to 1. GROUND named the cell layers, li1, mcon, met3 and everything above
   met3, and quietly left met1, via, met2 and via2 at 1.0 -- so the middle of
   the stack was the most solid thing in every Act III beat, in saturated
   bands across the whole die, and no amount of dimming the fills below it
   made any difference. */
const GROUND = { ...INSIDE, li1: 0.45, mcon: 0.4, met1: 0.32, via: 0.22,
                 met2: 0.32, via2: 0.22, met3: 0.55, ...ABOVE_MET3 };
/* A region beat is about the LOGIC inside one box, and the logic is the
   transistor level: the diffusion and the poly over it. GROUND draws those at
   0.12, so brightening their colour did almost nothing -- the polygons were
   88 per cent transparent, and `dim` only changes colour, never opacity. That
   is why the vertex colours measured a healthy gap while the screen showed
   nothing. They come up here; `dim` washes the ones outside the box back. */
const REGION = { ...GROUND, nwell: 0.45, diff: 0.62, poly: 0.62, licon1: 0.4 };
// The chip as a backdrop: enough to see it is a chip, faint enough that the
// region frames drawn over it are the thing you look at.
const BACKDROP = { nwell: 0.06, diff: 0.06, poly: 0.06, licon1: 0.05, li1: 0.16, mcon: 0.1,
                   met1: 0.12, via: 0.08, met2: 0.12, via2: 0.08, met3: 0.14, ...ABOVE_MET3 };
// The die taken away. Spelled out layer by layer rather than as `layers: 0`:
// a numeric spec is the engine's signal to ghost the whole subject, and that
// path puts BOTH neighbouring transitions into the ghost material -- the matte
// look. Zero on every layer fades the die without touching materials.
const GONE = Object.fromEntries(Object.keys(BACKDROP).map(k => [k, 0]));

// the order the regions are opened in: the trophic diagram read left to
// right, so every box comes after the boxes that feed it
const ORDER = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10", "R11"];

export function act3(nets, sim, regions, structure) {
  const I = nets.instances, byRef = new Map(I.map(i => [i.ref, i]));
  const [bx0, by0, bx1, by1] = nets.die.bbox, DW = bx1 - bx0, DH = by1 - by0;
  const R = Object.fromEntries(regions.map(r => [r.id, r]));
  const colourOf = Object.fromEntries(regions.map((r, k) => [r.id, theme.region[k % theme.region.length]]));
  const portOf = Object.fromEntries(Object.entries(nets.ports).map(([k, v]) => [v, k]));

  // ---- membership, drivers, readers -----------------------------------------
  // All of it from src/regionmap.js, which is the port of regiondag.py: the
  // clock tree, reset and the buffers come out before anything is counted, so
  // the wires listed here and the arrows on the map are the same dataflow.
  const G = regionGraph(nets, regions);
  const { reg, driver, readers } = G;

  /** A region as a black box. */
  const blackBox = id => {
    const insts = G.logic.filter(i => reg.get(i.ref) === id);
    const flops = insts.filter(isFlop);
    const ins = [], outs = [];
    for (const [n, d] of driver) {
      const src = reg.get(d), dsts = new Set([...(readers.get(n) || [])].map(r => reg.get(r)));
      if (src !== id && dsts.has(id)) ins.push({ net: n, from: src, port: portOf[n] });
      if (src === id) {
        const away = [...dsts].filter(x => x !== id);
        const port = portOf[n];
        if (away.length || port) outs.push({ net: n, to: away, port });
      }
    }
    for (const [name, n] of Object.entries(nets.ports)) {           // driven from outside the chip
      if (name === "clk" || name === "rst_n" || driver.has(n)) continue;
      if ([...(readers.get(n) || [])].some(r => reg.get(r) === id)) ins.push({ net: n, from: null, port: name });
    }
    return { id, name: R[id].name, insts, flops, ins, outs };
  };
  const boxes = Object.fromEntries(regions.map(r => [r.id, blackBox(r.id)]));
  const edges = G.edges;
  // The pins the graph uses. They sit off the die on the side they belong to,
  // and level with the block they talk to when they talk to exactly one, so
  // enable lines up with the phase and success with the verdict. At their own
  // pads they land on the die edge and read as part of the routing.
  const bus = id => id.replace(/\[\d+\]$/, "[0..7]");
  const padOf = {};
  for (const l of nets.die.labels || []) {
    if (nets.ports[l.text] === undefined) continue;
    const id = bus(l.text);
    if (!(id in padOf)) padOf[id] = [l.x, l.y];
  }
  const keys = [...edges.keys(), ...G.clock.keys()];
  const ports = G.ports.map(p => {
    const to = keys.filter(k => k.startsWith(`${p.id}>`)).map(k => k.split(">")[1]);
    const from = keys.filter(k => k.endsWith(`>${p.id}`)).map(k => k.split(">")[0]);
    const only = p.kind === "input" ? to : from;
    const pad = padOf[p.id] || [bx0, (by0 + by1) / 2];
    const y = only.length === 1 ? (R[only[0]].b[1] + R[only[0]].b[3]) / 2 : pad[1];
    return { id: p.id, kind: p.kind, clock: !!p.clock,
             x: p.kind === "input" ? bx0 - DW * 0.09 : bx1 + DW * 0.13, y };
  });

  // ---- helpers for the beats -----------------------------------------------
  const tintNets = (list, colour) => Object.fromEntries(list.map(e => [e.net, colour]));
  const qNets = (insts, colour) => Object.fromEntries(insts.flatMap(i =>
    ["Q", "Q_N"].filter(p => i.pins[p] !== undefined).map(p => [i.pins[p], colour])));
  const boxFocus = (bs, pad = 1.5) => {
    const x0 = Math.min(...bs.map(b => b[0])), y0 = Math.min(...bs.map(b => b[1]));
    const x1 = Math.max(...bs.map(b => b[2])), y1 = Math.max(...bs.map(b => b[3]));
    return [((x0 + x1) / 2 - bx0) / DW, ((y0 + y1) / 2 - by0) / DH,
            Math.min(1, pad * Math.max((x1 - x0) / DW, (y1 - y0) / DH))];
  };
  const on = (...ids) => boxFocus(ids.map(id => R[id].b), 1.8);
  const T = theme.tint;

  /** One black-box beat: the region framed in its colour, its flops lit in
      that colour, its inputs in one tint and its outputs in another. */
  // A region's name is a result, so it is withheld until its beat: each beat
  // carries the list of regions named so far, and the frames show the rest
  // by number only.
  const named = [];
  // The pieces of a box: its cells joined by the nets that stay inside it.
  // A checker bank falls into eleven of them, the window into a chain and an
  // AND tree. Each piece gets its own shade of the box's colour, so the pane
  // shows the box coming apart before the text says how many parts it has.
  const pieceOf = id => {
    const cells = G.graph.filter(i => reg.get(i.ref) === id);
    const par = new Map(cells.map(c => [c.ref, c.ref]));
    const find = a => { while (par.get(a) !== a) { par.set(a, par.get(par.get(a))); a = par.get(a); } return a; };
    for (const [n, d] of driver) {
      if (reg.get(d) !== id) continue;
      for (const q of readers.get(n) || []) if (reg.get(q) === id) par.set(find(q), find(d));
    }
    const roots = [...new Set(cells.map(c => find(c.ref)))];
    // biggest piece first, so the main body keeps the colour nearest the frame
    const size = Object.fromEntries(roots.map(r => [r, cells.filter(c => find(c.ref) === r).length]));
    roots.sort((a, b) => size[b] - size[a]);
    const index = new Map(roots.map((r, k) => [r, k]));
    return { of: ref => index.get(find(ref)), n: roots.length };
  };
  // the box's colour, lighter or darker by where the piece falls in the count
  const shade = (hex, t) => {
    const v = parseInt(hex.slice(1), 16), c = [v >> 16, (v >> 8) & 255, v & 255].map(x => x / 255);
    const max = Math.max(...c), min = Math.min(...c), l = (max + min) / 2, d = max - min;
    const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (d) { const [r, g, bl] = c; h = max === r ? ((g - bl) / d) % 6 : max === g ? (bl - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360; }
    const L = Math.min(0.88, Math.max(0.16, l + t));
    const C = (1 - Math.abs(2 * L - 1)) * sat, X = C * (1 - Math.abs((h / 60) % 2 - 1)), m = L - C / 2;
    const [r1, g1, b1] = h < 60 ? [C, X, 0] : h < 120 ? [X, C, 0] : h < 180 ? [0, C, X] : h < 240 ? [0, X, C] : h < 300 ? [X, 0, C] : [C, 0, X];
    return "#" + [r1, g1, b1].map(x => Math.round((x + m) * 255).toString(16).padStart(2, "0")).join("");
  };
  const pieces = Object.fromEntries(regions.map(r => [r.id, pieceOf(r.id)]));
  // A box that comes apart into a few pieces of any size is drawn as those
  // pieces too: a dashed sub-box around each, lettered a, b, ... by size. Lone
  // cells (tie cells, a buffer passing through) do not get one. The arrows of
  // the box view then aim at the piece that actually reads or drives them,
  // so eleven wires into a four-gate AND tree are seen going there.
  const pieceBoxes = {};
  for (const r of regions) {
    const p = pieces[r.id];
    if (p.n < 2) continue;
    const byPiece = new Map();
    for (const c of G.graph) if (reg.get(c.ref) === r.id) { const k = p.of(c.ref); (byPiece.get(k) || byPiece.set(k, []).get(k)).push(byRef.get(c.ref)); }
    const big = [...byPiece].filter(([, cs]) => cs.length >= 3).sort((x, y) => y[1].length - x[1].length);
    if (big.length < 2 || big.length > 11) continue;
    // The pieces are drawn as separate blocks stacked inside the box, sized
    // by their cell count, whatever their cells' real positions. On the die
    // the pieces interleave, and drawn where they lie they read as one; the
    // point of the beat is that they are several, so the picture bends that
    // far. A box taller than wide stacks them top to bottom, a wide one left
    // to right.
    const [x0, y0, x1, y1] = r.b, W = x1 - x0, H = y1 - y0, n = big.length;
    const tall = H >= W, span = tall ? H : W, pad = Math.min(1.2, span * 0.02), inset = Math.min(2, Math.min(W, H) * 0.08);
    const total = big.reduce((a, [, cs]) => a + cs.length, 0);
    const floor = 0.55 / n;                        // no piece thinner than about half its even share
    const raw = big.map(([, cs]) => Math.max(floor, cs.length / total));
    const norm = raw.reduce((a, v) => a + v, 0);
    const room = span - pad * (n + 1);
    let cursor = pad;
    pieceBoxes[r.id] = big.map(([k], j) => {
      const len = room * raw[j] / norm, from = cursor;
      cursor += len + pad;
      const b = tall ? [x0 + inset, y1 - from - len, x1 - inset, y1 - from]
                     : [x0 + from, y0 + inset, x0 + from + len, y1 - inset];
      return { id: n > 4 ? `${r.id}·${j + 1}` : `${r.id}${"abcd"[j]}`, piece: k, b, many: n > 4 };
    });
  }
  const subsFor = id => {
    const pb = pieceBoxes[id];
    if (!pb) return null;
    const boxOf = k => pb.find(x => x.piece === k)?.b;
    const tally = {};
    const note = (key, k) => { (tally[key] ||= new Set()).add(k); };
    for (const [net, d] of driver) {
      const a = reg.get(d);
      for (const q of readers.get(net) || []) {
        const b = reg.get(q);
        if (a === id && b && b !== id) note(`${id}>${b}`, pieces[id].of(d));
        if (b === id && a && a !== id) note(`${a}>${id}`, pieces[id].of(q));
      }
      if (a === id && portOf[net]) note(`${id}>${bus(portOf[net])}`, pieces[id].of(d));
    }
    for (const [name, net] of Object.entries(nets.ports)) {
      if (driver.has(net)) continue;
      for (const q of readers.get(net) || []) if (reg.get(q) === id) note(`${bus(name)}>${id}`, pieces[id].of(q));
    }
    // every piece a wire enters or leaves, each drawn with its own arrow
    const out = {};
    for (const [key, ks] of Object.entries(tally)) { const bs = [...ks].map(boxOf).filter(Boolean); if (bs.length) out[key] = bs; }
    return out;
  };
  // A piece keeps its layers' own colours, lifted as the spot lifts the box,
  // so the logic reads as it did in Act I. Pieces are told apart by how far
  // they are lifted: alternating lighter and darker steps out from the base.
  const pieceShade = (id, ref) => {
    const p = pieces[id], k = p.of(ref) ?? 0;
    if (p.n < 2) return "+";
    const step = (Math.floor((k + 1) / 2)) * (k % 2 ? 1 : -1) * (0.28 / Math.max(2, Math.ceil(p.n / 2)));
    return "+" + (0.12 + step).toFixed(3);
  };
  /* The power rails, which a region beat must not light: they run the width of
     every cell row and pass through every box on the die, so they are inside a
     region only geometrically. Everything else in the box is functional and
     stays lit, met included where it is part of a logical unit. */
  const RAILS = new Set([nets.ports.VPWR, nets.ports.VGND].filter(n => n !== undefined));

  const innerNets = id => {
    const out = {};
    for (const [net, d] of driver) if (reg.get(d) === id && !RAILS.has(net)) out[net] = pieceShade(id, d);
    return out;
  };
  const regionBeat = (id, n) => {
    const b = boxes[id];
    // What is inside the region is brightened where it stands; the wires that
    // cross the boundary keep their tints, one for in and one for out. The
    // rest of the die goes back so the block is the only thing lit.
    // The black box is drawn in the pane itself: the frame is the box, and
    // the regions and pins it talks to stand beside it as stand-in orbs, in a
    // column on the side they belong to, with the wire count on each arrow.
    // The strip that used to list the same below the pane is gone.
    const beat = { id: "a3-" + id, subj: NET, ...TOP, layers: REGION, focus: on(id),
      frames: [id, ...(pieceBoxes[id] || []).map(x => x.id)], boxSubs: subsFor(id),
      /* dim washes what is not lit toward the PANE, which is pale, so it makes
         the rest of the die brighter, not darker, and the region -- lifted but
         still fully coloured -- was ending up the darkest thing on screen. At
         0.62 the region read 0.666 against 0.750 around it: an eighth of a
         stop, which is why it looked like nothing had happened. At 0.88 the
         die falls away to nearly the page and the block is the only solid
         thing left, the gap going 0.084 -> 0.20. */
      /* And the outlines down with them. `lines` scales the polygon edges,
         which are drawn in ink and which `dim` never touches -- it works on
         fill colour alone. At die scale the edges are, as the engine puts it,
         all one sees: the die read as a mat of dark linework with the lit
         region a pale patch inside it, whatever the fills were doing. */
      spot: [logo(), [...R[id].b, "+", RAILS]], dim: 0.88, lines: 0.12,
      // every net driven inside the box takes the box's colour, so its logic
      // stays bright while `dim` washes the rest of the die; the crossing wires
      // and the flops are laid over that with their own tints
      nets: { ...innerNets(id), ...tintNets(b.ins, T.A), ...tintNets(b.outs, T.X),
              ...Object.fromEntries(b.flops.flatMap(i => ["Q", "Q_N"].filter(p => i.pins[p] !== undefined).map(p => [i.pins[p], pieceShade(id, i.ref)]))) },
      names: [...named], wires: "box", box: id, pill: `beat ${n}` };
    named.push(id);          // said only from the next beat on, never on its own
    return beat;
  };

  // ---- the deeper beats' groups ------------------------------------------------
  const refs = names => names.map(nm => byRef.get(+nm.slice(1))).filter(Boolean);
  const group = (family, name) => refs(structure[family]?.[name] || []);
  const colChecks = Object.keys(structure["column checkers"] || {}).flatMap(k => group("column checkers", k));
  const regChecks = Object.keys(structure["region checkers"] || {}).flatMap(k => group("region checkers", k));
  const col0 = group("column checkers", "col 0");
  const window_ = group("window", "shift register");
  const rules = [...group("rules", "row rule"), ...group("rules", "adjacency rule")];
  const star = group("rules", "star counter (total = 22)");
  const phase = [...group("control", "phase"), ...group("control", "readout enable")];
  const colCounter = group("control", "counter: column"), rowCounter = group("control", "counter: row");
  const lanes = (insts, prefix) => insts.map((i, k) => [`${prefix} ${k}`, i.pins.Q]).filter(l => l[1] !== undefined);
  const panels = { phase: lanes(phase, "phase"), counters: [...lanes(colCounter, "col"), ...lanes(rowCounter, "row")] };
  const inp = sim.inputs, N = sim.cycles;
  const feedStart = inp.findIndex(f => f.enable === 1);
  const after = inp.findIndex((f, i) => i > feedStart && f.enable === 0);
  const feedEnd = (after < 0 ? N : after) - 1;
  const stripFocus = [0.5, (-26 - by0) / DH, 0.32];
  // the cycle Act II ends on, so Act III opens on the same frame of the run
  const firstText = inp.findIndex((f, i) => i > feedEnd && f.O >= 32 && f.O < 127);
  const readoutEnd = inp.findIndex((f, i) => i > firstText && f.enable === 1);
  const lastCycle = readoutEnd < 0 ? N - 1 : readoutEnd - 1;

  let n = 24;
  const beats = [
    // the chip alone, then the blocks in it, then how they are wired together
    // The act opens where Act II left off -- same framing, the run still lit --
    // and the light drains over the first beat rather than cutting at the
    // heading. Arriving at the full-die fit in one step read as a jump.
    { id: "a3", spot: logo(), subj: NET, ...TOP, layers: GROUND, focus: [0.5, 0.5, 0.75],
      sim: true, cycle: lastCycle, pill: "part iii" },
    { id: "a3-look", spot: logo(), subj: NET, ...TOP, layers: BACKDROP, frames: "all", pill: `beat ${n++}` },
    { id: "a3-map", spot: logo(), subj: NET, ...TOP, layers: BACKDROP, frames: "all", wires: "all", pill: `beat ${n++}` },
    // The die goes and the same orbs reorder themselves by flow: inputs on one
    // x at the left, outputs on one x at the right, everything else between at
    // its trophic level. Nothing is added -- it is the picture above, with the
    // floorplan taken out from under it.
    { id: "a3-flow", subj: NET, ...TOP, layers: GONE, wires: "all", morph: 1, pill: `beat ${n++}` },
    ...ORDER.filter(id => id !== "R11").map(id => regionBeat(id, n++)),
  ];
  const ALL = [...ORDER];                      // every region named from here on
  beats.push(
    // The walk is over, so pull back and put the names on. Every heading up to
    // here was a location; this is the first frame where the die is labelled
    // with what each block does.
    // "Everything together": the walk is over, the die is labelled with what
    // each block does, and the five conditions the chip checks float over it,
    // each drifting on its own cycle. This is also where the puzzle is named.
    // The cards own this frame: the orbs, the arrows and the eleven names
    // under them showed through the gaps and read as clutter, so the die is
    // left as a backdrop and the five conditions are the only thing on it.
    { id: "a3-named", spot: logo(), subj: NET, ...TOP, layers: BACKDROP, cards: "rules", pill: `beat ${n++}` },

    // the one board that satisfies all five, on the patches it was checked
    // against, as a single card
    { id: "a3-solve", spot: logo(), subj: NET, ...TOP, layers: BACKDROP, cards: "solution", pill: `beat ${n++}` },
    // The output writer is the epilogue now, after the puzzle is named and
    // solved: it is the box the hint said to ignore, and nothing reads it.
    regionBeat("R11", n++),
    // The last frame: the board the chip was checking, laid over the chip.
    // No region frames under it -- the board's own cells carry the patches,
    // and two grids over one die is one too many.
    // the close: five inputs and what the chip said to each of them
    { id: "a3-close", spot: logo(), subj: NET, ...TOP, layers: BACKDROP, cards: "answers", pill: `beat ${n++}` },
  );
  for (const b of beats.slice(beats.findIndex(b => b.id === "a3-named"))) b.names = ALL;
  beats.push({ ...beats[beats.length - 1], id: "a3-notes", pill: "a1-notes" });

  // where the graph goes when the die drops away, seeded from where each block
  // sits on it so the reflow is the shortest move that gets there
  /* The layout weighs an edge by WIRES (G.edges), the same count the arrows
     draw, the plotter numbers by, and the R-numbers were derived from. It was
     tuned on G.fan -- reader cells -- and that ordered the blocks differently:
     R2 left of R1, R6 left of R5, the verdict seventh of eleven. One weighting
     for the numbering and another for the picture is how those disagree. */
  const flow = trophicLayout(regions, ports.filter(p => !p.clock), G.edges,
    Object.fromEntries(regions.map(r => [r.id, 1 - ((r.b[1] + r.b[3]) / 2 - by0) / DH])));

  return { beats, panels, boxes, edges, clock: G.clock, ports, flow, colourOf, order: ORDER, pieces, pieceBoxes, G,
           html: { io: ioPanels(boxes, R, colourOf) } };
}

// ---- generated panels ---------------------------------------------------------

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** What crosses each region's boundary, one [data-panel="io-R#"] each.

   One line per neighbour, not two: the count rides on the arrow as a small
   figure rather than spelling out "N wires" beside every label, and the lanes
   are spaced for the type instead of packed to the box height. */
function ioPanels(boxes, R, colourOf) {
  const name = (x, port) => port ? port : x ? x : "outside";
  const tally = (list, key) => {
    const c = new Map();
    for (const e of list) for (const w of key(e)) c.set(w, (c.get(w) || 0) + 1);
    return [...c].sort((a, b) => b[1] - a[1]);
  };
  return Object.values(boxes).map(b => {
    const ins = tally(b.ins, e => [name(e.from, e.port)]);
    const outs = tally(b.outs, e => e.to.length ? e.to.map(t => name(t)) : [name(null, e.port)]);
    const rows = Math.max(ins.length, outs.length, 1);
    const LANE = 30, W = 560, bw = 132;
    const H = Math.max(132, rows * LANE + 34), bx = (W - bw) / 2;
    const by = 18, bh = H - 36, mid = by + bh / 2;
    const c = colourOf[b.id];
    const mono = 'font-family="ui-monospace,Menlo,monospace"';
    let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
    s += `<defs><marker id="a${b.id}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">` +
         `<path d="M0 0L8 4L0 8Z" fill="var(--ink-2)"/></marker></defs>`;
    s += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="3" fill="${c}" fill-opacity=".14" stroke="${c}" stroke-width="1.8"/>`;
    s += `<text x="${bx + bw / 2}" y="${mid - 4}" ${mono} font-size="18" fill="${c}" text-anchor="middle">${b.id}</text>`;
    s += `<text x="${bx + bw / 2}" y="${mid + 17}" ${mono} font-size="12" fill="var(--ink-2)" text-anchor="middle">` +
         `${b.flops.length} flop${b.flops.length === 1 ? "" : "s"}</text>`;
    const lane = (k, n) => by + bh * (k + 1) / (n + 1);
    const arrow = (x0, x1, y, k) =>
      `<path d="M${x0} ${y.toFixed(1)} L${x1} ${y.toFixed(1)}" stroke="var(--ink-2)" ` +
      `stroke-width="${Math.min(3, 0.8 + k * 0.4)}" fill="none" marker-end="url(#a${b.id})"/>`;
    ins.forEach(([w, k], i) => {
      const y = lane(i, ins.length);
      s += arrow(52, bx - 4, y, k);
      s += `<text x="46" y="${(y + 4).toFixed(1)}" ${mono} font-size="13" fill="var(--ink-2)" text-anchor="end">${esc(w)}</text>`;
      s += `<text x="${(52 + bx - 4) / 2}" y="${(y - 7).toFixed(1)}" ${mono} font-size="11" fill="var(--ink-2)" opacity=".7" text-anchor="middle">${k}</text>`;
    });
    outs.forEach(([w, k], i) => {
      const y = lane(i, outs.length);
      s += arrow(bx + bw, W - 56, y, k);
      s += `<text x="${W - 50}" y="${(y + 4).toFixed(1)}" ${mono} font-size="13" fill="var(--ink-2)">${esc(w)}</text>`;
      s += `<text x="${(bx + bw + W - 56) / 2}" y="${(y - 7).toFixed(1)}" ${mono} font-size="11" fill="var(--ink-2)" opacity=".7" text-anchor="middle">${k}</text>`;
    });
    return `
  <div class="strip io" data-panel="io-${b.id}" style="--rc: ${c}">
    <div class="cap"><span class="chip">${b.id}</span> what goes in, what comes out, what it holds</div>
    ${s}</svg>
    <div class="wm">act iii</div>
  </div>`;
  }).join("");
}

