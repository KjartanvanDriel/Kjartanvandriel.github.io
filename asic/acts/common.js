/* Shared between the acts. */
import { theme } from "../src/theme.js";

/** The mark on the die: three concentric rings on met2, lower left. Wherever
    the whole die is in frame it is lit in the accent, the same as on the
    opening, so the reader can always find it. A box in die coordinates and a
    colour, for the `spot` field. A function, not a constant: the theme is
    reloaded for the chosen scheme after this module is imported, and the acts
    run after that. */
export const logo = () => [34, 34.5, 53, 53, theme.accent];

/** Nothing above met3, from the layer tour to the end of the piece.

    met4 has 45 polygons and met5 has 18: they are the power straps crossing
    the whole die, and once the reader has been shown the stack they are a
    distraction that hides the routing underneath. met3 has 811 and is real
    signal routing, so it stays.

    It lives here rather than in one act because that is how it came undone
    before: Act II removed the bars with a local constant, Act III was written
    afterwards with its own layer specs, and the bars came back. Spread this
    LAST into any spec, so it wins.

    The only labels above met3 are VGND and VPWR; every signal pad the piece
    names -- I, O[0..7], clk, enable, rst_n, success -- sits on met3. */
export const ABOVE_MET3 = { via3: 0, met4: 0, via4: 0, met5: 0 };
