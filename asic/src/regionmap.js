/* The region graph: which region feeds which, and a drawing of it.

   This is a port of netlist_view/regiondag.py, and the port is deliberate:
   the filtering there is the whole reason the picture says anything.

     1. drop the inert cells      taps, decaps, diodes carry no signal
     2. label by bounding-box centre, not by the GDS origin, so a wide cell
        straddling a boundary lands in the rectangle it mostly occupies
     3. remove the clock TREE, not just the clk net. A clkbuf sits wherever
        placement put it, so leaving the tree in makes whichever rectangle
        happens to hold one appear to drive every flop on the chip -- an
        edge from the output writer back into the checkers, which is
        backwards. Thirty-two cells of clock buffer were inventing seven of
        the thirty-two arrows this panel used to draw.
     4. remove reset, which reaches a flop's RESET_B and nothing else
     5. collapse plain buffers by rewiring readers to the driver, because a
        buffer in P between logic in A and logic in B turns one real A -> B
        edge into a false A -> P -> B

   All of it is a DERIVED view. The netlist the simulator runs is untouched:
   a buffer really is in the design, and the clock really does reach the
   flops. What the graph wants is what depends on what.

   The layout is layered rather than geographic. The floorplan already
   answers where things sit -- the coloured frames on the die say that --
   so this answers what feeds what, and pinning nodes to their die
   coordinates while asking for a readable graph are incompatible: neat
   ordering means being free to choose positions. */

const OUTPINS = new Set(["X", "Y", "Q", "Q_N"]);
const POWER = new Set(["VPWR", "VGND", "VPB", "VNB"]);
const INERT = new Set(["decap", "diode", "fakediode", "fill", "tap", "tapvgnd",
                       "tapvgnd2", "tapvpwrvgnd", "tapvpwrvgnd2"]);
const BUFFER = new Set(["buf", "bufbuf", "clkbuf", "clkdlybuf4s15",
                        "clkdlybuf4s18", "dlygate4sd3"]);
const RESET_PIN = { dfrtp: "RESET_B", dfstp: "SET_B", dfxtp: null };
const base = cell => cell.replace(/_\d+$/, "");
export const isFlop = i => base(i.cell) in RESET_PIN;

/** Drivers and readers over a set of instances, ignoring the power pins. */
function wire(insts) {
  const driver = new Map(), readers = new Map();
  for (const i of insts) for (const [p, n] of Object.entries(i.pins)) {
    if (POWER.has(p)) continue;
    if (OUTPINS.has(p)) driver.set(n, i.ref);
    else (readers.get(n) || readers.set(n, new Set()).get(n)).add(i.ref);
  }
  return { driver, readers };
}

/** The cleaned netlist, the region of every cell, and the edges between
    regions. `logic` is every cell with a model; `graph` is what survives the
    stripping and is what the arrows are counted from. */
export function regionGraph(nets, regions) {
  const centre = i => [(i.b[0] + i.b[2]) / 2, (i.b[1] + i.b[3]) / 2];
  const logic = nets.instances.filter(i => !INERT.has(base(i.cell)));
  const reg = new Map(logic.map(i => {
    const [cx, cy] = centre(i);
    const r = regions.find(r => cx >= r.b[0] && cx <= r.b[2] && cy >= r.b[1] && cy <= r.b[3]);
    return [i.ref, r ? r.id : null];
  }));

  let W = logic.map(i => ({ ref: i.ref, cell: i.cell, pins: { ...i.pins } }));

  // 1. the clock tree, found by walking forward from clk through buffers only
  const clockCells = new Set(), clockNets = new Set([nets.ports.clk]);
  {
    const { readers } = wire(W), byRef = new Map(W.map(i => [i.ref, i]));
    const q = [nets.ports.clk];
    while (q.length) for (const r of readers.get(q.pop()) || []) {
      const inst = byRef.get(r);
      if (clockCells.has(r) || !BUFFER.has(base(inst.cell))) continue;
      clockCells.add(r);
      for (const [p, n] of Object.entries(inst.pins))
        if (OUTPINS.has(p) && !clockNets.has(n)) { clockNets.add(n); q.push(n); }
    }
    for (const i of W) if (isFlop(i) && i.pins.CLK !== undefined) clockNets.add(i.pins.CLK);
    W = W.filter(i => !clockCells.has(i.ref));
    for (const i of W) if (i.pins.CLK !== undefined && clockNets.has(i.pins.CLK)) delete i.pins.CLK;
  }
  // 2. reset, which is a flop pin and not dataflow
  for (const i of W) {
    const p = RESET_PIN[base(i.cell)];
    if (p && i.pins[p] !== undefined) delete i.pins[p];
  }
  // 3. buffers, rewired past
  {
    const alias = new Map(), buffers = new Set();
    for (const i of W) {
      if (!BUFFER.has(base(i.cell))) continue;
      const src = i.pins.A, dst = i.pins.X;
      if (src === undefined || dst === undefined) continue;
      alias.set(dst, src); buffers.add(i.ref);
    }
    const resolve = n => { const seen = new Set(); while (alias.has(n) && !seen.has(n)) { seen.add(n); n = alias.get(n); } return n; };
    W = W.filter(i => !buffers.has(i.ref));
    for (const i of W) for (const [p, n] of Object.entries(i.pins)) i.pins[p] = resolve(n);
  }

  const { driver, readers } = wire(W);
  // An edge's weight is the number of WIRES that cross, one per net, however
  // many cells on the far side read each of them. That count is the one thing
  // every picture and number is built on. `fan` keeps the reader count per
  // edge as well, for the black-box panels: it says how much a region leans
  // on what it reads, and nothing else should lay out or number by it.
  const edges = new Map(), fan = new Map();
  const bump = (m, k, w = 1) => m.set(k, (m.get(k) || 0) + w);
  for (const [net, d] of driver) {
    const a = reg.get(d);
    if (!a) continue;
    const seen = new Set();
    for (const r of readers.get(net) || []) {
      const b = reg.get(r);
      if (!b || b === a) continue;
      bump(fan, `${a}>${b}`);
      if (!seen.has(b)) { seen.add(b); bump(edges, `${a}>${b}`); }
    }
  }

  // the chip's own pins. An indexed bus is one node: eight near-identical
  // arrows into O[0]..O[7] say nothing eight times.
  const bus = id => id.replace(/\[\d+\]$/, "[0..7]");
  const ports = new Map();
  for (const [name, net] of Object.entries(nets.ports)) {
    if (name === "clk" || name === "rst_n" || POWER.has(name)) continue;
    if (driver.has(net)) {
      const a = reg.get(driver.get(net));
      if (a) { ports.set(bus(name), { id: bus(name), kind: "output" }); bump(edges, `${a}>${bus(name)}`); bump(fan, `${a}>${bus(name)}`); }
    } else {
      const hit = new Map();
      for (const r of readers.get(net) || []) { const b = reg.get(r); if (b) hit.set(b, (hit.get(b) || 0) + 1); }
      if (hit.size) {
        ports.set(bus(name), { id: bus(name), kind: "input" });
        for (const [b, w] of hit) { bump(edges, `${bus(name)}>${b}`); bump(fan, `${bus(name)}>${b}`, w); }
      }
    }
  }

  // The clock, put back as a node. It is stripped from the netlist above,
  // because a clkbuf's placement is not dataflow -- but the fact that a region
  // is clocked at all is worth saying, and it does not need the tree to say
  // it: a region with flops in it is a region the clock reaches, and the
  // number of flops is the number of clock wires that arrive. Inferred from
  // membership, not traced. It is marked `clock` so the drawing can hold it
  // apart from the wires that carry data.
  const flopsIn = {};
  for (const i of logic) {
    if (!isFlop(i)) continue;
    const g = reg.get(i.ref);
    if (g) flopsIn[g] = (flopsIn[g] || 0) + 1;
  }
  const clock = new Map();
  for (const [g, k] of Object.entries(flopsIn)) clock.set(`clk>${g}`, k);
  if (clock.size) ports.set("clk", { id: "clk", kind: "input", clock: true });

  const cells = {};
  for (const i of logic) { const g = reg.get(i.ref); if (g) cells[g] = (cells[g] || 0) + 1; }
  return { edges, fan, clock, ports: [...ports.values()], reg, cells, graph: W, driver, readers,
           clockCells, clockNets, logic, flopsIn };
}

/* ---- layout ---------------------------------------------------------------
   A small layered layout, in the shape ELK would give it: break the cycles,
   assign layers by longest path, order each layer by the median of its
   neighbours to cut crossings, then route. Fifteen nodes is well inside what
   the median heuristic handles, and doing it here keeps the drawing live, so
   it retints with the rest of the page. */

const NW = 150, NH = 44, PW = 96, PH = 26, GAPY = 38, GAPX = 26, LANE = 15, PAD = 24;

function layout(regions, ports, edges) {
  const nodes = [...regions.map(r => ({ id: r.id, kind: "region" })), ...ports];
  const has = new Set(nodes.map(n => n.id));
  const E = [...edges].map(([k, w]) => { const [a, b] = k.split(">"); return { a, b, w }; })
                      .filter(e => has.has(e.a) && has.has(e.b));

  // cycles: a DFS back edge is left out of the layering and drawn as a return
  const out = new Map(nodes.map(n => [n.id, []]));
  for (const e of E) out.get(e.a).push(e);
  const seen = new Map(nodes.map(n => [n.id, 0]));
  const walk = id => {
    seen.set(id, 1);
    for (const e of out.get(id)) {
      if (seen.get(e.b) === 1) e.back = true;
      else if (seen.get(e.b) === 0) walk(e.b);
    }
    seen.set(id, 2);
  };
  for (const n of nodes) if (!seen.get(n.id)) walk(n.id);
  const fwd = E.filter(e => !e.back);

  // longest path, with the chip's own inputs pinned to the top row and its
  // outputs to the bottom one, then everything pulled down as far as its
  // readers allow so nothing floats above the block that feeds it
  const layer = new Map(nodes.map(n => [n.id, 0]));
  for (let p = 0; p < nodes.length; p++) {
    let moved = false;
    for (const e of fwd) if (layer.get(e.b) < layer.get(e.a) + 1) { layer.set(e.b, layer.get(e.a) + 1); moved = true; }
    if (!moved) break;
  }
  for (const n of ports) if (n.kind === "input") layer.set(n.id, 0);
  for (let p = 0; p < nodes.length; p++) {
    let moved = false;
    for (const n of nodes) {
      if (n.kind === "input") continue;
      const o = fwd.filter(e => e.a === n.id);
      if (!o.length) continue;
      const lim = Math.min(...o.map(e => layer.get(e.b))) - 1;
      if (lim > layer.get(n.id)) { layer.set(n.id, lim); moved = true; }
    }
    if (!moved) break;
  }
  const last = Math.max(...layer.values());
  for (const n of ports) if (n.kind === "output") layer.set(n.id, last);

  // ordering: median of the neighbours in the layer above, then below, twelve
  // sweeps, which is enough to settle a graph this size
  const rows = [];
  for (const n of nodes) (rows[layer.get(n.id)] ||= []).push(n.id);
  const pos = new Map();
  rows.forEach(r => r.forEach((id, i) => pos.set(id, i)));
  const up = new Map(nodes.map(n => [n.id, []])), down = new Map(nodes.map(n => [n.id, []]));
  for (const e of fwd) { down.get(e.a).push(e.b); up.get(e.b).push(e.a); }
  const median = (id, nb) => {
    const v = nb.get(id).map(x => pos.get(x)).sort((a, b) => a - b);
    return v.length ? v[(v.length - 1) >> 1] : pos.get(id);
  };
  for (let s = 0; s < 12; s++) {
    const nb = s % 2 === 0 ? up : down;
    const seq = s % 2 === 0 ? rows.map((_, i) => i).slice(1) : rows.map((_, i) => i).slice(0, -1).reverse();
    for (const l of seq) {
      rows[l].sort((a, b) => median(a, nb) - median(b, nb));
      rows[l].forEach((id, i) => pos.set(id, i));
    }
    // then a transpose pass: swap adjacent pairs while it removes crossings
    const cross = () => fwd.reduce((n, e) => n + fwd.filter(f =>
      layer.get(f.a) === layer.get(e.a) && layer.get(f.b) === layer.get(e.b) &&
      (pos.get(f.a) - pos.get(e.a)) * (pos.get(f.b) - pos.get(e.b)) < 0).length, 0);
    for (const row of rows) for (let i = 0; i + 1 < row.length; i++) {
      const c = cross();
      [row[i], row[i + 1]] = [row[i + 1], row[i]];
      row.forEach((id, j) => pos.set(id, j));
      if (cross() >= c) { [row[i], row[i + 1]] = [row[i + 1], row[i]]; row.forEach((id, j) => pos.set(id, j)); }
    }
  }

  // coordinates, x measured from the centre line
  const kind = Object.fromEntries(nodes.map(n => [n.id, n.kind]));
  const w = id => kind[id] === "region" ? NW : PW, h = id => kind[id] === "region" ? NH : PH;
  const at = {};
  let y = PAD;
  for (const row of rows) {
    const rh = Math.max(...row.map(h));
    let x = -(row.reduce((a, id) => a + w(id), 0) + GAPX * (row.length - 1)) / 2;
    for (const id of row) { at[id] = { x: x + w(id) / 2, y: y + rh / 2, w: w(id), h: h(id) }; x += w(id) + GAPX; }
    y += rh + GAPY;
  }
  const H = y - GAPY + PAD;
  const half = Math.max(...Object.values(at).map(a => Math.abs(a.x) + a.w / 2));

  // A block read by nearly everything is a broadcast, not a chain of arrows:
  // give it a rail down the margin with a stub into each reader. The phase and
  // the input pad between them account for fifteen of the twenty long edges.
  const span = e => layer.get(e.b) - layer.get(e.a);
  const longOut = new Map();
  for (const e of fwd) if (span(e) > 1) longOut.set(e.a, (longOut.get(e.a) || 0) + 1);
  const rails = [...longOut].filter(([, n]) => n >= 4).map(([id]) => id);
  const lane = new Map(), slot = new Map();
  let k = 0;
  const place = key => { slot.set(key, k); lane.set(key, (k % 2 ? 1 : -1) * (half + PAD + (Math.floor(k++ / 2) + 1) * LANE)); };
  for (const id of rails) place(id);
  for (const e of fwd) if (span(e) > 1 && !rails.includes(e.a)) place(e);
  const outer = Math.max(half + PAD, ...[...lane.values()].map(Math.abs));
  return { nodes, rows, at, E, layer, rails, lane, slot, H, W: 2 * (outer + PAD), outer, kind };
}

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** The graph as SVG. Colour comes from the caller, so a scheme change retints
    it along with everything else. */
export function mapSvg({ edges, ports, cells }, regions, colourOf, nameOf) {
  const L = layout(regions, ports, edges);
  const { at, lane, slot, rails, layer, outer, W, H } = L;
  const X = x => (x + W / 2).toFixed(1);
  const hue = id => colourOf[id] || "var(--ink-2)";
  const idx = Object.fromEntries(regions.map((r, i) => [r.id, i]));
  const widest = Math.max(...L.E.map(e => e.w));

  let s = `<svg class="map" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" xmlns="http://www.w3.org/2000/svg">`;
  s += "<defs>" + regions.map((r, i) =>
    `<marker id="ra${i}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">` +
    `<path d="M0 0L10 5L0 10z" fill="${colourOf[r.id]}"/></marker>`).join("") +
    `<marker id="raio" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">` +
    `<path d="M0 0L10 5L0 10z" fill="var(--ink-2)"/></marker></defs>`;

  // Every horizontal leg runs in the gap between two rows and every vertical
  // one in a margin lane, so a wire reaching past four blocks passes around
  // them instead of through them.
  // Six wires arriving at one row would otherwise share a single line in the
  // gap above it, so each routed wire gets its own line, spread across the gap
  // by the order its lane was assigned.
  const step = i => ((i % 7) - 3) * 4.5;
  const above = (id, i = 0) => (at[id].y - at[id].h / 2 - GAPY / 2 + step(i)).toFixed(1);
  const below = (id, i = 0) => (at[id].y + at[id].h / 2 + GAPY / 2 + step(i)).toFixed(1);
  for (const e of L.E) {
    const A = at[e.a], B = at[e.b], tip = (B.y - B.h / 2 - 5).toFixed(1);
    let d, far = false;
    if (e.back) {
      d = `M${X(A.x)} ${below(e.a)} H${X(-outer)} V${below(e.b)} H${X(B.x)} V${(B.y + B.h / 2 + 5).toFixed(1)}`;
    } else if (layer.get(e.b) - layer.get(e.a) > 1) {   // an adjacent row is reached straight down, rail or not
      const key = rails.includes(e.a) ? e.a : e;
      const x = lane.get(key), side = Math.sign(x), i = slot.get(key);
      const into = B.x + side * Math.max(0, B.w / 2 - 14);
      d = `M${X(A.x + side * Math.max(0, A.w / 2 - 14))} ${below(e.a, i)} H${X(x)} V${above(e.b, i)} H${X(into)} V${tip}`;
      far = true;
    } else {
      d = `M${X(A.x)} ${(A.y + A.h / 2).toFixed(1)} C${X(A.x)} ${A.y + A.h / 2 + 16} ${X(B.x)} ${B.y - B.h / 2 - 16} ${X(B.x)} ${tip}`;
    }
    s += `<path class="me${far ? " far" : ""}" d="${d}" stroke="${hue(e.a)}" stroke-width="${(0.9 + 2.4 * Math.sqrt(e.w / widest)).toFixed(2)}" ` +
         `marker-end="url(#ra${e.a in idx ? idx[e.a] : "io"})"><title>${esc(e.a)} to ${esc(e.b)}: ${e.w} wire${e.w === 1 ? "" : "s"}</title></path>`;
  }

  // a rail carries one block's fan-out, so say whose it is at the top of it
  for (const id of rails) {
    const x = lane.get(id), a = at[id];
    s += `<text class="mrl" x="${X(x)}" y="${(a.y + 4).toFixed(1)}" fill="${hue(id)}" ` +
         `text-anchor="${x < 0 ? "start" : "end"}" dx="${x < 0 ? 4 : -4}">${esc(id)}</text>`;
  }

  for (const n of L.nodes) {
    const a = at[n.id], x = X(a.x - a.w / 2), y = (a.y - a.h / 2).toFixed(1);
    if (n.kind === "region") {
      s += `<rect class="mr" x="${x}" y="${y}" width="${a.w}" height="${a.h}" rx="7" fill="${hue(n.id)}" stroke="${hue(n.id)}"/>` +
           `<text class="ml" x="${X(a.x)}" y="${(a.y - 2).toFixed(1)}" fill="${hue(n.id)}">${n.id}  ${esc(nameOf[n.id])}</text>` +
           `<text class="mn" x="${X(a.x)}" y="${(a.y + 11).toFixed(1)}">${cells[n.id] || 0} cells</text>`;
    } else {
      s += `<rect class="mp" x="${x}" y="${y}" width="${a.w}" height="${a.h}" rx="13"/>` +
           `<text class="mpl" x="${X(a.x)}" y="${(a.y + 4).toFixed(1)}">${esc(n.id)}</text>`;
    }
  }
  return s + "</svg>";
}

/* ---- trophic layout --------------------------------------------------------

   Where a block sits in the flow, as a number. Not a layer index: the
   hierarchical level of a directed graph, from

     (Lambda - A - A^T) h = k_in - k_out,   Lambda = diag(k_in + k_out)

   which is the standard generalisation of an ecosystem's trophic level to a
   graph with cycles in it. Longest-path layering has to break a cycle before
   it can count, and the two it would break here -- the counters writing back
   to the phase -- are real feedback, not noise. This gives every node a
   continuous level instead, so the reflow is a move rather than a re-layer,
   and the feedback edges simply run backwards.

   The clock is left out of the solve. It reaches ten of the eleven blocks, so
   including it would pull the whole graph flat toward one node, and it is not
   dataflow anyway.

   x comes from that level, with the chip's own inputs pinned to the left edge
   and its outputs to the right. y is barycentre: a few sweeps putting each
   node at the mean of its neighbours, then pushing apart anything that ended
   up on top of something else. */
function levels(ids, E) {
  const n = ids.length, at = new Map(ids.map((d, i) => [d, i]));
  const A = Array.from({ length: n }, () => new Float64Array(n));
  for (const e of E) A[at.get(e.a)][at.get(e.b)] += e.w;
  const kin = new Float64Array(n), kout = new Float64Array(n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { kout[i] += A[i][j]; kin[j] += A[i][j]; }
  // L h = v, singular by a constant, so node 0 is pinned and the answer shifted
  const L = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) =>
    (i === j ? kin[i] + kout[i] : 0) - A[i][j] - A[j][i]));
  const v = Array.from({ length: n }, (_, i) => kin[i] - kout[i]);
  const idx = [...Array(n).keys()].slice(1);
  const m = idx.length;
  const M = idx.map((i, r) => { const row = idx.map(j => L[i][j]); row.push(v[i]); return row; });
  for (let c = 0; c < m; c++) {                       // Gaussian elimination, partial pivot
    let p = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-9) continue;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < m; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (!f) continue;
      for (let k = c; k <= m; k++) M[r][k] -= f * M[c][k];
    }
  }
  const h = new Float64Array(n);
  idx.forEach((i, r) => { h[i] = Math.abs(M[r][r]) < 1e-9 ? 0 : M[r][m] / M[r][r]; });
  const lo = Math.min(...h), hi = Math.max(...h);
  return Object.fromEntries(ids.map((d, i) => [d, hi > lo ? (h[i] - lo) / (hi - lo) : 0.5]));
}

/** Node -> {x, y} in [0,1], for the beat where the die drops away and the
    graph orders itself by flow.

    x follows the trophic level, but spread by RANK as well as by value: the
    eleven blocks sit between levels 0.18 and 0.73, and placed on raw level
    alone they bunch in the middle third of the frame with nothing at either
    end. y starts from where each block sits on the die, so the reflow reads as
    the same objects rearranging rather than as a new picture, then barycentre
    sweeps pull each node toward its neighbours and a separation pass pushes
    apart anything that ends up on top of something else. */
export function trophicLayout(regions, ports, edges, seed = {}) {
  /* Sorted, so that nothing downstream can depend on the order the regions
     happen to be listed in. The relaxation updates node by node, so iterating
     them in a different order reaches a different fixed point -- which is how
     renumbering the regions by trophic level, a change to their names and
     nothing else, silently redrew the whole diagram. */
  const ids = [...regions.map(r => r.id), ...ports.map(p => p.id)].sort();
  const has = new Set(ids);
  const E = [...edges].map(([k, w]) => { const [a, b] = k.split(">"); return { a, b, w }; })
                      .filter(e => has.has(e.a) && has.has(e.b));
  const h = levels(ids, E);
  const kind = Object.fromEntries(ports.map(p => [p.id, p.kind]));
  const mid = ids.filter(d => !kind[d]).sort((a, b) => h[a] - h[b]);
  const rank = Object.fromEntries(mid.map((d, i) => [d, mid.length > 1 ? i / (mid.length - 1) : 0.5]));
  const x = {};
  for (const id of ids)
    x[id] = kind[id] === "input" ? 0 : kind[id] === "output" ? 1
          : 0.13 + 0.74 * (0.35 * h[id] + 0.65 * rank[id]);

  /* y is chosen by measuring the thing the reader actually sees: how many
     edges cross. A barycentre relaxation alone lands wherever its starting
     point leads -- one block, the phase, is wired to nine others and drags the
     rest into a band -- so this runs the relaxation from many starts and keeps
     the arrangement with the fewest crossings. Fifteen nodes, so it costs
     nothing; the generator is seeded, so the layout is the same every load. */
  const nb = Object.fromEntries(ids.map(d => [d, []]));
  for (const e of E) { nb[e.a].push([e.b, e.w]); nb[e.b].push([e.a, e.w]); }
  const side = (p, q, r) => (r[1] - p[1]) * (q[0] - p[0]) - (q[1] - p[1]) * (r[0] - p[0]);
  /* Crossings alone would be minimised by a straight line -- a line has none --
     so nodes sitting on top of each other are charged for too. Two blocks with
     nothing between them in x have to be a readable distance apart in y. */
  const score = yy => {
    const seg = E.map(e => [[x[e.a], yy[e.a]], [x[e.b], yy[e.b]]]);
    let n = 0;
    for (let i = 0; i < seg.length; i++) for (let j = i + 1; j < seg.length; j++) {
      const [A, B] = seg[i], [C, D] = seg[j];
      if (side(A, B, C) * side(A, B, D) < 0 && side(C, D, A) * side(C, D, B) < 0) n++;
    }
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const p = ids[i], q = ids[j];
      const dx = Math.abs(x[p] - x[q]), dy = Math.abs(yy[p] - yy[q]);
      if (dx > 0.14) continue;
      const want = 0.11 * (1 - dx / 0.14);
      if (dy < want) n += 6 * (want - dy) / want;
    }
    /* And a wire costs its own length. Crossings and overlap alone are both
       paid off by flinging a block out of the way -- the star counter ended up
       alone at the bottom with four edges swooping down to it, which has no
       crossings and reads terribly. */
    for (const e of E) n += 2.5 * Math.abs(yy[e.a] - yy[e.b]);
    return n;
  };
  const relax = start => {
    const yy = { ...start };
    const GAP = 0.1, NEAR = 0.15;
    for (let s = 0; s < 150; s++) {
      for (const d of ids) {
        if (!nb[d].length) continue;
        let num = 0, den = 0;
        for (const [o, w] of nb[d]) { const k = Math.sqrt(w); num += k * yy[o]; den += k; }
        yy[d] = 0.5 * (num / den) + 0.5 * yy[d];
      }
      const col = [...ids].sort((p, q) => yy[p] - yy[q]);
      for (let i = 1; i < col.length; i++) {
        const p = col[i - 1], q = col[i];
        const gap = Math.abs(x[p] - x[q]) < 1e-6 ? 0.16 : GAP;
        if (Math.abs(x[p] - x[q]) > NEAR || yy[q] - yy[p] >= gap) continue;
        const push = (gap - (yy[q] - yy[p])) / 2;
        yy[p] -= push; yy[q] += push;
      }
    }
    return yy;
  };
  /* Each random start draws one number per node, and drawing them in `ids`
     order made the whole search depend on the order the regions happen to be
     listed in: renumbering them by trophic level, which changed nothing about
     the graph, picked a different winner and redrew the diagram. The draws are
     keyed on the node's own name instead, so the picture is a function of the
     circuit and nothing else. */
  const hash = (t, k) => {
    let h = 2166136261 ^ k;
    for (const c of String(t)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return ((h >>> 0) % 100000) / 100000;
  };
  let y = null, best = Infinity;
  const byName = [...ids].sort();
  const starts = [Object.fromEntries(byName.map((d, i) => [d, seed[d] ?? (i + 0.5) / ids.length])),
                  Object.fromEntries(ids.map(d => [d, x[d]])),
                  Object.fromEntries(byName.map((d, i) => [d, (i + 0.5) / ids.length]))];
  for (let k = 0; k < 60; k++) starts.push(Object.fromEntries(ids.map(d => [d, hash(d, k)])));
  /* Only the ORDER of the blocks in y carries anything -- each sits at its own
     x, so the spacing is free -- and the relaxation kept stranding one of them
     a third of the frame away from the rest, which the normalisation then
     amplified. So each arrangement is canonicalised to evenly spaced ranks
     before it is judged, and the arrangement scored is the one drawn. */
  const canon = yy => {
    const out = {};
    const core = ids.filter(d => !kind[d]).sort((a, b) => yy[a] - yy[b]);
    const span = i => 0.06 + 0.88 * (core.length > 1 ? i / (core.length - 1) : 0.5);
    core.forEach((d, i) => { out[d] = span(i); });
    // A pin sits level with the blocks it talks to: the mean of their placed
    // heights. Pins on one side are then kept a readable distance apart, so
    // two outputs never print on top of each other, and nothing is pushed to
    // the very edge of the frame.
    for (const side of ["input", "output"]) {
      const pins = ids.filter(d => kind[d] === side);
      for (const d of pins) {
        const with_ = nb[d].map(([o]) => out[o]).filter(v => v !== undefined);
        out[d] = with_.length ? with_.reduce((a, v) => a + v, 0) / with_.length : 0.5;
      }
      pins.sort((a, b) => out[a] - out[b]);
      const GAPP = 0.16;
      for (let i = 1; i < pins.length; i++)
        if (out[pins[i]] - out[pins[i - 1]] < GAPP) out[pins[i]] = out[pins[i - 1]] + GAPP;
      const over = out[pins[pins.length - 1]] - 0.9;
      if (over > 0) for (const d of pins) out[d] -= over;
      for (const d of pins) out[d] = Math.max(0.1, out[d]);
    }
    return out;
  };
  for (const st of starts) {
    const yy = canon(relax(st)), c = score(yy);
    if (c < best) { best = c; y = yy; }
  }

  const out = Object.fromEntries(ids.map(d => [d, { x: x[d], y: y[d], level: h[d] }]));
  // The clock is kept out of the solve -- it reaches ten of eleven blocks and
  // would flatten the whole graph toward one node -- but it still has to go
  // somewhere, so it joins the other inputs on the left edge, below them.
  out.clk = { x: 0, y: 0.5, level: 0 };
  const ins = ports.filter(p => p.kind === "input").map(p => out[p.id].y);
  if (ins.length) out.clk.y = Math.min(0.98, Math.max(...ins) + 0.16);
  return out;
}

/* ---- the gate-level flow ----------------------------------------------------

   Every logic cell as a node, placed the way the region graph is: x is the
   gate's trophic level, how far through the computation it stands, and y is
   chosen to keep its wires short. A flop is a source, since its Q holds last
   cycle's value, so what is drawn is the combinational depth between flops,
   with the chip's inputs at the left edge and its outputs at the right. The
   clock tree, reset and power are left out. Buffers stay in: the beat that
   removes them comes later. */
export function gateFlow(nets) {
  const logic = nets.instances.filter(i => !INERT.has(base(i.cell)));
  const byRef = new Map(logic.map(i => [i.ref, i]));
  // the clock tree: buffers reachable from clk through buffers only
  const { readers: r0 } = wire(logic);
  const clockCells = new Set(), clockNets = new Set([nets.ports.clk]);
  const q = [nets.ports.clk];
  while (q.length) for (const r of r0.get(q.pop()) || []) {
    const inst = byRef.get(r);
    if (clockCells.has(r) || !BUFFER.has(base(inst.cell))) continue;
    clockCells.add(r);
    for (const [p, n] of Object.entries(inst.pins))
      if (OUTPINS.has(p) && !clockNets.has(n)) { clockNets.add(n); q.push(n); }
  }
  const skip = new Set([...clockNets, nets.ports.rst_n, nets.ports.VPWR, nets.ports.VGND]);
  const W = logic.filter(i => !clockCells.has(i.ref));
  const { driver, readers } = wire(W);
  /* clk is an input like any other here. The tree itself went out with the
     buffers, so what is drawn is the fact that every flip-flop has a clock
     pin -- inferred, not traced. It is deliberately left out of the LEVEL
     solve below: a source feeding 92 of 695 nodes drags them all to one
     level and flattens the picture. */
  const inPorts = ["I", "enable", "clk"].filter(k => nets.ports[k] !== undefined);
  const dataIn = inPorts.filter(k => k !== "clk");
  const outPorts = Object.keys(nets.ports).filter(k => /^(O\[\d+\]|success)$/.test(k));

  // one edge per (driver, reader) pair, plus the chip's own pins
  const edges = [], feeds = new Map(W.map(i => [i.ref, []]));
  for (const [net, d] of driver) {
    if (skip.has(net)) continue;
    for (const r of readers.get(net) || []) {
      if (r === d || !feeds.has(r)) continue;
      edges.push([d, r]); feeds.get(r).push(d);
    }
  }
  for (const k of dataIn)
    for (const r of readers.get(nets.ports[k]) || []) if (feeds.has(r)) { edges.push([k, r]); feeds.get(r).push(k); }
  for (const i of W) if (isFlop(i)) edges.push(["clk", i.ref]);      // not into `feeds`: see above
  for (const k of outPorts) { const d = driver.get(nets.ports[k]); if (d !== undefined) edges.push([d, k]); }

  /* ---- level ---------------------------------------------------------------

     The hierarchical level of a directed graph, from

       (Lambda - A - A^T) h = k_in - k_out,   Lambda = diag(k_in + k_out)

     the same solve the region graph uses, so the two pictures are built the
     same way. Solved by conjugate gradient on the sparse operator: the dense
     elimination in `levels` is fine for eleven nodes and hopeless for seven
     hundred.

     Pinning every flop at zero instead -- which this did first -- makes a
     column mean "combinational depth since the last flop", which is a true
     thing to draw but puts all 92 of them in one wall down the left edge with
     the whole circuit fanning out of it. The Laplacian spreads them through
     the depth and lets the feedback run backwards as a visible edge.

     clk is left out: 92 edges from one source drags everything it touches to
     a single level. */
  const ids = [...inPorts, ...W.map(i => i.ref), ...outPorts];
  const idx = new Map(ids.map((d, i) => [d, i]));
  const n = ids.length;
  const kin = new Float64Array(n), kout = new Float64Array(n);
  const ea = [], eb = [];
  for (const [a, b] of edges) {
    if (a === "clk") continue;
    const i = idx.get(a), j = idx.get(b);
    if (i === undefined || j === undefined) continue;
    ea.push(i); eb.push(j); kout[i]++; kin[j]++;
  }
  const applyL = (x, y) => {
    for (let i = 0; i < n; i++) y[i] = (kin[i] + kout[i]) * x[i];
    for (let k = 0; k < ea.length; k++) { y[ea[k]] -= x[eb[k]]; y[eb[k]] -= x[ea[k]]; }
  };
  const h = new Float64Array(n), r = new Float64Array(n), pv = new Float64Array(n), Ap = new Float64Array(n);
  for (let i = 0; i < n; i++) { r[i] = kin[i] - kout[i]; pv[i] = r[i]; }
  let rs = r.reduce((a, x) => a + x * x, 0);
  for (let it = 0; it < 3000 && rs > 1e-10; it++) {
    applyL(pv, Ap);
    let pAp = 0;
    for (let i = 0; i < n; i++) pAp += pv[i] * Ap[i];
    if (Math.abs(pAp) < 1e-18) break;
    const al = rs / pAp;
    for (let i = 0; i < n; i++) { h[i] += al * pv[i]; r[i] -= al * Ap[i]; }
    const rs2 = r.reduce((a, x) => a + x * x, 0);
    for (let i = 0; i < n; i++) pv[i] = r[i] + (rs2 / rs) * pv[i];
    rs = rs2;
  }

  /* x is mostly the ORDER of those levels, not their value. They come out bell
     shaped -- more than half the gates inside a fifth of the range -- so on
     value alone the circuit bunches into the middle with empty margins. A
     little of the value is mixed back so real gaps still read. */
  const rank = new Float64Array(n);
  [...Array(n).keys()].sort((a, b) => h[a] - h[b]).forEach((i, k) => { rank[i] = k / (n - 1); });
  const lo = Math.min(...h), hi = Math.max(...h);
  const X = new Float64Array(n);
  for (let i = 0; i < n; i++) X[i] = 0.72 * rank[i] + 0.28 * (hi > lo ? (h[i] - lo) / (hi - lo) : 0.5);
  { const a = Math.min(...X), b = Math.max(...X);
    for (let i = 0; i < n; i++) X[i] = b > a ? (X[i] - a) / (b - a) : 0.5; }
  for (const k of inPorts) X[idx.get(k)] = 0;
  for (const k of outPorts) X[idx.get(k)] = 1;

  /* y starts from where each cell sits on the die, so the reflow reads as the
     same objects rearranging, then each node is pulled toward the MEDIAN of
     its neighbours -- median, so one far-off neighbour cannot drag it. */
  const byRefAll = byRef;
  const Y = new Float64Array(n);
  const [, dy0, , dy1] = nets.die.bbox;
  ids.forEach((id, i) => {
    const inst = typeof id === "number" ? byRefAll.get(id) : null;
    Y[i] = inst ? 1 - (inst.y - dy0) / (dy1 - dy0) : 0.5;
  });
  const nb = Array.from({ length: n }, () => []);
  for (let k = 0; k < ea.length; k++) { nb[ea[k]].push(eb[k]); nb[eb[k]].push(ea[k]); }
  const buf = new Float64Array(n);
  for (let s2 = 0; s2 < 90; s2++) {
    buf.set(Y);
    for (let i = 0; i < n; i++) {
      if (!nb[i].length) continue;
      const v2 = nb[i].map(j => Y[j]).sort((a, b) => a - b);
      const med = v2.length % 2 ? v2[(v2.length - 1) >> 1] : (v2[v2.length / 2 - 1] + v2[v2.length / 2]) / 2;
      buf[i] = 0.55 * med + 0.45 * Y[i];
    }
    Y.set(buf);
  }
  /* Separation pushes apart only what overlaps. Spreading each column across
     the full height instead throws the ordering away and puts a two-node
     column at the very top and bottom. */
  const COLS = 56, bucket = Array.from({ length: COLS + 1 }, () => []);
  for (let i = 0; i < n; i++) bucket[Math.round(X[i] * COLS)].push(i);
  for (const col of bucket) {
    const k = col.length;
    if (k < 2) continue;
    col.sort((a, b) => Y[a] - Y[b]);
    const gap = Math.min(0.02, 0.94 / (k - 1));
    for (let q = 1; q < k; q++) if (Y[col[q]] < Y[col[q - 1]] + gap) Y[col[q]] = Y[col[q - 1]] + gap;
    const over = Y[col[k - 1]] - 0.97;
    if (over > 0) {
      for (const i of col) Y[i] -= over;
      for (let q = k - 2; q >= 0; q--) if (Y[col[q]] > Y[col[q + 1]] - gap) Y[col[q]] = Y[col[q + 1]] - gap;
    }
    const under = 0.03 - Y[col[0]];
    if (under > 0) for (const i of col) Y[i] += under;
  }

  const pos = {};
  ids.forEach((id, i) => { pos[id] = [X[i], Y[i]]; });
  return { pos, edges, ports: { in: inPorts, out: outPorts } };
}
