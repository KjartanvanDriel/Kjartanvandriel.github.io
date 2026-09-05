/* Boot: load the geometry, build the subjects, collect the acts, start the loop.

   Adding an act means writing acts/actN.js, importing it here and concatenating
   its beats. Nothing else in this file should need to change. */

import { theme, reloadTheme } from "./src/theme.js";
import { Subject, retheme } from "./src/subjects.js";
import { Marks } from "./src/marks.js";
import { Tags, Arrows, Symbols, Frames, Wires, Flow, Cards, Grid, Sketch, Panels, Sidebar, Waveform, CodeWindow, symbolMarkup } from "./src/overlays.js";
import { gateFlow } from "./src/regionmap.js";
import { Engine } from "./src/engine.js";
import { transistorSketch, cellSchematic, wireSketch, transistorParts, pickTransistor } from "./src/schematic.js";
import { DevPanel } from "./src/devpanel.js";
import { Editor } from "./src/editor.js";
import { act1 } from "./acts/act1.js";
import { act2 } from "./acts/act2.js";
import { act3 } from "./acts/act3.js";
import { SOLUTION, TOUCHING, ANSWERS } from "./src/solution.js";

const DATA = "data/puzzle.json";
const NETS = "data/puzzle-nets.json";   // the same die, with its nets
const SIM  = "data/puzzle-sim.json";    // the vendor's run replayed on the traced netlist
const REGIONS = "data/puzzle-regions.json", STRUCTURE = "data/puzzle-structure.json";

// short annotations for the layer tour, keyed to the names in the stack file
const ANNOT = { nwell: "well", diff: "transistor", poly: "gate", licon1: "cut",
  li1: "local wiring", mcon: "cut", met1: "routing", via: "cut", met2: "routing",
  via2: "cut", met3: "routing", via3: "cut", met4: "routing", via4: "cut", met5: "routing" };

const canvas = document.getElementById("chip");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

/* Hand the GPU context back when the page goes away.

   A browser keeps only a handful of live WebGL contexts per process -- Chrome
   allows sixteen -- and hands out no more once they are gone. This page took a
   new one on every load and never released it, leaving each to garbage
   collection, which does not run on any schedule the next load can rely on.
   Reload the page often enough and `getContext` starts returning null for
   every canvas in the process, the pane goes blank, and only restarting the
   browser gets it back. Reloading is the whole development loop here, so this
   was reachable in an afternoon.

   `persisted` means the page went into the back/forward cache and may be
   restored as it is; destroying the context then would break it on return. */
addEventListener("pagehide", e => {
  if (e.persisted) return;
  renderer.forceContextLoss();
  renderer.dispose();
});
renderer.setClearColor(new THREE.Color(theme.pane));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 1, 20000);
const sun = new THREE.DirectionalLight(new THREE.Color(theme.sun), 1.15);
sun.position.set(0.6, 1, 0.45);
scene.add(sun, new THREE.AmbientLight(0xffffff, 0.5));

// the colour scheme, before anything reads the theme
const picker = document.querySelector("[data-scheme-picker]");
{
  let saved = null;
  try { saved = localStorage.getItem("scheme"); } catch (e) {}
  const scheme = saved || "batlow";                 // batlow until decided otherwise
  if (scheme !== "oslo") document.documentElement.dataset.scheme = scheme;
  if (picker) picker.value = scheme;
  reloadTheme();
  retheme();      // the subjects filled their palettes at import, before the scheme was set
}

const [data, nets, sim, regionsData, structure] = await Promise.all(
  [DATA, NETS, SIM, REGIONS, STRUCTURE].map(u => fetch(u).then(r => r.json())));

// unpack the trace: one Uint8Array per net, eight cycles to a byte
sim.bits = Object.fromEntries(Object.entries(sim.nets).map(([id, b64]) =>
  [id, Uint8Array.from(atob(b64), ch => ch.charCodeAt(0))]));
sim.colour = theme.live;

// one die, the netted one; the plain export's die is no longer built
const subjects = { dienet: new Subject("dienet", nets.die, scene) };
subjects.dienet.skipNets = new Set([nets.ports.VPWR, nets.ports.VGND, nets.ports.rst_n]);   // the rails and reset are never "every wire"
for (const [k, c] of Object.entries(data.cells)) subjects[k] = new Subject(k, c, scene);

const one = act1(data), two = act2(nets, sim), three = act3(nets, sim, regionsData.regions, structure);
const beats = [...one.beats, ...two.beats, ...three.beats];

// Camera fields tuned in the dev panel and saved sit in overrides.json, over
// the authored values in acts/. The acts stay the baseline; the file is what
// the panel writes. `bake` in the README folds one into the other.
const authored = Object.fromEntries(beats.map(b => [b.id, JSON.stringify(b)]));   // before overrides
try {
  const overrides = await (await fetch("overrides.json", { cache: "no-store" })).json();
  for (const b of beats) if (overrides[b.id]) Object.assign(b, overrides[b.id]);
} catch (e) {}
const { places } = one;
// Marks are registered per spec, and two acts ask for them: Act I for every
// cell type, Act II for the buffers.
const marks = [...one.marks, ...(two.marks || [])];

// each cell sits at the placement it was taken from, so the pane can move
// between the die and a cell by zooming rather than cutting
for (const [k, at] of Object.entries(places || {})) subjects[k].place(at);

// ---- projected labels -------------------------------------------------------
const tags = new Tags(document.getElementById("tags"));
const stackIndex = n => data.stack.findIndex(e => e.gds[0] === n && e.gds[1] === 20);

// Drawing layers outrank cuts, so when the set thins itself out it keeps the
// ones the prose names. Datatype 44 is a cut.
for (const subj of ["dienet", "rowcounter"]) data.stack.forEach((e, i) => {
  const rank = e.gds[1] === 44 ? 0 : 1;
  tags.add({ set: "num", subj, layer: i, text: `${e.gds[0]}/${e.gds[1]}`, edge: true, rank });
  tags.add({ set: "name", subj, layer: i, text: `${e.name}  ${ANNOT[e.name] || ""}`, edge: true, rank, colour: theme.oslo[i] });
});
for (const l of data.die.labels) {
  if (l.text === "VPWR" || l.text === "VGND") continue;
  tags.add({ set: "ports", subj: "dienet", layer: stackIndex(l.layer), text: l.text,
             x: l.x, y: l.y, cls: "port" });
}
const pinAt = {};                       // cell -> pin name -> {layer, x, y}
for (const [k, c] of Object.entries(data.cells)) {
  const seen = new Set();
  for (const l of c.labels) {
    if (seen.has(l.text)) continue;
    seen.add(l.text);
    // A label names the layer it was placed on, but the power labels are put
    // where the router will run met1, which a library cell does not contain:
    // in the cell those nets are carried on li1. Hang a label on the layer
    // that actually carries its net, or it disappears with a layer that never
    // held it.
    let li = stackIndex(l.layer);
    const net = c.nets?.[l.text];
    if (net !== undefined && (c.wires || []).some(w => w.net === net)) li = stackIndex(67);
    const at = { layer: li, x: l.x, y: l.y };
    (pinAt[k] ||= {})[l.text] = at;
    tags.add({ set: "pins", subj: k, text: l.text, cls: "pin", ...at });
  }
}

// ---- arrows from the prose to the pads --------------------------------------
const arrows = new Arrows(document.getElementById("arrows"));
for (const el of document.querySelectorAll("[data-pin]")) {
  const [cell, pin] = el.dataset.pin.split(":");
  const at = pinAt[cell]?.[pin];
  if (at) arrows.add({ from: el, subj: cell, pin, ...at });
  else console.warn(`no pad for ${el.dataset.pin}`);
}

// ---- gate symbols over the placed cells, for Act II ------------------------
const symbols = new Symbols(document.getElementById("symbols"), "dienet");
for (const inst of nets.instances) symbols.add(inst);

// ---- region frames over the die, for Act III --------------------------------
const frames = new Frames(document.getElementById("frames"), "dienet");
for (const r of regionsData.regions) frames.add({ ...r, colour: three.colourOf[r.id] });
// and the pieces a box comes apart into, dashed inside it
for (const [rid, list] of Object.entries(three.pieceBoxes))
  list.forEach((x, j) => frames.add({ id: x.id, name: "", b: x.b, colour: three.colourOf[rid], sub: true, tone: j, quiet: x.many }));

// the region graph over the die: orbs where the regions sit, arrows for the
// nets that cross between them
const wires = new Wires(document.getElementById("wires"), "dienet",
                        regionsData.regions, three.edges, three.clock, three.ports, three.colourOf, three.flow);
// the whole netlist as a flow, for Act II: a dot per gate, placed by level
const flow = new Flow(document.getElementById("flow"), "dienet", gateFlow(nets), nets);

// panels Act III writes from the data: one black-box table per region. They
// must exist before the engine collects [data-panel] elements.
document.getElementById("pane").insertAdjacentHTML("beforeend", three.html.io);
// cell boxes, for the beats that need it seen that a patch is several components
const outlines = new Frames(document.getElementById("outlines"), "dienet", true);

for (const inst of nets.instances) outlines.add({ id: inst.ref, name: "", b: inst.b });

// ---- drawings over a cell, from the transistors the exporter found --------
const sketch = new Sketch(document.getElementById("sketch"));
sketch.add("one-transistor", "xor2_2", transistorSketch(data.cells.xor2_2));
// one transistor's parts in their layers' colours, for the cell drawn grey
{
  const li = name => theme.oslo[data.stack.findIndex(e => e.name === name)];
  sketch.add("one-transistor-parts", "xor2_2", transistorParts(data.cells.xor2_2, { poly: li("poly"), diff: li("diff"), li1: li("li1") }));
}
sketch.add("xor-schematic", "xor2_2", cellSchematic(data.cells.xor2_2));
sketch.add("dff-schematic", "dfrtp_2", cellSchematic(data.cells.dfrtp_2));
sketch.add("buf-schematic", "clkbuf_4", cellSchematic(data.cells.clkbuf_4));
// the wires of a cell in the pins' tints, over the layout as it is
const WIRE_TINTS = { A: theme.tint.A, B: theme.tint.B, X: theme.tint.X, VPWR: theme.tint.VPWR, VGND: theme.tint.VGND,
                     D: theme.tint.A, CLK: theme.tint.B, Q: theme.tint.X, RESET_B: theme.region[10] };   // reset in the gold, apart from the clock's green
sketch.add("xor-wires", "xor2_2", wireSketch(data.cells.xor2_2, WIRE_TINTS));
sketch.add("dff-wires", "dfrtp_2", wireSketch(data.cells.dfrtp_2, WIRE_TINTS));
sketch.add("buf-wires", "clkbuf_4", wireSketch(data.cells.clkbuf_4, WIRE_TINTS));
drawCellFigure("xor-schematic-fig", data.cells.xor2_2, cellSchematic(data.cells.xor2_2, { labelScale: 1.5, tints: WIRE_TINTS }));   // labels at the body's size, lines in the pane's tints

// ---- the panels drawn from the trace ----------------------------------------
const waveforms = [...document.querySelectorAll("[data-wave]")].map(el => {
  const mode = el.dataset.wave;
  if (three.panels[mode]) return new Waveform(el, sim, "nets", three.panels[mode]);
  return new Waveform(el, sim, mode);
});
for (const el of document.querySelectorAll("[data-grid2]")) waveforms.push(new Grid(el, sim));
for (const el of document.querySelectorAll("[data-code]")) waveforms.push(new CodeWindow(el, sim));
// The 121 input bits as pixels, black for a one, drawn once and left alone;
// then an arrow to what the chip printed for them, read off the run.
for (const el of document.querySelectorAll("[data-input-pixels]")) {
  const start = sim.inputs.findIndex(f => f.enable === 1), N = 11, C = 18, P = 2, x0 = 40, y0 = 6;
  let g = "";
  for (let k = 0; k < N * N; k++) {
    const on = start >= 0 && sim.inputs[start + k]?.I === 1;
    g += `<rect x="${x0 + (k % N) * (C + P)}" y="${y0 + Math.floor(k / N) * (C + P)}" width="${C}" height="${C}" ` +
         `fill="${on ? "var(--ink)" : "var(--cream)"}" stroke="var(--grey-2)" stroke-width="1"/>`;
  }
  // the readout: the printable bytes on O after the feed, up to the next attempt
  const end = start + N * N;
  let said = "";
  for (let c = end; c < sim.inputs.length && !(c > end + 2 && sim.inputs[c].enable === 1); c++) {
    const o = sim.inputs[c].O;
    if (o >= 32 && o < 127) said += String.fromCharCode(o);
  }
  const gx1 = x0 + N * (C + P) - P, my = y0 + (N * (C + P) - P) / 2;
  g += `<defs><marker id="pxArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto">` +
       `<path d="M0 0L10 5L0 10z" fill="var(--ink)"/></marker></defs>`;
  g += `<path d="M${gx1 + 18} ${my} H${gx1 + 96}" fill="none" stroke="var(--ink)" stroke-width="1.6" marker-end="url(#pxArrow)"/>`;
  g += `<text class="fx" x="${gx1 + 112}" y="${my + 6}" style="font-size:22px">${said.trim() || "\u2026"}</text>`;
  el.innerHTML = g;
}

// The boards that float in the pane: the five conditions on the beat that
// names the puzzle, the one solution on the beat that solves it, and the five
// runs on the close. Built from the same patch map the figures use.
const PALE = "var(--grey-1)", LIT = "var(--grey-3)";
const codes = patchCodes();
const boardOf = rows => new Set(rows.flatMap(([p, q], r) => [r * 11 + p, r * 11 + q]));
const patchFill = k => (codes ? theme.region[codes[k] % theme.region.length] : PALE);

const home = codes ? codes[5 * 11 + 5] : null;
const mine = codes ? codes.map((c, k) => [c, k]).filter(([c]) => c === home).map(([, k]) => k) : [];
const apart = (a, b) => Math.abs(a % 11 - b % 11) > 1 || Math.abs((a / 11 | 0) - (b / 11 | 0)) > 1;
const pair = [];
for (const a of mine) { for (const b of mine) if (a < b && apart(a, b)) { pair.push(a, b); break; } if (pair.length) break; }
const mid = 5 * 11 + 5, ring = [];
for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) ring.push(mid + dy * 11 + dx);

const cards = new Cards(document.getElementById("cards"), {
  // the five conditions: bigger than the rest and grouped in close, so they
  // read as one statement made five times rather than five separate pictures
  rules: [
    { cap: "two per row", at: [0.35, 0.27], k: 1.25, cells: k => (k / 11 | 0) === 4 ? LIT : PALE, stars: [4 * 11 + 2, 4 * 11 + 8] },
    { cap: "two per column", at: [0.65, 0.25], k: 1.25, cells: k => k % 11 === 6 ? LIT : PALE, stars: [1 * 11 + 6, 8 * 11 + 6] },
    { cap: "two per region", at: [0.5, 0.5], k: 1.25, starFill: "var(--pane)", stars: pair,
      cells: k => codes && codes[k] === home ? patchFill(k) : PALE },
    { cap: "none touching", at: [0.35, 0.73], k: 1.25, cells: k => ring.includes(k) ? LIT : PALE, stars: [mid], cross: ring },
    { cap: "22 in all", at: [0.65, 0.75], k: 1.25, cells: () => PALE, stars: [], count: "22" },
  ],
  // the one board that satisfies all five, on the patches it was checked
  // against, as a single card the size of the pane
  solution: [
    { at: [0.5, 0.48], k: 2.4, cells: patchFill, stars: [...boardOf(SOLUTION)], starFill: "var(--pane)", msg: "(* TWO STARS *)" },
  ],
  // what the chip said to five different inputs. The boards are the inputs,
  // the line under each is what came back on O.
  answers: ANSWERS.map((a, i) => {
    const on = a.stars === "all" ? new Set(Array.from({ length: 121 }, (_, k) => k))
      : a.stars === "solution" ? boardOf(SOLUTION)
      : a.stars === "touching" ? boardOf(TOUCHING)
      : new Set(a.stars);
    const at = [[0.29, 0.24], [0.71, 0.21], [0.5, 0.5], [0.28, 0.77], [0.72, 0.75]][i] || [0.5, 0.5];
    return { at, k: 1, w: 156, msg: a.text, cells: k => on.has(k) ? "var(--accent)" : PALE };
  }),
});

const marksMade = [];

// ---- the pane ---------------------------------------------------------------
const engine = new Engine({
  subjects, beats, canvas, renderer, scene, camera,
  tags, arrows, symbols, frames, outlines, wires, flow, cards, sketch, sim, waveforms,
  panels: new Panels(document.getElementById("pane")),
  sidebar: new Sidebar(document.getElementById("sidebar")),
});
for (const spec of marks) {
  const mk = new Marks(data.placements, subjects.dienet, spec);
  marksMade.push(mk); engine.register(spec, mk);
}

// ---- the scheme picker ------------------------------------------------------
if (picker) picker.onchange = () => {
  const v = picker.value;
  if (v === "oslo") delete document.documentElement.dataset.scheme;
  else document.documentElement.dataset.scheme = v;
  try { localStorage.setItem("scheme", v); } catch (e) {}
  reloadTheme(); retheme();
  renderer.setClearColor(new THREE.Color(theme.pane));
  sim.colour = theme.live; engine.highCache.clear();
  for (const mk of marksMade) mk.recolour();
  for (const w of waveforms) if (w.draw) w.draw();
};

// the overlays are clipped to the pane; tell the stylesheet where it starts
const paneLeft = () => document.documentElement.style.setProperty(
  "--pane-left", document.getElementById("pane").getBoundingClientRect().left + "px");
paneLeft(); addEventListener("resize", paneLeft);

drawSymbolKey("symbol-key");
drawNetFigure(nets, "dff-fig");   // not "symbols": that id is the overlay host over the pane
drawGridFigure("grid-cols", k => k % 11);           // the column counter's value at each bit
drawGridFigure("grid-rows", k => Math.floor(k / 11));  // the row counter's
drawPatchFigure("grid-patches");                         // the patch map's, read off the run
drawStatesFigure("checker-states");
drawWindowFigure("window-grid");
drawTimingFigure("dff-timing");
drawCrossSection(data.stack, "xsec");
drawCrossSection(data.stack, "xsec2", { rules: true });
engine.start();

// The handle tooling reaches in through: the dev panel, and the still-capture
// script that renders a beat at a fixed size without needing a visible window.
window.story = { engine, subjects, data, nets, sim, tags, arrows, symbols, frames, wires, sketch, renderer, scene, camera, canvas, acts: { one, two, three } };

// ---- hover on a cell's layers ----------------------------------------------
/* On the beats that ask for it (`hover`), the pointer over the pane names the
   layer under it, with a line on what that layer is physically. A ray from
   the camera through the pointer against the subject's own meshes, one per
   layer; the first hit is the layer. Nothing about the picture changes. */
const LAYER_LINE = {
  nwell: "n-well: a pocket of n-type silicon, the ground the pMOS transistors are built in",
  diff: "diffusion: doped silicon; the source and drain of every transistor",
  poly: "polysilicon: the gate; where it crosses diffusion it switches the channel beneath",
  licon1: "contact: a plug up from diffusion or poly to the local wiring",
  li1: "local interconnect: the wiring inside a cell, joining its transistors",
  mcon: "cut: a plug from the local wiring up to met1",
  met1: "met1: the first routing metal, mostly short runs within a row",
  via: "cut: met1 up to met2",
  met2: "met2: routing metal, vertical runs across rows",
  via2: "cut: met2 up to met3",
  met3: "met3: routing metal, the long horizontal runs",
  via3: "cut: met3 up to met4",
  met4: "met4: routing metal, the power straps and a few long signals",
  via4: "cut: met4 up to met5",
  met5: "met5: the top metal, power distribution",
};
{
  const tip = document.createElement("div");
  tip.className = "tag hover"; tip.style.display = "none";
  document.getElementById("tags").appendChild(tip);
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  canvas.addEventListener("mousemove", e => {
    const b = engine.beats[Math.min(Math.floor(engine.position()), engine.beats.length - 1)];
    const sub = b && b.hover && subjects[b.subj];
    if (!sub) { tip.style.display = "none"; return; }
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const meshes = sub.groups.filter(g => g.visible && !g.userData.empty).map(g => g.children[0]);
    const hit = ray.intersectObjects(meshes, false)[0];
    if (!hit) { tip.style.display = "none"; return; }
    const name = hit.object.parent.name;
    tip.textContent = LAYER_LINE[name] || name;
    tip.style.left = (e.clientX + 14) + "px"; tip.style.top = (e.clientY + 14) + "px";
    tip.style.display = "";
  });
  canvas.addEventListener("mouseleave", () => { tip.style.display = "none"; });
}

// ?beat=<id> holds the pane on that beat, whatever the scroll position: a
// deep link for checking one frame, from a browser or a headless screenshot.
{
  const want = new URLSearchParams(location.search).get("beat");
  const k = want ? engine.beats.findIndex(b => b.id === want) : -1;
  if (k >= 0) engine.lock = k;
}

// the tuning panel: ?dev in the URL, or the backtick key
const dev = new DevPanel(engine, document.body);
dev.authored = authored;               // what reset goes back to
if (new URLSearchParams(location.search).has("dev")) dev.toggle(true);
window.story.dev = dev;

// edit mode: the prose and the show-comments in boxes, saved through serve.py
const editor = new Editor();
if (new URLSearchParams(location.search).has("edit")) editor.toggle(true);
dev.onEdit = on => editor.toggle(on);
window.story.editor = editor;

// ---- the inline cross-section, drawn from the stack file --------------------
/* One net, drawn as the netlist keeps it.

   The paragraph beside this figure says a netlist is a hypergraph: one wire
   touching many pins, held in that form rather than flattened to gate-to-gate
   edges so nothing about WHICH pin a connection landed on is lost. This is that
   sentence as a picture, and it is taken from the traced data rather than drawn
   by hand -- the net chosen is a real one, and the pin names on it are the pin
   names the tracer recovered.

   The choice is deterministic: among the nets with four readers, the one whose
   readers land on the most different pins, because that is the case the
   flattened form would destroy. */
function drawNetFigure(nets, id) {
  const fig = document.getElementById(id);
  if (!fig) return;
  const OUT = new Set(["X", "Y", "Q", "Q_N"]), POWER = new Set(["VPWR", "VGND", "VPB", "VNB"]);
  const drv = new Map(), rd = new Map();
  for (const i of nets.instances) for (const [p, n] of Object.entries(i.pins)) {
    if (POWER.has(p)) continue;
    if (OUT.has(p)) drv.set(n, { ...i, pin: p });
    else { if (!rd.has(n)) rd.set(n, []); rd.get(n).push({ ...i, pin: p }); }
  }
  const spread = n => new Set(rd.get(n).map(r => r.pin)).size + new Set(rd.get(n).map(r => r.cell)).size;
  const net = [...drv.keys()].filter(n => (rd.get(n) || []).length === 4)
    .sort((a, b) => spread(b) - spread(a) || a - b)[0];
  if (net === undefined) return;
  const from = drv.get(net), to = rd.get(net);

  const W = 560, RH = 46, pad = 14;
  const H = to.length * RH + pad * 2;
  const name = c => c.replace(/_\d+$/, "");
  const SPINE = 150, IN = 330, SYM = 348;
  const ys = to.map((_, k) => pad + RH * k + RH / 2);
  const my = pad + (H - pad * 2) / 2;
  let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
  // the wire: one object, whatever it touches
  // from the driver's nose to the spine, and from the spine into each reader
  s += `<path class="nw" d="M56 ${my} H${SPINE} M${SPINE} ${ys[0]} V${ys[ys.length - 1]}` +
       ys.map(y => ` M${SPINE} ${y} H${SYM}`).join("") + `"/>`;
  for (const y of ys) s += `<circle class="nj" cx="${SPINE}" cy="${y}" r="3"/>`;
  // the driver
  s += `<g class="sym" transform="translate(14 ${my - 12})">${symbolMarkup(from.cell)}</g>`;
  s += `<text class="nl" x="34" y="${my + 30}" text-anchor="middle">${name(from.cell)}</text>`;
  s += `<text class="np" x="92" y="${my - 6}" text-anchor="end">${from.pin}</text>`;
  s += `<text class="nn" x="${SPINE + 6}" y="${pad + 2}">net ${net}</text>`;
  // the readers, each with the pin the wire actually lands on
  to.forEach((r, k) => {
    s += `<g class="sym" transform="translate(${SYM} ${ys[k] - 12})">${symbolMarkup(r.cell)}</g>`;
    s += `<text class="np" x="${IN - 4}" y="${ys[k] - 6}" text-anchor="end">${r.pin}</text>`;
    s += `<text class="nl" x="${SYM + 48}" y="${ys[k] + 5}">${name(r.cell)}</text>`;
  });
  fig.insertAdjacentHTML("afterbegin", s + "</svg>");
}

/* The few symbols the rest of the piece leans on, as a figure in the prose.

   Six, not sixty-nine and not eleven: the panel beside the beat draws every
   type in the design, so this one is not an index. It is the reading key, and
   a reading key with eleven near-identical rows teaches less than one with six
   that say why the shapes differ.

   The descriptions wrap, so they can be sentences rather than captions. Width
   is measured in monospace advances, which is exact for this face. */
function drawSymbolKey(id) {
  const fig = document.getElementById(id);
  if (!fig) return;
  // six symbols in three columns and two rows, each with its name and nothing else
  const cells = [["inv_2", "inverter"], ["and2_2", "AND"], ["or2_2", "OR"],
                 ["xor2_2", "XOR"], ["a21oi_2", "AND-OR-invert"], ["dfrtp_2", "flip-flop"]];
  // the middle column is wider, for AND-OR-invert
  const W = 560, COLS = 3, XS = [12, 180, 405], RH = 74;
  let body = "";
  cells.forEach(([cell, name], k) => {
    const x = XS[k % COLS], y = Math.floor(k / COLS) * RH + 10;
    body += `<g class="sym" transform="translate(${x} ${y + 6})">${symbolMarkup(cell)}</g>`;
    body += `<text class="kn" x="${x + 54}" y="${y + 24}">${name}</text>`;
  });
  fig.insertAdjacentHTML("afterbegin", `<svg viewBox="0 0 ${W} ${2 * RH + 8}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`);
}

function drawCrossSection(stack, id, { rules = false } = {}) {
  const fig = document.getElementById(id);
  if (!fig) return;
  const mono = 'font-family="ui-monospace,Menlo,monospace"';
  const top = Math.max(...stack.map(e => e.z0 + e.t));
  const W = 620, H = 420, pad = 16;
  const CH = 9;                                  // one monospace advance at 15px
  // left gutter: the widest label that goes there, plus its leader
  const LEFT = Math.max(...["connected metal", "a via joins layers", "transistor"]
                          .map(t => t.length)) * CH + 8;
  // right gutter: tick, swatch, then the widest "name . gds" pair
  const RIGHT = 28 + Math.max(...stack.map(e => `${e.name} \u00b7 ${e.gds[0]}/${e.gds[1]}`.length)) * CH;
  const x0 = pad + LEFT, x1 = W - pad - RIGHT;
  const sy = z => H - 34 - (z / top) * (H - 34 - pad);
  const at = n => stack.findIndex(e => e.name === n);
  const lay = n => stack[at(n)];
  const band = n => [sy(lay(n).z0 + lay(n).t), sy(lay(n).z0)];
  const col = n => `var(--layer-${at(n)})`;
  let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;

  // the dielectric everything is buried in, and the substrate under it
  s += `<rect x="${x0}" y="${sy(top)}" width="${x1 - x0}" height="${sy(0) - sy(top)}"
         fill="var(--pane)" stroke="var(--grey-2)"/>`;
  s += `<rect x="${x0}" y="${sy(0)}" width="${x1 - x0}" height="24" fill="var(--substrate)" opacity=".5"
         stroke="var(--grey-2)"/>`;
  s += `<text x="${x0 + 6}" y="${sy(0) + 17}" ${mono} font-size="15" fill="var(--ink-2)">p substrate</text>`;

  // A wire climbing the stack, which is what the drawing is for: a contact off
  // the transistor, then metal, cut, metal, cut, all the way up. Each metal is
  // drawn as a bar and each cut as the stud between two of them.
  const chain = ["li1", "met1", "met2", "met3", "met4", "met5"];
  const cuts = { met1: "mcon", met2: "via", met3: "via2", met4: "via3", met5: "via4" };
  // fractions of the column, so the column is free to move
  const sx = t => x0 + t * (x1 - x0);
  const runs = { li1: [0.10, 0.49], met1: [0.13, 0.77], met2: [0.03, 0.66], met3: [0.20, 0.91],
                 met4: [0.00, 0.80], met5: [0.06, 0.87] };
  const studs = { met1: 0.31, met2: 0.52, met3: 0.27, met4: 0.66, met5: 0.35 };
  const gate = sx(0.225);

  /* Transistor level: the body, two diffusions, the poly gate, and the channel
     between them.

     The gap between the two diffusions is not empty. It is the same body the
     well is made of, and it is the only place on this drawing where a channel
     can form -- the gate reaches it through the oxide and nothing touches it
     directly. It used to be drawn as background, which said the opposite.

     A stronger patch of body runs under the gate and down through the well
     band. The diffusions are drawn over it, so it shows in two places: the gap
     itself, and a strip below wide enough to carry a label in the ground
     colour. At the wash's own .35 that label would sit at 2.4:1; on the patch
     it is about 5:1. */
  // The well is drawn as a band of its own under the diffusion, down into the
  // substrate, instead of at the stack's height for it, which coincides with
  // the diffusion's and left the two on top of each other (comment 67).
  const [dy1, dy0] = band("diff");
  const wy1 = dy0 + 5, wy0 = sy(0) + 7;
  const [py1, py0] = band("poly");
  const CHW = 8;                                   // half the gate's channel width
  s += `<rect x="${x0 + 8}" y="${wy1}" width="${x1 - x0 - 16}" height="${wy0 - wy1}" fill="${col("nwell")}" opacity=".35"/>`;
  s += `<rect x="${gate - 28}" y="${dy1}" width="56" height="${wy0 - dy1}" fill="${col("nwell")}" opacity=".6"/>`;
  for (const [a, b] of [[sx(0.06), gate - CHW], [gate + CHW, sx(0.42)]])
    s += `<rect x="${a}" y="${dy1}" width="${b - a}" height="${dy0 - dy1}" fill="${col("diff")}" stroke="var(--ink-3d)" stroke-width=".7"/>`;
  s += `<rect x="${gate - 9}" y="${py1}" width="18" height="${py0 - py1}" fill="${col("poly")}" stroke="var(--ink-3d)" stroke-width=".7"/>`;
  // the channel: carriers gathered under the oxide, in the body, between the two
  for (let k = 0; k < 5; k++)
    s += `<circle cx="${gate - CHW + 2.2 + k * 2.9}" cy="${dy1 + 3}" r="1.15" fill="var(--cream)"/>`;
  s += `<text x="${gate}" y="${(dy1 + dy0) / 2 + 4}" ${mono} font-size="11" fill="var(--ink)"
         text-anchor="middle" letter-spacing=".04em">channel</text>`;

  /* A contact runs from li1 down to whatever it lands on, and that is not the
     same height for all three: the two either side of the gate land on the
     source and drain diffusion, the middle one lands on the poly. Drawn at the
     licon plate's own height -- which is what the stack file gives, because
     that height is for the exploded 3D view where every layer is its own plate
     -- the outer two stopped level with the top of the poly and floated over
     the diffusion they are supposed to be touching. */
  const [ly1] = band("licon1");
  for (const [cx, floor] of [[sx(0.13), dy1], [sx(0.35), dy1], [gate, py1]])
    s += `<rect x="${cx - 4}" y="${ly1}" width="8" height="${floor - ly1}" fill="${col("licon1")}" stroke="var(--ink-3d)" stroke-width=".6"/>`;

  // the conductors and the cuts that join them
  for (const n of chain) {
    const [y1, y0] = band(n), [a, b] = runs[n].map(sx);
    s += `<rect x="${a}" y="${y1}" width="${b - a}" height="${y0 - y1}" fill="${col(n)}" stroke="var(--ink-3d)" stroke-width=".7"/>`;
    const cut = cuts[n];
    if (cut) {
      /* A cut is an array, not a plug. One stud says "a connection"; the design
         has 4.6 mcon per met1 shape, and seventy via3 for every met4 shape,
         because a wide conductor is stitched to the one below it by a bed of
         them. Three is the smallest number that reads as plural. */
      const [cy1, cy0] = band(cut), cx = sx(studs[n]);
      for (let k = -1; k <= 1; k++)
        s += `<rect x="${cx + k * 7 - 3}" y="${cy1}" width="6" height="${cy0 - cy1}" fill="${col(cut)}" stroke="var(--ink-3d)" stroke-width=".6"/>`;
    }
  }

  // names on the right, each against the layer it belongs to
  for (const e of stack) {
    const [y1, y0] = band(e.name), y = (y0 + y1) / 2;
    s += `<line x1="${x1 + 2}" y1="${y}" x2="${x1 + 14}" y2="${y}" stroke="var(--grey-2)"/>`;
    s += `<rect x="${x1 + 16}" y="${y - 5}" width="7" height="10" fill="${col(e.name)}" stroke="var(--ink-3d)" stroke-width=".5"/>`;
    s += `<text x="${x1 + 28}" y="${y + 3}" ${mono} font-size="15" fill="var(--ink-2)">${e.name} &#183; ${e.gds[0]}/${e.gds[1]}</text>`;
  }

  const lhs = (n, t, fill) => `<text x="${x0 - 8}" y="${(band(n)[0] + band(n)[1]) / 2 + 3}" ${mono}
         font-size="15" fill="${fill}" text-anchor="end">${t}</text>`;
  s += lhs("diff", "transistor", "var(--ink-2)");
  // the two rules: a conclusion, so only on the appearance that has earned it
  if (rules) {
    s += lhs("met2", "connected metal", "var(--ink-2)");
    s += lhs("via", "a via joins layers", "var(--accent)");
  }
  s += "</svg>";
  fig.insertAdjacentHTML("afterbegin", s);
}

/* The 121 input bits as an 11 by 11 grid, each cell coloured by which of a
   counter's eleven values it arrives under. The bits fill the grid one row at
   a time, so the counter that steps every tick paints columns and the one
   that steps once a round paints rows. The colours are the region ramp: one
   per value, and nothing about their order matters. */
function drawGridFigure(id, valueOf) {
  const fig = document.getElementById(id);
  if (!fig) return;
  // compact cells, centred in the column: the grid is a glance, not a map
  const N = 11, P = 30, C = 26, W = 560, G = N * P - (P - C), M = (W - G) / 2, H = G + 12;
  let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
  for (let k = 0; k < N * N; k++) {
    const x = M + (k % N) * P, y = 6 + Math.floor(k / N) * P;
    s += `<rect x="${x}" y="${y}" width="${C}" height="${C}" rx="2" fill="${theme.region[valueOf(k) % theme.region.length]}"/>`;
  }
  fig.insertAdjacentHTML("afterbegin", s + "</svg>");
}

/* The patch map, read off the run: the four wires leaving the decode box,
   sampled on the cycle each input bit is being counted, one code per cell.
   The code trails the bit by one tick, hence the -1. Eleven codes come out,
   and the cells that share one make a patch. The order codes first appear in
   sets the colours, which is arbitrary and does not matter. */
function drawPatchFigure(id) {
  const fig = document.getElementById(id);
  if (!fig) return;
  const codes = patchCodes();
  if (codes) drawGridFigure(id, k => codes[k]);
}

/* The 121 patch codes the run gives up, or null if the wires are not there.
   Shared by the patch figure and the rules figure, which colours one patch. */
function patchCodes() {
  const wires = three.boxes.R4.outs.map(o => o.net).filter(n => sim.bits[String(n)]);
  if (wires.length !== 4) return null;
  const at = (n, c) => (sim.bits[String(n)][c >> 3] >> (c & 7)) & 1;
  const start = sim.inputs.findIndex(f => f.enable === 1);
  const seen = new Map();
  return Array.from({ length: 121 }, (_, k) => {
    const code = wires.map(n => at(n, start + k - 1)).join("");
    if (!seen.has(code)) seen.set(code, seen.size);
    return seen.get(code);
  });
}

/** A five-pointed star, for the boards that carry them. */
function starPath(cx, cy, r) {
  let d = "";
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, k = i % 2 ? r * 0.42 : r;
    d += (i ? "L" : "M") + (cx + k * Math.cos(a)).toFixed(2) + " " + (cy + k * Math.sin(a)).toFixed(2);
  }
  return d + "z";
}

/* One checker as its four states: a one moves it on, a zero leaves it where
   it is, at three it stops, and only two says yes. */
function drawStatesFigure(id) {
  const fig = document.getElementById(id);
  if (!fig) return;
  const W = 560, H = 210, y = 104, r = 28, xs = [70, 210, 350, 490];
  let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><marker id="stArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto">` +
    `<path d="M0 0L10 5L0 10z" fill="var(--ink)"/></marker></defs>`;
  const arrow = d => `<path d="${d}" fill="none" stroke="var(--ink)" stroke-width="1.4" marker-end="url(#stArrow)"/>`;
  for (let i = 0; i < 3; i++) {
    s += arrow(`M${xs[i] + r + 2} ${y} H${xs[i + 1] - r - 3}`);
    s += `<text class="fx" x="${(xs[i] + xs[i + 1]) / 2}" y="${y - 12}" text-anchor="middle">a one</text>`;
  }
  // three stays three: a loop back onto the last state
  s += arrow(`M${xs[3] + 10} ${y - r + 2} C${xs[3] + 40} ${y - r - 42}, ${xs[3] - 40} ${y - r - 42}, ${xs[3] - 8} ${y - r - 2}`);
  s += `<text class="fx" x="${xs[3]}" y="${y - r - 40}" text-anchor="middle">a one</text>`;
  ["00", "01", "10", "11"].forEach((t, i) => {
    const yes = t === "10";
    s += `<circle cx="${xs[i]}" cy="${y}" r="${r}" fill="${yes ? "var(--accent)" : "var(--cream)"}" stroke="var(--ink)" stroke-width="1.6"/>`;
    s += `<text class="fx" x="${xs[i]}" y="${y + 5}" text-anchor="middle" fill="${yes ? "var(--cream)" : "var(--ink)"}">${t}</text>`;
  });
  s += `<text class="fx" x="${xs[2]}" y="${y + r + 24}" text-anchor="middle">says yes</text>`;
  s += `<text class="fx" x="${xs[0]}" y="${y + r + 24}" text-anchor="middle">after reset</text>`;
  s += `<text class="fx" x="${W / 2}" y="${H - 8}" text-anchor="middle">a zero changes nothing, in any state</text>`;
  fig.insertAdjacentHTML("afterbegin", s + "</svg>");
}

/* The window the neighbour check holds, on the grid: the bit arriving, the
   twelve before it, and the four of those it compares against. One row
   plus one back is exactly far enough to reach the cell above-left. */
function drawWindowFigure(id) {
  const fig = document.getElementById(id);
  if (!fig) return;
  const N = 11, P = 30, C = 26, M = 6, G = N * P - (P - C) + 2 * M, W = 560, H = G;
  const k0 = 5 * N + 5;                              // an arriving cell in the middle of the board
  const near = new Set([k0 - 1, k0 - N + 1, k0 - N, k0 - N - 1]);
  let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
  for (let k = 0; k < N * N; k++) {
    const x = M + (k % N) * P, y = M + Math.floor(k / N) * P;
    const fill = k === k0 ? "var(--accent)" : near.has(k) ? "var(--ink-2)" : (k >= k0 - 12 && k < k0) ? "var(--grey-1)" : "var(--cream)";
    s += `<rect x="${x}" y="${y}" width="${C}" height="${C}" rx="2" fill="${fill}" stroke="var(--grey-2)" stroke-width="1"/>`;
  }
  // the legend beside the grid, one line each, at the body's size
  const legend = [["var(--accent)", "arriving"], ["var(--grey-1)", "last twelve"], ["var(--ink-2)", "four it checks"]];
  const lx = G + 24, ly0 = H / 2 - 40;
  legend.forEach(([c, t], i) => {
    const y = ly0 + i * 40;
    s += `<rect x="${lx}" y="${y - 10}" width="20" height="20" rx="2" fill="${c}" stroke="var(--grey-2)" stroke-width="1"/>`;
    s += `<text class="fx" x="${lx + 30}" y="${y + 6}">${t}</text>`;
  });
  fig.insertAdjacentHTML("afterbegin", s + "</svg>");
}

/* A flip-flop's timing: the clock, a data line that changes when it likes,
   and the stored bit, which takes the data's value only on a rising edge and
   holds it until the next. Drawn by hand from a short script so the point is
   visible: D changes twice between two edges and Q ignores both. */
function drawTimingFigure(id) {
  const fig = document.getElementById(id);
  if (!fig) return;
  const W = 560, H = 210, x0 = 70, x1 = 540, T = 60;          // one clock period in px
  const clk = t => (Math.floor(t / (T / 2)) % 2 === 0 ? 1 : 0);
  const dAt = [[0, 0], [45, 1], [130, 0], [150, 1], [175, 0], [290, 1], [400, 0]];   // [px, value]
  const d = t => { let v = 0; for (const [x, val] of dAt) if (t >= x) v = val; return v; };
  const lane = (y, name, fn, cls) => {
    let path = "", prev = null;
    for (let t = 0; t <= x1 - x0; t += 1) {
      const v = fn(t), yy = y + 18 - v * 26;
      path += prev === null ? `M${x0} ${yy}` : (v !== prev ? `L${x0 + t} ${y + 18 - prev * 26} L${x0 + t} ${yy}` : "");
      prev = v;
    }
    path += `L${x1} ${y + 18 - prev * 26}`;
    return `<text class="fx" x="${x0 - 14}" y="${y + 12}" text-anchor="end">${name}</text>` +
           `<path class="${cls}" d="${path}"/>`;
  };
  // Q: sampled at each rising edge of the clock
  const q = t => { let v = 0; for (let e = 0; e <= t; e += T) if (e > 0 && e <= t) v = d(e); return v; };
  let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
  for (let e = T; e < x1 - x0; e += T)
    s += `<line x1="${x0 + e}" y1="14" x2="${x0 + e}" y2="${H - 22}" stroke="var(--accent)" stroke-width="1" stroke-dasharray="3 4" opacity=".7"/>`;
  s += lane(20, "CLK", clk, "tl");
  s += lane(80, "D", d, "tl");
  s += lane(140, "Q", q, "tl tq");
  s += `<text class="fx" x="${x1}" y="${H - 6}" text-anchor="end">rising edges marked</text>`;
  fig.insertAdjacentHTML("afterbegin", s + "</svg>");
}

/* A cell's layout with a drawing over it, as a figure in the prose: the
   layers that make the transistors and the local wiring in the process's
   colours, and the schematic laid over them at the places the devices sit,
   the same markup the pane used to draw. */
function drawCellFigure(id, cell, markup) {
  const fig = document.getElementById(id);
  if (!fig || !cell) return;
  const [x0, y0, x1, y1] = cell.bbox, W = 560, sc = W / (x1 - x0 + 0.4), H = Math.round((y1 - y0 + 0.4) * sc);
  // the layout faint, in the scheme's colours, so the circuit drawn over it is what reads
  const SHOW = { nwell: 0.12, diff: 0.3, poly: 0.32, licon1: 0.3, li1: 0.22, mcon: 0.25 };
  let polys = "";
  for (const L of cell.layers) {
    if (!(L.name in SHOW)) continue;
    const colour = theme.oslo[data.stack.findIndex(e => e.name === L.name)] || theme.ink;
    let i = 0;
    for (const ring of L.r.flat()) {
      const pts = [];
      for (let k = 0; k < ring; k++) { pts.push((L.v[i] / 1000).toFixed(3) + "," + (L.v[i + 1] / 1000).toFixed(3)); i += 2; }
      polys += `<polygon points="${pts.join(" ")}" fill="${colour}" fill-opacity="${SHOW[L.name]}" stroke="${theme.ink}" stroke-opacity=".25" stroke-width="0.6" vector-effect="non-scaling-stroke"/>`;
    }
  }
  // the figure stylesheet sizes text at 15px, which inside a group scaled
  // eighty-fold is a wall per letter: the labels keep their own sizes inline
  const sized = markup.replace(/font-size="([\d.]+)"/g, 'style="font-size:$1px"');
  fig.insertAdjacentHTML("afterbegin", `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">` +
    `<g transform="translate(${((0.2 - x0) * sc).toFixed(2)} ${(H - (0.2 - y0) * sc).toFixed(2)}) scale(${sc.toFixed(4)} ${(-sc).toFixed(4)})">` +
    polys + `<g class="sketch">${sized}</g></g></svg>`);
}
