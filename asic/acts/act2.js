/* Act II, beat by beat. The reader has meaning at the cell level; by the end
   they have a netlist that simulates and a way to know it is right. The
   subject throughout is `dienet`, the die exported with its nets, so a polygon
   can be lit by the wire it belongs to. The camera stays overhead.

   The final beat holds the testbench and input grid beside the comparison
   with the supplied recording. */

import { AZ } from "../src/engine.js";
import { logo, ABOVE_MET3 } from "./common.js";
import { theme } from "../src/theme.js";

const TOP = { az: AZ, elev: Math.PI / 2, ortho: 1, fov: 12 };
const NET = "dienet";

// the cell's own layers, which fade when the cell becomes a symbol
const INSIDE = { nwell: 0.12, diff: 0.12, poly: 0.12, licon1: 0.12 };
const CELLS_OUT = { nwell: 0, diff: 0, poly: 0, licon1: 0, li1: 0.12, mcon: 0.3, ...ABOVE_MET3 };
// the routing above a cell, which in plan view otherwise sits on top of it
const ROUTING_BACK = { mcon: 0.3, met1: 0.15, via: 0.1, met2: 0.15, via2: 0.1, met3: 0.15,
                       ...ABOVE_MET3 };
// Once the act has zoomed in the first time, the long bars near the top of
// the stack are gone for good: they cross the whole die and hide everything
// the rest of the act is about.
const NO_BARS = { ...ABOVE_MET3, met3: 0, via2: 0.08 };   // this act drops met3 as well
// every layer off: the die gone, for the beat where the netlist stands alone
const GONE = { nwell: 0, diff: 0, poly: 0, licon1: 0, li1: 0, mcon: 0, met1: 0, via: 0, met2: 0, via2: 0,
               met3: 0, via3: 0, met4: 0, via4: 0, met5: 0 };
// the run: cells gone, the wires left as a grey ground for the ones that are
// lit. No symbols here: sixteen hundred of them at die scale bury the wires.
const RUNNING = { nwell: 0, diff: 0, poly: 0, licon1: 0, li1: 0.35, mcon: 0.5,
                  met3: 0.55, ...ABOVE_MET3 };   // signal routing forward, the straps stay out

export function act2(nets, sim) {
  const I = nets.instances;
  const [bx0, by0, bx1, by1] = nets.die.bbox, DW = bx1 - bx0, DH = by1 - by0;
  // the middle of where the cells are, not of the die's box (see act1)
  const ex = [Math.min(...I.map(i => i.b[0])), Math.min(...I.map(i => i.b[1])),
              Math.max(...I.map(i => i.b[2])), Math.max(...I.map(i => i.b[3]))];
  const mid = [(ex[0] + ex[2]) / 2, (ex[1] + ex[3]) / 2];

  // the same XOR Act I examined: the one nearest the middle of the die
  const xors = I.filter(i => i.cell === "xor2_2");
  const bench = xors.reduce((a, b) =>
    Math.hypot(a.x - mid[0], a.y - mid[1]) < Math.hypot(b.x - mid[0], b.y - mid[1]) ? a : b);
  const at = (inst, size) => [(inst.x - bx0) / DW, (inst.y - by0) / DH, size];

  // who drives A: the instance whose output pin is on A's net
  const OUT = new Set(["X", "Y", "Q", "Q_N"]);
  const driverOf = net => I.find(i => Object.entries(i.pins).some(([p, n]) => OUT.has(p) && n === net));
  const drvA = driverOf(bench.pins.A);
  const between = drvA ? [(bench.x + drvA.x) / 2, (bench.y + drvA.y) / 2] : [bench.x, bench.y];
  const span = drvA ? Math.max(Math.abs(bench.x - drvA.x), Math.abs(bench.y - drvA.y)) : 8;
  const pair = [(between[0] - bx0) / DW, (between[1] - by0) / DH, Math.min(1, (span + 14) / DW)];

  const pinNets = pins => Object.fromEntries(pins.map(p => [bench.pins[p], theme.tint[p]]));
  const isBuf = i => /^(buf|clkbuf|bufbuf)/.test(i.cell);
  // the marks spec for the buffer beat: the buffer cell types as one family,
  // so all four of them light in one colour
  const bufTypes = [...new Set(I.filter(isBuf).map(i => i.cell))].sort().join("|");

  // where the run's phases are, read off the trace rather than typed in
  // The recording holds two attempts back to back; the act follows the first.
  const inp = sim.inputs, N = sim.cycles;
  const resetEnd = inp.findIndex(f => f.rst_n === 1);
  const feedStart = inp.findIndex(f => f.enable === 1);
  const after = inp.findIndex((f, i) => i > feedStart && f.enable === 0);
  const feedEnd = (after < 0 ? N : after) - 1;
  const firstText = inp.findIndex((f, i) => i > feedEnd && f.O >= 32 && f.O < 127);
  const readoutEnd = inp.findIndex((f, i) => i > firstText && f.enable === 1);
  const last = readoutEnd < 0 ? N - 1 : readoutEnd - 1;
  const stages = { resetEnd, feedStart, feedEnd, firstText, last };

  const beats = [
    { id: "a2", lines: 0.1, spot: logo(), subj: NET, ...TOP, layers: { ...ABOVE_MET3 }, pill: "part ii" },

    // every cell in frame gets its box drawn, so it reads from above that the
    // patch is several components and not one texture
    { id: "a2-abstract", subj: NET, ...TOP, focus: at(bench, 0.05),
      layers: { ...INSIDE, ...ROUTING_BACK, li1: 0.3 }, outlines: "all", pill: "beat 12" },

    { id: "a2-pins", subj: NET, ...TOP, focus: at(bench, 0.045),
      layers: { nwell: 0.05, diff: 0.05, poly: 0.05, licon1: 0.05, ...ROUTING_BACK, mcon: 0.5, met1: 0.4, ...NO_BARS },
      nets: pinNets(["A", "B", "X", "VPWR", "VGND"]), dim: 0.88, pill: "beat 13" },

    { id: "a2-conductors", subj: NET, ...TOP, focus: at(bench, 0.16),
      layers: { nwell: 0.05, diff: 0.05, poly: 0.05, licon1: 0.05, li1: 0.7, ...NO_BARS },
      nets: pinNets(["A", "B", "X"]), dim: 0.82, pill: "beat 14" },

    // Tracing is the whole point here, so the result of tracing is what is
    // drawn: every distinct wire in frame in its own colour, not just the one
    // the previous beats followed. No symbols yet -- a gate shape floating
    // over the layout before they are introduced was read as a stray.
    { id: "a2-trace", subj: NET, ...TOP, focus: pair,
      layers: { ...CELLS_OUT, li1: 0.55, met1: 0.7, via: 0.5, met2: 0.7, ...NO_BARS },
      nets: "all", lines: 0.2, pill: "beat 15" },

    // The die goes and the netlist stands on its own: a dot per gate, a line
    // per wire, inputs at the left and outputs at the right, each gate at its
    // level in the flow. The dots slide there from where the cells sit.
    { id: "a2-netlist", spot: logo(), subj: NET, ...TOP, layers: GONE, flow: 1, morph: 1, pill: "beat 17" },

    // The thirty-three buffers picked out on the die the way the cell types
    // were at the end of Act I: a flat mark per placement, in the accent, over
    // the layout. No inset -- the point is where they are and how few, and a
    // box in the corner drew the eye off the die.
    // Act I's cell-type beat covers the die in 1618 marks, so the routing
    // under them does not matter. Thirty-three do not cover anything, so the
    // die is turned down first -- the layers halfway and the polygon outlines
    // nearly off -- and the marks are the only saturated thing on it.
    { id: "a2-buffers", spot: logo(), subj: NET, ...TOP,
      layers: { ...INSIDE, li1: 0.3, mcon: 0.28, met1: 0.3, via: 0.2, met2: 0.3, via2: 0.2, ...NO_BARS },
      lines: 0.08, marks: bufTypes, pill: "beat 18" },

    // The merged testing section holds the testbench and input grid still.
    { id: "a2-testing", subj: NET, ...TOP, layers: RUNNING, sim: true, cycle: feedStart, focus: [0.4, 0.5, 0.42],
      panel: "protocol", pill: "beat 21" },

  ];

  return { beats, marks: [bufTypes], bench, drvA, stages };
}
