// SPDX-License-Identifier: MIT
/**
 * Pure Snake game rules (Nokia-style): grid, walls kill, grow on food.
 * No Vue / timers — step and direction helpers only.
 */

export type Point = { x: number; y: number };
export type Direction = "up" | "down" | "left" | "right";
export type Phase = "ready" | "playing" | "dead" | "won";

export const GRID_SIZE = 12;
/** Total cells on the board — filling all of them is a perfect clear. */
export const CELL_COUNT = GRID_SIZE * GRID_SIZE;
/** Classic reward for clearing the grid. */
export const RICKROLL_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

/** Default board edge in CSS pixels (12 × 14). */
export const DEFAULT_BOARD_SIZE = GRID_SIZE * 14;
export const MIN_BOARD_SIZE = GRID_SIZE * 10;
/** Manual / persisted size cap (host-driven resize may go larger). */
export const MAX_BOARD_SIZE = GRID_SIZE * 32;
/** Upper bound when the host card drives board size. */
export const MAX_HOST_BOARD_SIZE = GRID_SIZE * 96;

/** Size the HUD from the LCD, before the HUD consumes any field height.
 * The LCD has 8px padding; the HUD adds one font-height plus a 6px gap. */
export function hostHudFontSize(width: number, height: number): number {
  return Math.max(11, Math.min(28, Math.round(Math.min((width - 16) / 14, (height - 22) / 15))));
}

/** Clamp board size into allowed bounds (any integer — canvas scales cells). */
export function clampBoardSize(size: number, max = MAX_BOARD_SIZE): number {
  const raw = Number.isFinite(size) ? size : DEFAULT_BOARD_SIZE;
  return Math.min(max, Math.max(MIN_BOARD_SIZE, Math.round(raw)));
}

export interface SnakeGame {
  snake: Point[];
  food: Point;
  direction: Direction;
  pendingDirection: Direction;
  score: number;
  phase: Phase;
}

const OPPOSITE: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

const DELTA: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** True when two cells share the same coordinates. */
export function pointsEqual(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

/** True when the cell is occupied by any snake segment. */
export function occupies(snake: Point[], cell: Point): boolean {
  return snake.some((p) => pointsEqual(p, cell));
}

/** Pick a free cell for food; returns null if the board is full (win). */
export function pickFood(snake: Point[], gridSize = GRID_SIZE, rng = Math.random): Point | null {
  const free: Point[] = [];
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const cell = { x, y };
      if (!occupies(snake, cell)) free.push(cell);
    }
  }
  if (free.length === 0) return null;
  return free[Math.floor(rng() * free.length)]!;
}

/** Fresh game: short snake in the middle, food elsewhere, waiting to start. */
export function createGame(rng = Math.random): SnakeGame {
  const mid = Math.floor(GRID_SIZE / 2);
  const snake: Point[] = [
    { x: mid, y: mid },
    { x: mid - 1, y: mid },
    { x: mid - 2, y: mid },
  ];
  const food = pickFood(snake, GRID_SIZE, rng) ?? { x: mid + 2, y: mid };
  return {
    snake,
    food,
    direction: "right",
    pendingDirection: "right",
    score: 0,
    phase: "ready",
  };
}

/**
 * Queue the next move. Ignores 180° relative to the pending heading so a
 * queued turn can still be corrected before the next step (more reactive).
 */
export function queueDirection(game: SnakeGame, next: Direction): SnakeGame {
  if (game.phase === "dead" || game.phase === "won") return game;
  if (next === OPPOSITE[game.pendingDirection]) return game;
  return { ...game, pendingDirection: next };
}

/** True when the snake occupies every cell (perfect clear). */
export function isGridFull(snake: Point[], gridSize = GRID_SIZE): boolean {
  return snake.length >= gridSize * gridSize;
}

/** Advance one tick: move head, grow on food, die on wall/self. */
export function step(game: SnakeGame, rng = Math.random): SnakeGame {
  if (game.phase !== "playing") return game;

  const direction = game.pendingDirection;
  const delta = DELTA[direction];
  const head = game.snake[0]!;
  const nextHead: Point = { x: head.x + delta.x, y: head.y + delta.y };

  // Wall collision
  if (
    nextHead.x < 0 ||
    nextHead.y < 0 ||
    nextHead.x >= GRID_SIZE ||
    nextHead.y >= GRID_SIZE
  ) {
    return { ...game, direction, pendingDirection: direction, phase: "dead" };
  }

  const eating = pointsEqual(nextHead, game.food);
  // When not eating, the tail vacates — allow moving into the current tail cell.
  const bodyToCheck = eating ? game.snake : game.snake.slice(0, -1);
  if (occupies(bodyToCheck, nextHead)) {
    return { ...game, direction, pendingDirection: direction, phase: "dead" };
  }

  const snake = [nextHead, ...game.snake];
  if (!eating) snake.pop();

  if (eating) {
    const food = pickFood(snake, GRID_SIZE, rng);
    if (!food) {
      // Board filled — perfect clear (rickroll trigger in the UI layer).
      return {
        ...game,
        snake,
        direction,
        pendingDirection: direction,
        score: game.score + 1,
        phase: "won",
      };
    }
    return {
      ...game,
      snake,
      food,
      direction,
      pendingDirection: direction,
      score: game.score + 1,
    };
  }

  return {
    ...game,
    snake,
    direction,
    pendingDirection: direction,
  };
}

/** Normalize a persisted high score to a non-negative integer. */
export function normalizeHighScore(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/**
 * Return the new high score when `score` beats `current`, otherwise `current`.
 * Pure helper for assert tests and callers that persist separately.
 */
export function bestScore(current: number, score: number): number {
  return Math.max(normalizeHighScore(current), normalizeHighScore(score));
}

/** Map keyboard / button tokens to a direction, or null if unknown. */
export function directionFromKey(key: string): Direction | null {
  switch (key) {
    case "ArrowUp":
    case "w":
    case "W":
    case "up":
      return "up";
    case "ArrowDown":
    case "s":
    case "S":
    case "down":
      return "down";
    case "ArrowLeft":
    case "a":
    case "A":
    case "left":
      return "left";
    case "ArrowRight":
    case "d":
    case "D":
    case "right":
      return "right";
    default:
      return null;
  }
}
