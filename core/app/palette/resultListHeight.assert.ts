import { sevenResultRowsHeight } from "./resultListHeight";

function assertEqual(actual: number, expected: number) {
  if (actual !== expected) throw new Error(`Expected ${expected}, got ${actual}`);
}

const rows = Array.from({ length: 10 }, (_, index) => ({ offsetTop: 8 + index * 40, offsetHeight: 40 }));
assertEqual(sevenResultRowsHeight(rows, 8), 288);
assertEqual(sevenResultRowsHeight(rows.slice(0, 7), 8), 296);
assertEqual(sevenResultRowsHeight(rows.slice(0, 6), 8), Infinity);
rows[6] = { offsetTop: 300, offsetHeight: 58 };
assertEqual(sevenResultRowsHeight(rows, 8), 358);
