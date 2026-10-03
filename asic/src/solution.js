/* The board's one solution, and what the chip says to four different inputs.

   The patch map is read off the recording, the same eleven codes the figure
   `grid-patches` draws. Searching that map under the five rules -- two stars
   in every row, every column and every patch, none of the 22 touching, even
   diagonally -- gives exactly one board, which is what the prose claims.

   Each line below was then produced by driving the recovered netlist with
   that input: three cycles of reset, 121 bits on I with enable high, then
   enable low and O read as characters. Nothing here is quoted from the
   puzzle's own material. */

// eleven rows, the two columns holding that row's stars
export const SOLUTION = [[7, 9], [0, 5], [7, 9], [0, 2], [4, 6], [2, 8],
                         [4, 10], [1, 6], [3, 10], [5, 8], [1, 3]];

/** the 121 input bits of a board given as row -> two columns */
export const bitsOf = rows => {
  const b = new Array(121).fill(0);
  rows.forEach(([a, c], r) => { b[r * 11 + a] = 1; b[r * 11 + c] = 1; });
  return b;
};

// Two per row, two per column, two per patch -- and two of them touching, in
// row 0 and again in row 10. Found by local search over the same patch map;
// the chip's answer to it is the fifth message, and it is the only way any of
// the inputs tried reaches that one.
export const TOUCHING = [[7, 8], [3, 6], [0, 9], [5, 7], [2, 4], [0, 10], [5, 9], [1, 8], [6, 10], [1, 4], [2, 3]];

// what came back, in the order the figure lists them
export const ANSWERS = [
  { label: "every cell empty", stars: [], text: "EMPTY SKY", ok: 0 },
  { label: "every cell a star", stars: "all", text: "BIG BANG", ok: 0 },
  { label: "a star down the diagonal", stars: Array.from({ length: 11 }, (_, k) => k * 11 + k),
    text: "TRY AGAIN", ok: 0 },
  { label: "two per row, column and region, two touching", stars: "touching",
    text: "TWO\"NOT TOUCH", ok: 0 },   // the byte is 0x22, a double quote
  { label: "the solution", stars: "solution", text: "(* TWO STARS *)", ok: 1 },
];
