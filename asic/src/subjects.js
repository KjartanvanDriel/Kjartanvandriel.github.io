/* A subject is one thing the camera can look at: the whole die, or a single
   standard cell. Building one turns the exported rings into extruded, outlined
   layers; everything after that is position, colour and opacity.

   Geometry follows the gds_viewer_kit template. GDS (x, y) becomes three
   (x, height, -y), in micrometres; exported vertices are nanometre integers. */

import { theme } from "./theme.js";

const clamp01 = x => Math.min(Math.max(x, 0), 1);

export const ZSCALE = 1.6;            // vertical exaggeration of the stack

function buildLayer(L) {
  const pos = [], nrm = [], idx = [], lines = [];
  const zTop = L.z0 + L.t, zBot = L.z0;
  let vi = 0;
  const V = L.v;
  const polys = [];                       // per polygon: its net and vertex range
  const bb = [Infinity, Infinity, -Infinity, -Infinity];   // the layer's own extent
  // Every layer carries per-polygon data and a colour attribute, netted or
  // not: `spot` lights a polygon by where it is, which a cell needs as much
  // as the die does.
  const netted = Array.isArray(L.n) && L.n.some(n => n >= 0);
  L.r.forEach((ringLens, k) => {
    const start = pos.length / 3;
    const rings = ringLens.map(n => {
      const r = [];
      for (let i = 0; i < n; i++, vi += 2) r.push([V[vi] / 1000, V[vi + 1] / 1000]);
      return r;
    });
    const contour = rings[0].map(p => new THREE.Vector2(p[0], p[1]));
    const holes = rings.slice(1).map(r => r.map(p => new THREE.Vector2(p[0], p[1])));
    const tris = THREE.ShapeUtils.triangulateShape(contour, holes);
    const all = contour.concat(...holes);
    const base = pos.length / 3;
    for (const v of all) { pos.push(v.x, zTop, -v.y); nrm.push(0, 1, 0); }
    for (const t of tris) idx.push(base + t[0], base + t[1], base + t[2]);
    for (const ring of rings) {                       // walls, flat-shaded per edge
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const a = ring[i], b = ring[(i + 1) % n];
        const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
        const nx = dy / len, nz = dx / len;           // outward for CCW exterior
        const b0 = pos.length / 3;
        pos.push(a[0], zBot, -a[1], b[0], zBot, -b[1], b[0], zTop, -b[1], a[0], zTop, -a[1]);
        for (let k = 0; k < 4; k++) nrm.push(nx, 0, nz);
        idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
        lines.push(a[0], zTop, -a[1], b[0], zTop, -b[1]);
      }
    }
    // centroid of the outer ring, in GDS units, for lighting by location
    let cx = 0, cy = 0;
    const ring0 = pos.length / 3 - start;      // vertices since `start` include the walls; use the ring lengths
    { let vi2 = start * 3, m = ringLens[0]; for (let i = 0; i < m; i++, vi2 += 3) { cx += pos[vi2]; cy -= pos[vi2 + 2]; } cx /= m; cy /= m; }
    bb[0] = Math.min(bb[0], ...rings[0].map(p => p[0])); bb[1] = Math.min(bb[1], ...rings[0].map(p => p[1]));
    bb[2] = Math.max(bb[2], ...rings[0].map(p => p[0])); bb[3] = Math.max(bb[3], ...rings[0].map(p => p[1]));
    polys.push({ net: netted ? L.n[k] : -1, start, count: pos.length / 3 - start, cx, cy,
                 lines: lines.length / 3 - (polys.length ? polys.reduce((a, q) => a + q.lines, 0) : 0) });
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  // A netted layer carries its colour per vertex, so one polygon can be lit a
  // different colour from its neighbours. The material colour is then white
  // and the base layer colour is written into the vertices by paint().
  geo.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(pos.length).fill(1), 3));
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide,
    vertexColors: true, transparent: true,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const lmat = new THREE.LineBasicMaterial({ color: new THREE.Color(theme.ink), transparent: true });
  const lg = new THREE.BufferGeometry();
  lg.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, mat), new THREE.LineSegments(lg, lmat));
  g.name = L.name;
  g.userData = { mat, lmat, L, empty: L.r.length === 0, polys, bb,
                 base: new THREE.Color() };
  return g;
}

/**
 * `solid` makes a faded layer still write depth, so only the nearest surface
 * is drawn. Without it a subject at eight per cent is not a ghost but a fog:
 * a die is thousands of overlapping boxes and they all blend. Off during a
 * crossfade, where two subjects have to show through each other.
 */
export function setOpacity(m, o, solid = false) {
  m.opacity = o;
  m.transparent = o < 0.995;
  m.depthWrite = solid ? o > 0.03 : o > 0.5;
}

export class Subject {
  constructor(key, d, scene) {
    this.key = key;
    this.root = new THREE.Group();
    this.root.scale.y = ZSCALE;
    this.groups = d.layers.map(L => { const g = buildLayer(L); this.root.add(g); return g; });

    const [x0, y0, x1, y1] = d.bbox;
    Object.assign(this, { x0, y0, W: x1 - x0, D: y1 - y0, labels: d.labels });

    // Explode by occupied slot. If an empty layer opens a gap, a cell that
    // uses none of met2..met5 becomes a tall stack of air.
    let n = 0;
    this.slot = d.layers.map(L => (L.r.length ? n++ : Math.max(n - 1, 0)));
    this.slots = Math.max(n, 1);
    this.lift = d.layers.map(() => 0);       // world offsets, filled in by explode()
    this.side = d.layers.map(() => 0);

    // the top of what is actually drawn; the camera frames this, not the
    // nominal top of the stack
    const filled = d.layers.filter(L => L.r.length);
    this.stackTop = Math.max(...filled.map(L => L.z0 + L.t), 1);

    const slabT = Math.max(this.W, this.D) * 0.015;
    this.slab = new THREE.Mesh(new THREE.BoxGeometry(this.W, slabT, this.D),
      new THREE.MeshLambertMaterial({ color: new THREE.Color(theme.substrate), transparent: true }));
    this.slab.position.set((x0 + x1) / 2, -slabT / 2, -(y0 + y1) / 2);
    this.root.add(this.slab);

    // Where this subject sits in the world. A cell is anchored at the
    // placement it was taken from, so the die and the cell occupy the same
    // spot and a beat can move between them by zooming rather than cutting.
    this.home = new THREE.Vector3(0, 0, 0);

    this.root.visible = false;
    scene.add(this.root);
  }

  /** Centre this subject on a point in die coordinates. */
  place(at) {
    this.home.set(at[0] - (this.x0 + this.W / 2), 0, -at[1] + (this.y0 + this.D / 2));
    this.root.position.copy(this.home);
  }

  worldX(x) { return this.home.x + x; }        // local micrometres -> world
  worldZ(y) { return this.home.z - y; }        // GDS +y runs into -z

  /**
   * Explode the stack. `gap` lifts each occupied layer, `drift` fans it sideways.
   *
   * A layer's slot is the sum of the weights of the layers under it, not their
   * count. A layer faded out therefore stops holding its slot open and the ones
   * above slide down as it goes, so peeling four layers off a cell closes the
   * gaps instead of leaving the rest floating in voids.
   */
  explode(gap, drift, want) {
    let acc = 0;
    this.groups.forEach((g, j) => {
      this.lift[j] = acc * gap;
      this.side[j] = acc * gap * drift;
      g.position.y = this.lift[j] / ZSCALE;
      g.position.x = this.side[j];
      if (!g.userData.empty) acc += want ? clamp01(want[g.name] ?? 1) : 1;
    });
    this.gap = gap; this.drift = drift;
  }

  /** World height and added width of the whole stack as currently exploded. */
  extent() {
    return { tall: this.stackTop * ZSCALE + (this.slots - 1) * this.gap,
             spread: (this.slots - 1) * this.gap * this.drift };
  }

  /** The same, for the layers one beat actually lights. The camera frames
      this, so fading a layer out also stops it pushing the camera back. */
  litExtent(want) {
    let tall = 0, spread = 0;
    this.groups.forEach((g, j) => {
      if ((want[g.name] ?? 1) > 0.5 && !g.userData.empty) {
        tall = Math.max(tall, this.labelY(j));
        spread = Math.max(spread, g.position.x);
      }
    });
    return tall ? { tall, spread } : this.extent();
  }

  /** World position of a label on stack layer `i`, as currently exploded. */
  labelY(i) {
    const L = this.groups[i].userData.L;
    return (L.z0 + L.t) * ZSCALE + this.lift[i];
  }
  labelX(i) { return this.side[i]; }

  /**
   * Colour and fade the stack.
   *   col   0 grey, 1 oslo
   *   want  per-layer opacity, name -> 0..1
   *   alpha a global multiplier, for crossfades
   *   ghost fade towards the pane instead of towards transparent
   *
   * Ghosting the whole subject cannot be done with alpha. A die is thousands
   * of overlapping boxes; at eight per cent each they blend into a fog rather
   * than a faint chip. Washing the colour towards the background instead
   * leaves the geometry opaque, so only the nearest surface is seen and the
   * ghost keeps its shape. Alpha is still what a beat wants when it fades one
   * layer to see what lies under it, which is why both are here.
   */
  paint(col, want, alpha, ghost, lines = 1) {
    const solid = alpha > 0.95;          // not mid-crossfade
    const wash = ghost && solid;
    this.groups.forEach((g, j) => {
      const w = want[g.name] ?? 1;
      const c = g.userData.mat.color.copy(GREY[j]).lerp(OSLO[j], col);
      g.userData.base.copy(c);
      const l = g.userData.lmat.color.copy(INK);
      if (wash && w > 0.02) {
        // Emissive, with the colour black: the ghost renders flat at exactly
        // the washed value. Lit, a face turned away is still half as dark as
        // one facing the light, and at this remove that relief is all the eye
        // sees, so the ghost comes back as clutter instead of receding.
        // How much of this layer has become the flat ghost. The wash is for a
        // layer that is actually faint; a layer still at full strength has to
        // stay lit. Switching the whole die to emissive the moment the *next*
        // beat asks for a ghost left it one uniform tone with no shading on it
        // anywhere, which is what made the approach to the cell read as grey
        // card. It flipped exactly on the heading, so the same beat looked
        // like two different renderings either side of its anchor.
        const k = clamp01((1 - w) / 0.35);
        g.userData.mat.emissive.copy(TMP.copy(c).lerp(PANE, 1 - w)).multiplyScalar(k);
        if (g.userData.polys) c.setRGB(1, 1, 1);   // colour lives in the vertices
        c.multiplyScalar(1 - k);                   // what is left of the lit surface
        l.lerp(PANE, (1 - w * 0.6) * k);
        setOpacity(g.userData.mat, alpha, solid);
        setOpacity(g.userData.lmat, alpha, solid);
      } else {
        g.userData.mat.emissive.setRGB(0, 0, 0);
        if (g.userData.polys) c.setRGB(1, 1, 1);     // colour lives in the vertices
        setOpacity(g.userData.mat, alpha * w, solid);
        setOpacity(g.userData.lmat, alpha * w * 0.9 * lines, solid);
      }
      g.visible = alpha * w > 0.02 || (ghost && w > 0.02);
    });
    // the substrate goes with the layers: a beat that puts the die out should
    // not leave its slab hanging in the frame
    const body = Math.max(...this.groups.map(g => want[g.name] ?? 1));
    setOpacity(this.slab.material, alpha * 0.85 * body, solid);
  }
}

/**
 * Hide every polygon whose centroid falls in a box, by collapsing its vertices
 * to a point: a degenerate triangle draws nothing and costs nothing, and the
 * original positions are kept so the cut can be undone. Only netted layers
 * carry the centroids this needs. `box` is [x0, y0, x1, y1] in die units,
 * or null to restore.
 */
Subject.prototype.cutout = function (box) {
  const key = box ? box.join() : "";
  if (key === this._cutKey) return;
  this._cutKey = key;
  for (const g of this.groups) {
    const polys = g.userData.polys;
    if (!polys) continue;
    const geo = g.children[0].geometry, attr = geo.getAttribute("position"), arr = attr.array;
    const lg = g.children[1].geometry, lattr = lg.getAttribute("position"), larr = lattr.array;
    if (!g.userData.orig) g.userData.orig = { pos: arr.slice(), line: larr.slice() };
    arr.set(g.userData.orig.pos); larr.set(g.userData.orig.line);
    if (box) {
      let li = 0;                                    // line vertices run in the same polygon order
      for (const q of polys) {
        const lines = q.lines ?? 0;
        if (q.cx >= box[0] && q.cx <= box[2] && q.cy >= box[1] && q.cy <= box[3]) {
          const i0 = q.start * 3, x = arr[i0], y = arr[i0 + 1], z = arr[i0 + 2];
          for (let i = i0, e = (q.start + q.count) * 3; i < e; i += 3) { arr[i] = x; arr[i + 1] = y; arr[i + 2] = z; }
          for (let i = li * 3, e = (li + lines) * 3; i < e; i += 3) { larr[i] = x; larr[i + 1] = y; larr[i + 2] = z; }
        }
        li += lines;
      }
    }
    attr.needsUpdate = true; lattr.needsUpdate = true;
  }
};

/**
 * Colour nets. A spec is null, "all", or a map net id -> colour. Between two
 * beats the tint of a net fades in or out by `f`; with "all" every net takes
 * a colour hashed onto the oslo ramp, which is the "random noise through the
 * gradient" the outline asks for. Only netted layers are touched.
 */
/** Set `tint` from a spec: a colour, or "+" / "+d" for the base colour lifted
    (saturated a little and lightened by 0.12, or by d). */
function lift(want, base, tint, hsl) {
  if (typeof want === "string" && want[0] === "+") {
    const d = want.length > 1 ? parseFloat(want.slice(1)) : 0.12;
    base.getHSL(hsl);
    tint.setHSL(hsl.h, Math.min(1, hsl.s * 1.35 + 0.08), Math.min(0.9, Math.max(0.08, hsl.l * 1.25 + d)));
  } else tint.set(want);
}

Subject.prototype.paintNets = function (specA, specB, f, dim = 0, spotA = null, spotB = null) {
  const key = `${specA === "all" ? "*" : specA ? Object.keys(specA).length : 0}|` +
              `${specB === "all" ? "*" : specB ? Object.keys(specB).length : 0}|${f.toFixed(3)}|${dim.toFixed(3)}|` +
              `${spotA ? spotA.join() : ""}|${spotB ? spotB.join() : ""}|${this.groups[0].userData.base.getHex()}`;
  if (key === this._netKey && specA === this._specA && specB === this._specB) return;
  this._netKey = key; this._specA = specA; this._specB = specB;
  const tint = new THREE.Color(), out = new THREE.Color(), hsl = {};
  // a spot is a box [x0, y0, x1, y1, colour] in die coordinates: every polygon
  // whose centroid falls inside is lit, whatever net it is on
  // A beat may name more than one box: the mark on the die keeps its own
  // colour on every beat that shows the whole chip, and a region beat lights
  // its block as well.
  const boxes = spec => !spec ? [] : (Array.isArray(spec[0]) ? spec : [spec]);
  /* A box may carry a sixth element: nets it must NOT light. The power rails
     run the width of every standard-cell row, so a box drawn round a region
     was lighting the two rails passing through it along with the logic. They
     are in the region geometrically and carry nothing functional. */
  const hit = (spec, p) => boxes(spec).find(b =>
    p.cx >= b[0] && p.cx <= b[2] && p.cy >= b[1] && p.cy <= b[3] && !(b[5] && b[5].has(p.net)));
  // "all" leaves out the nets the subject was told to skip: the rails, which
  // run the width of every row and are not wires anyone is tracing
  const has = (spec, net, p) => (spec === "all" ? (this.skipNets && this.skipNets.has(net) ? 0 : 1) : (spec && spec[net] !== undefined ? 1 : 0));
  const colourOf = (spec, net) => spec === "all" ? hashColour(net) : spec[net];
  for (const g of this.groups) {
    const polys = g.userData.polys;
    if (!polys) continue;
    const attr = g.children[0].geometry.getAttribute("color"), arr = attr.array;
    const base = g.userData.base;
    for (const p of polys) {
      let r = base.r, gg = base.g, b = base.b;
      let lit = 0;
      if (p.net >= 0) {
        const wa = has(specA, p.net), wb = has(specB, p.net), w = wa + (wb - wa) * f;
        if (w > 0.001) {
          // a tint of "+d" keeps the layer's own colour and lifts it by d in
          // lightness (d may be negative): the polygon stays what it is, only
          // brighter or darker, which is how a region's pieces are told apart
          lift(colourOf(f < 0.5 && wa ? specA : (wb ? specB : specA), p.net), base, tint, hsl);
          out.copy(base).lerp(tint, w);
          r = out.r; gg = out.g; b = out.b; lit = w;
        }
      }
      if (spotA || spotB) {
        const ha = hit(spotA, p), hb = hit(spotB, p);
        const w = (ha ? 1 : 0) + ((hb ? 1 : 0) - (ha ? 1 : 0)) * f;
        if (w > 0.001) {
          // "+" keeps the layer's own colour and lifts it, for a beat that
          // wants the parts it is about brighter rather than repainted
          const want = ((f < 0.5 && ha) ? ha : (hb || ha))[4];
          lift(want, base, tint, hsl);
          out.setRGB(r, gg, b).lerp(tint, w);
          r = out.r; gg = out.g; b = out.b; lit = Math.max(lit, w);
        }
      }
      // `dim` washes everything that is not lit toward the pane, per polygon,
      // so a beat can leave only its connections standing without any alpha
      if (dim > 0.001 && lit < 0.999) {
        out.setRGB(r, gg, b).lerp(PANE, dim * (1 - lit));
        r = out.r; gg = out.g; b = out.b;
      }
      for (let i = p.start * 3, e = (p.start + p.count) * 3; i < e; i += 3) {
        arr[i] = r; arr[i + 1] = gg; arr[i + 2] = b;
      }
    }
    attr.needsUpdate = true;
  }
};

/** Paint the whole subject one colour: an inset lifted out of the die, shown
    on its own rather than as part of it. */
Subject.prototype.tint = function (colour) {
  const c = new THREE.Color(colour);
  for (const g of this.groups) {
    g.userData.mat.color.setRGB(1, 1, 1);
    g.userData.mat.emissive.setRGB(0, 0, 0);
    g.userData.base.copy(c);
    g.userData.lmat.color.copy(c).multiplyScalar(0.55);
    const attr = g.children[0].geometry.getAttribute("color"), arr = attr.array;
    for (let i = 0; i < arr.length; i += 3) { arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b; }
    attr.needsUpdate = true;
  }
  this._netKey = null;                       // paintNets must not skip the next call
};

/** A net id onto the oslo ramp, spread by a cheap hash so neighbours differ. */
function hashColour(net) {
  let h = (net * 2654435761) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h = (h ^ (h >>> 13)) >>> 0;   // stay unsigned
  // From the scheme's own palettes, the region ramp and the layer ramp
  // together, with a small step in lightness on top: enough that two wires
  // that touch read apart, without leaving the piece's colours for a raw hue
  // wheel, which read as garish.
  const pal = PALETTE.length ? PALETTE : SEQ;
  const c = new THREE.Color().copy(pal[h % pal.length]);
  const d = (((h >>> 20) % 3) - 1) * 0.07;
  const hsl = {}; c.getHSL(hsl);
  return c.setHSL(hsl.h, hsl.s, Math.min(0.8, Math.max(0.2, hsl.l + d)));
}

const SEQ = [], OSLO = [], GREY = [], PALETTE = [], PANE = new THREE.Color(), INK = new THREE.Color();
const TMP = new THREE.Color();
/** Refill the palette arrays from the theme, in place, so a scheme change
    reaches every subject on its next paint() without rebuilding anything. */
export function retheme() {
  SEQ.splice(0, SEQ.length, ...theme.osloSeq.map(c => new THREE.Color(c)));
  OSLO.splice(0, OSLO.length, ...theme.oslo.map(c => new THREE.Color(c)));
  GREY.splice(0, GREY.length, ...theme.grey.map(c => new THREE.Color(c)));
  // the piece's own colours, for anything that needs many: the regions' and the layers' ramps together
  PALETTE.splice(0, PALETTE.length, ...[...(theme.region || []), ...(theme.oslo || [])].filter(Boolean).map(c => new THREE.Color(c)));
  PANE.set(theme.pane); INK.set(theme.ink);
}
retheme();
