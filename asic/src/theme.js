/* The palette, read out of theme.css so there is only ever one copy of it.
   Change a colour there and both the page and the chip pane follow. */

const css = getComputedStyle(document.documentElement);
const val = n => css.getPropertyValue(n).trim();
const ramp = (prefix, n) => Array.from({ length: n }, (_, i) => val(`${prefix}${i}`));

export const N_LAYERS = 15;

function read() {
  return {
  pane: val("--pane"),
  ink: val("--ink-3d"),
  substrate: val("--substrate"),
  sun: val("--sun"),
  accent: val("--accent"),
  oslo: ramp("--layer-", N_LAYERS),     // once the process is known
  grey: ramp("--grey-", N_LAYERS),      // before it is
  osloSeq: ramp("--oslo-seq-", 7),      // dark to light, for nets by hash
  live: val("--live"),
  pick: val("--pick"),   // something lifted out of the die                  // a net that is high while the run plays
  region: ramp("--region-", 11),        // one per region of the die
  tint: { A: val("--tint-a"), B: val("--tint-b"), X: val("--tint-x"),
          VPWR: val("--tint-power"), VGND: val("--tint-power") },
  };
}

/** Live values. `reloadTheme()` re-reads them in place after a scheme change,
    so every module holding `theme` sees the new colours without re-importing. */
export const theme = read();
export function reloadTheme() { Object.assign(theme, read()); return theme; }
