/* Flat rectangles laid over the die, one per standard-cell placement.
   Two uses so far: pick out one cell type, or colour every type. */

import { theme } from "./theme.js";
import { family } from "./overlays.js";
import { setOpacity } from "./subjects.js";

export class Marks {
  /**
   * @param placements  [{t: cellType, b: [x0,y0,x1,y1]}]
   * @param subject     the die
   * @param spec        "*" for every type, or one cell type, or several
   *                    joined by "|" -- a family, such as every buffer,
   *                    which is four cell types and one idea
   */
  constructor(placements, subject, spec) {
    this.group = new THREE.Group();
    this.hostKey = subject.key;          // the marks fade with the subject they lie on
    const y = subject.stackTop + Math.max(subject.W, subject.D) * 0.01;
    const types = [...new Set(placements.map(p => p.t))].sort();
    const wanted = new Set(spec.split("|"));
    // Every type its own colour, from the scheme's palettes and not a hue
    // wheel: the region ramp and the layer ramp give twenty-six, and each
    // further pass over them steps the lightness, so sixty-nine types stay
    // distinct while every one is a colour the piece already uses.
    // One colour per KIND of cell, from the region ramp: inverters, buffers,
    // ANDs, ORs, XORs, the and-or-invert families, muxes and flops. Sixty-nine
    // types each with a colour made the die a confetti; ten kinds read.
    const kinds = [...new Set(placements.map(p => family(p.t)))].sort();
    const own = t => theme.region[kinds.indexOf(family(t)) % theme.region.length];
    const colour = p => spec === "*" ? own(p.t) : theme.accent;
    this.colourOf = colour;

    for (const p of placements) {
      if (spec !== "*" && !wanted.has(p.t)) continue;
      const [a, b, c, d] = p.b;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(c - a, d - b),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(colour(p)),
          transparent: true, opacity: 0, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set((a + c) / 2, y, -(b + d) / 2);
      m.userData.p = p;
      this.group.add(m);
    }
    subject.root.add(this.group);
  }

  show(alpha) { for (const m of this.group.children) setOpacity(m.material, alpha); }

  /** Re-read the colours after a scheme change. */
  recolour() {
    for (const m of this.group.children) m.material.color.set(this.colourOf(m.userData.p));
  }
}

/** Every placement of one cell type, in die coordinates. */
export const placementsOf = (placements, type) => placements.filter(p => p.t === type);
