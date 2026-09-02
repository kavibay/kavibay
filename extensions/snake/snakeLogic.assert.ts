/**
 * Quick checks for Snake rules (run: npx tsx src/extensions/snake/snakeLogic.assert.ts).
 * Avoids node:assert so vue-tsc stays clean in the browser tsconfig.
 */
import {
  CELL_COUNT,
  GRID_SIZE,
  bestScore,
  clampBoardSize,
  createGame,
  isGridFull,
  normalizeHighScore,
  occupies,
  pickFood,
  queueDirection,
  step,
  type SnakeGame,
} from "./snakeLogic";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const fixedRng = () => 0;

const game = createGame(fixedRng);
assert(game.phase === "ready", "initial phase");
assert(game.snake.length === 3, "initial length");
assert(!occupies(game.snake, game.food), "food not on snake");

let playing: SnakeGame = { ...game, phase: "playing" };
playing = queueDirection(playing, "left");
assert(playing.pendingDirection === "right", "ignore 180 reverse");

playing = queueDirection(playing, "up");
assert(playing.pendingDirection === "up", "queue up");

let wallGame: SnakeGame = {
  snake: [{ x: 0, y: 0 }],
  food: { x: 5, y: 5 },
  direction: "left",
  pendingDirection: "left",
  score: 0,
  phase: "playing",
};
wallGame = step(wallGame);
assert(wallGame.phase === "dead", "wall kills");

let eat: SnakeGame = {
  snake: [
    { x: 2, y: 2 },
    { x: 1, y: 2 },
  ],
  food: { x: 3, y: 2 },
  direction: "right",
  pendingDirection: "right",
  score: 0,
  phase: "playing",
};
eat = step(eat, fixedRng);
assert(eat.score === 1, "score on eat");
assert(eat.snake.length === 3, "grow on eat");
assert(!occupies(eat.snake, eat.food), "new food free");

const full = Array.from({ length: 144 }, (_, i) => ({
  x: i % 12,
  y: Math.floor(i / 12),
}));
assert(pickFood(full) === null, "full board no food");

assert(normalizeHighScore(-3) === 0, "high score floor");
assert(normalizeHighScore(3.9) === 3, "high score floor int");
assert(bestScore(5, 3) === 5, "keep current best");
assert(bestScore(5, 9) === 9, "accept new best");
assert(clampBoardSize(167) === 167, "board keeps px");
assert(clampBoardSize(10) === GRID_SIZE * 10, "board min");

// 143 segments; head at (10,11) facing the last empty cell (11,11).
const almostFull: { x: number; y: number }[] = [];
for (let y = 0; y < GRID_SIZE; y++) {
  for (let x = 0; x < GRID_SIZE; x++) {
    if (x === GRID_SIZE - 1 && y === GRID_SIZE - 1) continue;
    almostFull.push({ x, y });
  }
}
const head = almostFull.pop()!;
almostFull.unshift(head);
let winGame: SnakeGame = {
  snake: almostFull,
  food: { x: GRID_SIZE - 1, y: GRID_SIZE - 1 },
  direction: "right",
  pendingDirection: "right",
  score: CELL_COUNT - 4,
  phase: "playing",
};
winGame = step(winGame, () => 0);
assert(winGame.phase === "won", "full grid wins");
assert(isGridFull(winGame.snake), "snake fills grid");
assert(winGame.snake.length === CELL_COUNT, "length is cell count");

console.log("snakeLogic.assert: ok");
