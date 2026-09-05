/* Act I, beat by beat. Content only: each entry is a view of the chip, and the
   engine interpolates between them. `id` must match a <section> in the page.

   Field reference is in README.md. Everything here is data. A beat that needs
   something the vocabulary cannot say calls for a new field in src/engine.js. */

import { AZ } from "../src/engine.js";
import { logo, ABOVE_MET3 } from "./common.js";
import { theme } from "../src/theme.js";
import { pickTransistor } from "../src/schematic.js";
import { placementsOf } from "../src/marks.js";

const TOP = { az: AZ, elev: Math.PI / 2, ortho: 1 };            // plan view
// what the array form of `layers` gave the layers it did not name
const GHOST = { nwell: 0.10, diff: 0.10, poly: 0.10, licon1: 0.10, li1: 0.10, mcon: 0.10,
                met1: 0.10, via: 0.10, met2: 0.10, via2: 0.10, met3: 0.10, via3: 0.10,
                met4: 0.10, via4: 0.10, met5: 0.10 };
// The die here is the netted export, the same one Act II colours by wire: it
// lets the opening light the logo by location, and it saves shipping a second
// copy of the die.
const DIE = "dienet", XOR = "xor2_2", DFF = "dfrtp_2", BUF = "clkbuf_4";

/* The camera turns once and then stops turning.

   Beats 0 to 6 are the chip as an object: azimuth, elevation and the blend
   towards orthographic all rise together and monotonically. Beat 2 lands on a
   true isometric, which is what the outline asks that beat for: the diagonal
   azimuth and elev = atan(1 / sqrt 2), drawn orthographically so the two
   ground axes come out the same length. Beat 7 arrives overhead and nothing
   rotates after it. What is left is a zoom into one cell, a few layers fading,
   and a zoom back out.

   The overhead run is deliberately flat and single-object. An exploded stack
   fanned across the frame is the right picture for a layer stack and the wrong
   one for a cell you are meant to read: it puts five or six loose plates in
   shot at once. Beats 8 to 10 peel by fading a layer out, not by pulling it
   away, which is also what the outline asks for. */
const ISO = [-Math.PI / 4, Math.atan(1 / Math.SQRT2)];        // 45 deg, 35.26 deg
const ARC = [
  [0.008, 1.05, 0.44], [0.008, 1.05, 0.44],
  [-1.042, 0.535, 0.5], [-1.02, 0.55, 0.55],
  [-0.88, 0.765, 0.6], [-0.842, 0.655, 0.65],
  [-0.842, 0.655, 0.65],
];
const turn = i => ({ az: AZ + ARC[i][0], elev: ARC[i][1], ortho: ARC[i][2], fov: 15 });

export function act1(data) {
  const P = data.placements;

  // The middle of where the cells are, not of the die's box: the box runs
  // down past the Morse strip under the die, which pulls its centre south.
  const [bx0, by0, bx1, by1] = data.die.bbox;
  const ex = [Math.min(...P.map(p => p.b[0])), Math.min(...P.map(p => p.b[1])),
              Math.max(...P.map(p => p.b[2])), Math.max(...P.map(p => p.b[3]))];
  const mid = [(ex[0] + ex[2]) / 2, (ex[1] + ex[3]) / 2];

  // One spot on the die where cells are examined: the XOR placement nearest
  // the middle. Beat 7b zooms into it out of the plan view, and beats 8 to 10
  // dissolve one cell into the next without the camera going anywhere. Putting
  // each cell at its own placement instead makes those three beats a long pan
  // between unrelated corners, with two cells adrift in the frame.
  const centre = p => [(p.b[0] + p.b[2]) / 2, (p.b[1] + p.b[3]) / 2];
  const nearest = type => centre(placementsOf(P, type).reduce((best, p) =>
    Math.hypot(...centre(p).map((c, k) => c - mid[k]))
      < Math.hypot(...centre(best).map((c, k) => c - mid[k])) ? p : best));
  const bench = nearest(XOR);
  const places = { [XOR]: bench, [DFF]: bench, [BUF]: bench,
                   rowcounter: [(18.9 + 45.5) / 2, (88.1 + 113.0) / 2] };
  const onBench = z => [(bench[0] - bx0) / (bx1 - bx0), (bench[1] - by0) / (by1 - by0), z];
  // the placement the bench cell came from, padded a little: beat 3 cuts it
  // out of the die so the lifted cell stands where the die's copy was
  const benchPlace = placementsOf(P, XOR).find(p => Math.abs((p.b[0] + p.b[2]) / 2 - bench[0]) < 1e-6 &&
                                                     Math.abs((p.b[1] + p.b[3]) / 2 - bench[1]) < 1e-6);
  const benchBox = benchPlace ? [benchPlace.b[0] - 0.2, benchPlace.b[1] - 0.2, benchPlace.b[2] + 0.2, benchPlace.b[3] + 0.2] : null;

  // the transistor beat 8 draws, and the box that lights just it
  const tr = data.cells[XOR] && pickTransistor(data.cells[XOR]);
  // the box the beat lights: the transistor, and the local wire its drain
  // leaves on, so the parts the drawing names are the bright ones
  const trWire = tr && (data.cells[XOR].wires || []).filter(w => w.net === tr.sd[1])
    .sort((p, q) => (q.b[2] - q.b[0]) * (q.b[3] - q.b[1]) - (p.b[2] - p.b[0]) * (p.b[3] - p.b[1]))[0];
  const oneTr = !tr ? null : [
    Math.min(tr.ch[0] - 0.6, trWire ? trWire.b[0] - 0.1 : Infinity),
    Math.min(tr.ch[1] - 0.5, trWire ? trWire.b[1] - 0.1 : Infinity),
    Math.max(tr.ch[2] + 0.6, trWire ? trWire.b[2] + 0.1 : -Infinity),
    Math.max(tr.ch[3] + 0.5, trWire ? trWire.b[3] + 0.1 : -Infinity), "+"];

  const beats = [
    { id: "title", spot: logo(), subj: DIE, ...turn(0), gap: 7.15, focus: [0.5, 0.42, 0.85],
      idle: { amp: 0.18, period: 14 },
      insets: [{ subj: "morse", at: [100, -51.35], lift: 0, colour: "#111111" }], pill: "title" },

    // part one's own header, between the title and the first beat: the same
    // framing as the title, without its idle sway
    { id: "a1", spot: logo(), subj: DIE, ...turn(0), gap: 7.15, focus: [0.5, 0.42, 0.85],
      insets: [{ subj: "morse", at: [100, -51.35], lift: 0, colour: "#111111" }], pill: "part i" },

    { id: "a1-files", spot: logo(), subj: DIE, ...turn(1), gap: 7.15, focus: [0.5, 0.495, 0.655],
      panel: "files", col: 0, pill: "beat 1" },

    // Slightly exploded: the layers separate at their edges without the die
    // becoming a stack of plates yet. They stay in register above each other,
    // which is the whole point of the picture; fanning them sideways to fill a
    // wide pane just shears the chip.
    { id: "a1-layers", spot: logo(), subj: DIE, gap: 2.85, ...turn(2), focus: [0.5, 0.5, 0.59], col: 0, pill: "beat 2" },

    // The die goes out entirely and one cell is left, drawn at the placement it
    // came from. A ghost of the die was the first try and it did not work: at
    // this zoom the surviving cell is one pale block among hundreds of others.
    // The cell is a subject of its own because the die's polygons are merged
    // per layer, so no one cell can be lifted back out of it.
    { id: "a1-cells", subj: DIE, ...turn(3), layers: 0,
      focus: onBench(0.08), cut: benchBox, insets: [{ subj: XOR, at: bench, lift: 0, colour: theme.pick }],
      col: 0, pill: "beat 3" },

    { id: "a1-floorplan", spot: logo(), subj: DIE, gap: 0, ...turn(4), col: 0, pill: "beat 4" },

    // Beats 5 and 6 explode one patch of the die, the row counter, rather than
    // the whole thing: fifteen layers of a 27 by 25 micrometre region can be
    // read; fifteen layers of the die cannot.
    { id: "a1-library", subj: "rowcounter", gap: 0, ...turn(5), fov: 5, focus: [0.5, 0.5, 0.51],
      tagRank: 1, col: 0, pill: "beat 5" },

    { id: "a1-layer-tour", subj: "rowcounter", gap: 3, ...turn(6), fov: 5, focus: [0.5, 0.5, 0.51],
      tags: "name", tagRank: 1, pill: "beat 6" },

    // from here to the end of the act the camera stays overhead. Only the
    // subject, the zoom and the layer opacities change.
    { id: "a1-ports", spot: logo(), subj: DIE, ...TOP, fov: 12, layers: { ...GHOST, met3: 1, ...ABOVE_MET3 }, tags: "ports",
      pill: "beat 7" },

    { id: "a1-pins", subj: XOR, ...TOP, fov: 14,
      layers: { mcon: 0, met1: 0, via: 0, met2: 0, via2: 0, met3: 0, via3: 0, met4: 0, via4: 0, met5: 0 }, tags: "pins", arrows: true, hover: true, pill: "beat 7b" },

    // One transistor, drawn where it sits. Only diffusion and poly are lit;
    // the leads on the sketch land on the diffusion islands either side of
    // the crossing, which are its real source and drain.
    // The transistor's own polygons in their natural colours, everything else
    // in the cell washed to white (dim 1), and no circuit drawn over it. The
    // layers can be hovered for a line on what each one is.
    // One transistor: the cell drawn in the grey ramp (col 0), and over it the
    // parts of one device in their layers' colours, gate, source, drain and
    // the ground rail, each named.
    { id: "a1-transistor", subj: XOR, ...TOP, fov: 14, col: 0,
      layers: { mcon: 0, met1: 0, via: 0, met2: 0, via2: 0, met3: 0, via3: 0, met4: 0, via4: 0, met5: 0 },
      lines: 0.3, sketch: "one-transistor-parts", hover: true, pill: "beat 8" },

    // the same cell, every device, as a schematic over the layout it came from
    // the cell as it is, nothing dimmed, with the pins' wires drawn over it in
    // their tints; the schematic is a figure in the text now
    { id: "a1-xor", subj: XOR, ...TOP, fov: 14,
      layers: { mcon: 0, met1: 0, via: 0, met2: 0, via2: 0, met3: 0, via3: 0, met4: 0, via4: 0, met5: 0 },
      sketch: "xor-wires", hover: true, pill: "beat 8b" },

    // the flip-flop, with its own schematic over it and a lit path that walks
    // the capture in step with the timing diagram below
    // the cell as it is, every layer in its own colour, its pins named, and
    // nothing drawn over it: the timing is a figure in the text now
    { id: "a1-flipflop", subj: DFF, ...TOP, fov: 14,
      layers: { mcon: 0, met1: 0, via: 0, met2: 0, via2: 0, met3: 0, via3: 0, met4: 0, via4: 0, met5: 0 },
      sketch: "dff-wires", hover: true, pill: "beat 9" },

    { id: "a1-buffer", subj: BUF, ...TOP, fov: 14,
      layers: { mcon: 0, met1: 0, via: 0, met2: 0, via2: 0, met3: 0, via3: 0, met4: 0, via4: 0, met5: 0 },
      sketch: "buf-wires", hover: true, pill: "beat 10" },

    // the metals above met3 come down a little so the cell types read through
    { id: "a1-close", spot: logo(), subj: DIE, ...TOP, fov: 12, layers: { ...ABOVE_MET3 }, marks: "*",
      pill: "beat 11" },
  ];
  /* The slow turn the opening has, kept from the title through to the layer
     tour -- the beat whose heading is "The layers", which is b-tour, not
     b-layers -- while the camera is still circling an object it is looking at.
     From the ports on it goes overhead and stays there, and a sway under a
     plan view reads as the whole picture rotating rather than an object
     tilting. It fades as each beat is left, so it never argues with the move
     that follows. */
  const last = beats.findIndex(b => b.id === "a1-layer-tour");
  for (const b of beats.slice(0, last + 1)) b.idle ??= { amp: 0.18, period: 14 };
  beats.push({ ...beats[beats.length - 1], id: "a1-notes", pill: "a1-notes" });

  return { beats, marks: ["*"], places };
}
