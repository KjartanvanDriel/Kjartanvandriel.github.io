/* Scroll position becomes a float index into the beat list; everything the
   pane shows is a function of that number.

   Numeric fields interpolate between the two beats you are between. Discrete
   ones (label set, panel) crossfade by presence, so a beat never has to know
   what the beat before it was showing.

   Two beats on different subjects are drawn together, one fading out where the
   other fades in, and the camera moves between the two framings. Cells are
   anchored at the placement they were taken from, so that move is a zoom into
   the die rather than a cut through an empty pane.

   The camera distance is not authored. Each frame the engine measures the lit
   part of the stack in camera space and backs off until it fits. Without that,
   no single distance works for both a 100 um die and a 6 um cell. */

import { ZSCALE } from "./subjects.js";

const clamp01 = x => Math.min(Math.max(x, 0), 1);
const lerp = (a, b, t) => a + (b - a) * t;
// Smoothstep, not a cubic ease. A cubic puts 94% of the move in the middle
// half of the scroll, which finishes the shot before the section is read.
const ease = t => t * t * (3 - 2 * t);

export const AZ = Math.PI / 2;        // top-down azimuth: screen up is GDS +y
const NEAR = 1, FAR = 20000;
const MARGIN = 1.30;          // air left around the fitted subject

/** Beat fields that are numbers, with the value assumed when one is left out. */
const NUMERIC = { gap: 0, drift: 0, az: AZ, elev: 0.5, fov: 30, ortho: 0, col: 1, cycle: 0, dim: 0, morph: 0, lines: 1 };

/** A `layers` spec becomes an opacity per layer name. A number sets them all
    at once; an array lights those and ghosts the rest; an object sets them one
    by one. */
function wants(spec, names) {
  const out = {};
  for (const n of names) {
    out[n] = spec === undefined || spec === null ? 1
      : typeof spec === "number" ? spec
      : Array.isArray(spec) ? (spec.includes(n) ? 1 : 0.10)
      : (spec[n] ?? 1);
  }
  return out;
}

export class Engine {
  constructor({ subjects, beats, canvas, renderer, scene, camera, tags, arrows, symbols, frames, outlines, wires,
                flow, cards, sketch, panels, sidebar, sim, waveforms }) {
    Object.assign(this, { subjects, beats, canvas, renderer, scene, camera, tags, arrows, symbols, frames, wires,
                          flow, cards, outlines, sketch, panels, sidebar, sim, waveforms: waveforms || [] });
    this.highCache = new Map();      // cycle -> {netId: colour}, for sim beats
    this.layerNames = subjects[beats[0].subj].groups.map(g => g.name);
    this.marks = new Map();          // spec -> Marks, registered by the act
    // A beat is anchored on its heading, not on the top of its section. The
    // reader should be squarely in a beat's view at the moment its heading sits
    // on the anchor line; anchoring on the section puts them there a whole
    // padding-top early.
    this.sections = beats.map(b => {
      const el = document.getElementById(b.id);
      if (!el) console.warn(`beat "${b.id}" has no section in the page`);
      return el && (el.querySelector("h1, h2") || el);
    });
    this.lock = null;                // a beat index pins the pane there, for tuning
    this.target = new THREE.Vector3();
    this.mP = new THREE.Matrix4();
    this.mO = new THREE.Matrix4();
    this.resize();
    addEventListener("resize", () => this.resize());
  }

  register(spec, marks) { this.marks.set(spec, marks); }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
  }

  /**
   * Where the reader is, as a float index into the beats.
   *
   * A beat holds while its text is being read. The move to the next beat runs
   * only over the last `--approach` of scroll before the next heading reaches
   * the anchor line, so a reader partway down a section still sees that
   * section's picture. A beat marked `spread` interpolates across its whole
   * section instead, for the ones where the motion is the content.
   */
  position() {
    if (this.lock !== null) return this.lock;
    const css = getComputedStyle(document.documentElement);
    const anchor = innerHeight * parseFloat(css.getPropertyValue("--anchor")) / 100;
    const approach = innerHeight * (parseFloat(css.getPropertyValue("--approach")) || 60) / 100;
    const a = this.sections.map(el => el ? el.getBoundingClientRect().top - anchor : Infinity);
    a[0] = Math.min(a[0], -scrollY);       // the first beat holds at the top of the page
    let i = 0;
    while (i + 1 < a.length && a[i + 1] <= 0) i++;
    if (i >= a.length - 1) return a.length - 1;
    if (this.beats[i].spread) return i + clamp01((0 - a[i]) / (a[i + 1] - a[i] || 1));
    return i + clamp01(1 - a[i + 1] / approach);
  }

  apply(pos) {
    const i = Math.min(Math.floor(pos), this.beats.length - 1);
    const A = this.beats[i], B = this.beats[Math.min(i + 1, this.beats.length - 1)];
    const f = ease(clamp01(pos - i));
    const num = k => lerp(A[k] ?? NUMERIC[k], B[k] ?? NUMERIC[k], f);
    const has = (b, k, want) => (want === undefined ? (b[k] ? 1 : 0) : (b[k] === want ? 1 : 0));
    const mix = (k, want) => lerp(has(A, k, want), has(B, k, want), f);

    const gap = num("gap"), drift = num("drift"), col = num("col");
    const sa = this.subjects[A.subj], sb = this.subjects[B.subj];
    const swap = sa !== sb;
    // The dissolve runs inside a window, not across the whole move. Two cell
    // layouts superimposed read as a mistake rather than a change of subject,
    // so each end of the transition holds one crisp object and the swap
    // happens in the middle third, while the camera carries the rest.
    const x = ease(clamp01((f - 0.32) / 0.36));
    const wA = swap ? 1 - x : 1, wB = swap ? x : 1;

    // how much of each subject is on screen, for the geometry and the labels
    const weights = {};
    for (const k of Object.keys(this.subjects)) weights[k] = 0;
    weights[sa.key] = wA;
    if (swap) weights[sb.key] = wB;

    // Below a few per cent a subject is not a ghost but a haze: thousands of
    // near-transparent boxes still accumulate over the whole frame. Drop it.
    const FLOOR = 0.06;
    for (const s of Object.values(this.subjects)) {
      s.root.visible = (s === sa && wA > FLOOR) || (s === sb && wB > FLOOR);
      s.root.position.copy(s.home);          // an inset may move one of these
    }

    const wantA = wants(A.layers, this.layerNames);
    const wantB = wants(B.layers, this.layerNames);
    this.want = f < 0.5 ? wantA : wantB;      // a label goes with its layer
    // the scalar form of `layers` is a request to ghost the whole subject
    const ghost = typeof A.layers === "number" || typeof B.layers === "number";
    let extA, extB;
    if (swap) {
      // `lines` scales the polygon outlines: at die scale they can be all one sees
      const lines = num("lines");
      sa.explode(gap, drift, wantA); sa.paint(col, wantA, wA, ghost, lines); extA = sa.litExtent(wantA);
      sb.explode(gap, drift, wantB); sb.paint(col, wantB, wB, ghost, lines); extB = sb.litExtent(wantB);
    } else {
      // When a beat takes the whole stack out (or brings it back) the layers
      // go one after another, top first on the way down and bottom first on
      // the way up, so what is underneath is revealed rather than occluded by
      // a die that is pale but still solid.
      const whole = typeof A.layers === "number" || typeof B.layers === "number";
      const names = this.layerNames, n = names.length, STAGGER = 0.6;
      const want = {};
      names.forEach((nm, j) => {
        let fj = f;
        if (whole && wantA[nm] !== wantB[nm]) {
          const down = wantB[nm] < wantA[nm];
          const turn = down ? 1 - j / (n - 1) : j / (n - 1);
          fj = clamp01((f - STAGGER * turn) / (1 - STAGGER));
        }
        want[nm] = lerp(wantA[nm], wantB[nm], fj);
      });
      sa.explode(gap, drift, want); sa.paint(col, want, 1, ghost, num("lines"));
      extA = sa.litExtent(wantA); extB = sa.litExtent(wantB);
    }

    // cut: a box taken out of the host's geometry, so an inset standing there
    // has nothing fading through it. Applied from the first frame of the move
    // into the beat, and undone from the first frame of the move out.
    sa.cutout?.(A.cut ?? B.cut ?? null);
    if (swap) sb.cutout?.(B.cut ?? A.cut ?? null);

    for (const [spec, m] of this.marks) m.show(mix("marks", spec) * (weights[m.hostKey] ?? 0) * 0.9);

    // nets: a tint per net, fading between what the two beats ask for. A beat
    // with `sim` takes its map from the trace instead: every net that is high
    // on the current cycle, `cycle` being a numeric field like any other, so
    // scrolling between two sim beats steps the simulation.
    // A beat with `play` steps its own cycle once the reader has arrived on it:
    // from `from` to `to` at `rate` cycles a second, after `delay` seconds,
    // and it stops the moment the reader moves on. Scrolling is not needed.
    const now = performance.now() / 1000;
    if (A.play && f < 0.001) { if (this.playing?.beat !== A) this.playing = { beat: A, t0: now }; }
    else if (this.playing && this.playing.beat !== A) this.playing = null;
    const cycleOf = b => {
      if (b.play && this.playing?.beat === b) {
        const { from, to, rate = 10, delay = 2 } = b.play;
        return Math.min(to, from + Math.max(0, now - this.playing.t0 - delay) * rate);
      }
      return b.play ? b.play.from : (b.cycle ?? NUMERIC.cycle);
    };
    const cycle = Math.max(0, Math.min(Math.floor(lerp(cycleOf(A), cycleOf(B), f)), (this.sim?.cycles ?? 1) - 1));
    const live = (A.sim || B.sim) ? this.highAt(cycle) : null;
    const dim = num("dim");
    for (const sub of new Set([sa, sb]))
      sub.paintNets?.(A.sim ? live : (A.nets ?? null), B.sim ? live : (B.nets ?? null), f, dim,
                      A.spot ?? null, B.spot ?? null);
    for (const w of this.waveforms) w.update({ cycle, on: mix("sim") });

    // A beat with an inset is about the inset, so the inset sets the height the
    // camera frames. Keeping the host's height would frame the whole stack and
    // leave the cell a speck at the bottom of it, or out of shot entirely.
    // An inset belongs to its beat: on the way in it fades up with f, on the
    // way out it fades down. Through a swap the subject weights already say
    // that; between two beats on one subject they are both 1, which used to
    // show the next beat's inset at full for the whole of this one.
    const tops = this.placeInsets([[A, swap ? wA : 1 - f, sa, extA.tall], [B, swap ? wB : f, sb, extB.tall]], col, weights);
    if (tops.get(A)) extA.tall = tops.get(A);
    if (tops.get(B)) extB.tall = tops.get(B);

    this.frame(A, B, f, sa, sb, extA, extB, num);
    this.overlay(A, B, f, mix, weights);
  }

  /** The nets high on one cycle of the trace, as a net -> colour map. */
  highAt(cycle) {
    if (this.highCache.has(cycle)) return this.highCache.get(cycle);
    const out = {};
    if (this.sim) {
      const byte = cycle >> 3, bit = cycle & 7;
      for (const [id, packed] of Object.entries(this.sim.bits))
        if (packed[byte] & (1 << bit)) out[id] = this.sim.colour;
    }
    this.highCache.set(cycle, out);
    return out;
  }

  /** Float a beat's inset subjects, and report how high each beat's reach. */
  placeInsets(pairs, col, weights) {
    const tops = new Map();
    for (const [beat, w, host, hostTall] of pairs) {
      let top = 0;
      for (const s of beat.insets || []) {
        const sj = this.subjects[s.subj];
        if (sj === host || w < 0.02) continue;
        sj.root.visible = true;
        sj.explode(0, 0, null);
        sj.paint(col, wants(s.layers, this.layerNames), w, false);
        // A fixed colour, whatever the scheme. The colour of a layer lives in
        // its vertices, so setting the material alone would be overwritten by
        // the next paint; `tint` writes both.
        if (s.colour) sj.tint(s.colour);
        weights[s.subj] = Math.max(weights[s.subj] ?? 0, w);
        const y = hostTall * (s.lift ?? 1.35);
        sj.root.position.set(host.worldX(s.at[0]) - (sj.x0 + sj.W / 2), y,
                             host.worldZ(s.at[1]) + (sj.y0 + sj.D / 2));
        top = Math.max(top, y + sj.stackTop * ZSCALE);
      }
      tops.set(beat, top);
    }
    return tops;
  }

  /** Where the camera must sit to frame one beat's subject. */
  fitOne(beat, sub, ext, dir, up, fov) {
    const { tall, spread } = ext;
    const fx = beat.focus?.[0] ?? 0.5, fy = beat.focus?.[1] ?? 0.5, fs = beat.focus?.[2] ?? 1;
    const t = new THREE.Vector3(sub.worldX(sub.x0 + fx * (sub.W + spread)), tall * 0.5,
                                sub.worldZ(sub.y0 + fy * sub.D));
    const eye = t.clone().addScaledVector(dir, 1000);
    const inv = new THREE.Matrix4().lookAt(eye, t, up).setPosition(eye).invert();
    // focus scales the box on the ground only. The height is whatever the beat
    // is showing, which for a beat with an inset is the inset, not the stack it
    // is standing in.
    const bw = fs * (sub.W + spread) / 2, bd = fs * sub.D / 2;
    const c = new THREE.Vector3();
    let hx = 0, hy = 0;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const sy of [-1, 1]) {
      c.set(t.x + sx * bw, t.y + sy * tall / 2, t.z + sz * bd).applyMatrix4(inv);
      hx = Math.max(hx, Math.abs(c.x)); hy = Math.max(hy, Math.abs(c.y));
    }
    return { t, rad: Math.max(hy, hx / this.camera.aspect) * MARGIN
                     / Math.tan(fov * Math.PI / 360) };
  }

  /** Fit both beats, then move between the two framings. */
  frame(A, B, f, sa, sb, extA, extB, num) {
    const cam = this.camera, t = this.target;
    // idle: a slow turn while the reader sits on a beat, gone by the time
    // they leave it. `idle: {amp, period}` in radians and seconds.
    let az = num("az");
    const idle = A.idle;
    if (idle) az += idle.amp * Math.sin(2 * Math.PI * performance.now() / 1000 / (idle.period || 12)) * (1 - f);
    const elev = num("elev"), fov = num("fov");
    const dir = new THREE.Vector3(Math.cos(elev) * Math.cos(az), Math.sin(elev),
                                  Math.cos(elev) * Math.sin(az));
    const up = new THREE.Vector3(-Math.cos(az), 0, -Math.sin(az));

    const a = this.fitOne(A, sa, extA, dir, up, fov);
    const b = this.fitOne(B, sb, extB, dir, up, fov);
    // The frame centres on the small thing for most of a zoom: heading into
    // a cell the target arrives early and the dolly follows, coming out of
    // one the target stays put until the pull-back is well under way. Either
    // way the move reads as going to, or leaving, that component.
    const zoomIn = b.rad < a.rad;
    const tf = zoomIn ? ease(clamp01(f * 1.6)) : ease(clamp01((f - 0.4) / 0.6));
    t.copy(a.t).lerp(b.t, tf);
    // geometrically, not linearly: the die is fifteen times a cell across, and
    // a linear dolly over that range crawls at one end and lunges at the other
    const rad = a.rad * Math.pow(b.rad / a.rad, f);

    cam.up.copy(up);
    cam.position.copy(t).addScaledVector(dir, rad);
    cam.lookAt(t);

    // Blend perspective towards orthographic. Both agree on the plane through
    // the target, so the footprint never pops; only the parallax drains away.
    const w = num("ortho");
    const halfH = rad * Math.tan(fov * Math.PI / 360), halfW = halfH * cam.aspect;
    this.mP.makePerspective(-halfW * NEAR / rad, halfW * NEAR / rad,
                            halfH * NEAR / rad, -halfH * NEAR / rad, NEAR, FAR);
    this.mO.makeOrthographic(-halfW, halfW, halfH, -halfH, NEAR, FAR);
    const pa = this.mP.elements, pb = this.mO.elements, pm = cam.projectionMatrix.elements;
    for (let k = 0; k < 16; k++) pm[k] = pa[k] * (1 - w) + pb[k] * w;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  }

  overlay(A, B, f, mix, weights) {
    const rect = this.canvas.getBoundingClientRect();
    this.tags.update({ camera: this.camera, rect, subjects: this.subjects, weights, want: this.want,
      minRank: (f < 0.5 ? A : B).tagRank || 0,
      presence: { num: mix("tags", "num"), name: mix("tags", "name"),
                  ports: mix("tags", "ports"), pins: mix("tags", "pins") } });
    this.arrows.update({ camera: this.camera, canvas: this.canvas,
                         subjects: this.subjects, weights, alpha: mix("arrows") });
    // symbols over placed cells: "all", or a list of instance refs
    if (this.symbols) {
      const host = this.symbols.host, sub = this.subjects[host];
      const wants = b => b.symbols === "all" ? null : new Set(b.symbols || []);
      const sA = wants(A), sB = wants(B);
      const w = {};
      for (const it of this.symbols.items) {
        const a = A.symbols ? (sA === null || sA.has(it.ref) ? 1 : 0) : 0;
        const bb = B.symbols ? (sB === null || sB.has(it.ref) ? 1 : 0) : 0;
        w[it.ref] = (a + (bb - a) * f) * (weights[host] || 0);
      }
      this.symbols.update({ camera: this.camera, canvas: this.canvas, subject: sub, weights: w });
    }
    // frames: region rectangles over the die; outlines: cell boxes. Each is
    // "all" or a list of ids on the beat.
    for (const [layer, key] of [[this.frames, "frames"], [this.outlines, "outlines"]]) {
      if (!layer) continue;
      const host = layer.host, sub = this.subjects[host];
      const wants = b => b[key] === "all" ? null : new Set(b[key] || []);
      const fA = wants(A), fB = wants(B), w = {};
      // Region frames glide with the camera; the cell outlines are a discrete
      // thing like the graph, and were still over the layout three-quarters
      // of the way into the next beat. They switch in the second half too.
      const t = key === "outlines" ? (f < 0.5 ? 0 : ease((f - 0.5) * 2)) : f;
      // "all" means the boxes themselves; the pieces inside a box are a
      // result of opening it, and appear only on the beat that lists them
      const wanted = (f, it) => (f === null ? !it.sub : f.has(it.id)) ? 1 : 0;
      for (const it of layer.items) {
        const a = A[key] ? wanted(fA, it) : 0;
        const bb = B[key] ? wanted(fB, it) : 0;
        w[it.id] = (a + (bb - a) * t) * (weights[host] || 0);
      }
      const named = new Set((f < 0.5 ? A : B).names || []);
      // with the orbs up the frame's own chip is redundant: the orb says R1
      // on a black-box beat the frame is the box, so it is drawn solid
      layer.update({ camera: this.camera, canvas: this.canvas, subject: sub, weights: w, named,
                     labels: !((f < 0.5 ? A : B).wires) || !!(f < 0.5 ? A : B).box, solid: !!(f < 0.5 ? A : B).box });
    }
    // wires: the region graph as orbs and arrows over the die. Same projection
    // as the frames, so an orb stays over its rectangle.
    if (this.wires) {
      const sub = this.subjects[this.wires.host];
      const a = A.wires ? 1 : 0, bb = B.wires ? 1 : 0;
      const cur = f < 0.5 ? A : B, spec = cur.wires;
      // The graph is a discrete thing, not a camera move: over a 60vh approach
      // it was already three-quarters up while the reader was still on the
      // beat before. It holds for the first half of the move, then comes in.
      const late = f < 0.5 ? 0 : ease((f - 0.5) * 2);
      // "box": one region as a black box, its neighbours as stand-ins beside it
      this.wires.update({ camera: this.camera, canvas: this.canvas, subject: sub,
                          alpha: (a + (bb - a) * late) * (weights[this.wires.host] || 0),
                          named: new Set(cur.names || []),
                          morph: lerp(A.morph ?? 0, B.morph ?? 0, f),
                          only: spec && spec !== "all" && spec !== "box" ? new Set(spec) : null,
                          box: spec === "box" ? cur.box : null,
                          subs: spec === "box" ? (cur.boxSubs || null) : null });
    }
    // flow: the netlist as a dot per gate and a line per wire, sliding from
    // the die to its trophic layout with `morph`, on the beats that ask (`flow`)
    if (this.flow) {
      const sub = this.subjects[this.flow.host];
      const a = A.flow ? 1 : 0, bb = B.flow ? 1 : 0;
      this.flow.update({ camera: this.camera, canvas: this.canvas, subject: sub,
                         alpha: (a + (bb - a) * f) * (weights[this.flow.host] || 0),
                         morph: lerp(A.morph ?? 0, B.morph ?? 0, f) });
    }
    // cards: small boards floating in the pane. A beat names the set it
    // wants; they belong to no subject, so they do not fade with one.
    if (this.cards) {
      const want = n => (A.cards === n ? 1 : 0) + ((B.cards === n ? 1 : 0) - (A.cards === n ? 1 : 0)) * f;
      this.cards.update({ canvas: this.canvas, alphaOf: want });
    }
    // A beat with `loop` walks a few steps on repeat while the reader is on
    // it. The step is published on the pane, and the sketch and the panel
    // below both style themselves from it, so they keep time with each other.
    const loop = (f < 0.5 ? A : B).loop;
    const step = loop ? Math.floor(performance.now() / 1000 / loop.period * loop.steps) % loop.steps : -1;
    if (document.documentElement.dataset.step !== String(step))
      document.documentElement.dataset.step = String(step);

    // sketches: a drawing in a subject's own coordinates
    if (this.sketch) {
      const w = {};
      for (const id of this.sketch.items.keys()) {
        const a = (A.sketch === id) ? 1 : 0, b = (B.sketch === id) ? 1 : 0;
        w[id] = a + (b - a) * f;
      }
      this.sketch.update({ camera: this.camera, canvas: this.canvas, subjects: this.subjects, weights: w });
    }
    this.panels.show((f < 0.5 ? A : B).panel);
    const src = f < 0.5 ? A : B;
    this.sidebar.update(src.pill, src.stats || []);
  }

  start() {
    const loop = () => {
      this.apply(this.position());
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
