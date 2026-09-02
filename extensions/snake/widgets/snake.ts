// SPDX-License-Identifier: MIT
import { computed, onScopeDispose, ref, shallowRef, type Ref } from "vue";
import {
  defineWidget,
  type WidgetContext,
} from "@sdk/contract/sdk";
import {
  DEFAULT_BOARD_SIZE,
  MAX_BOARD_SIZE,
  MAX_HOST_BOARD_SIZE,
  RICKROLL_URL,
  bestScore,
  clampBoardSize,
  createGame,
  normalizeHighScore,
  queueDirection,
  step,
  type Direction,
  type SnakeGame,
} from "../snakeLogic";

export const SNAKE_BOARD_DATA_KEY = "boardSize";
export const SNAKE_HIGH_SCORE_KEY = "highScore";

const STEP_MS = 100;
const MIN_STEP_GAP_MS = 16;

/** Instance that currently owns arrow / WASD keys. */
let keyboardOwnerId: string | null = null;

/** Claim keyboard focus for this Snake instance (called by the view). */
export function claimSnakeKeyboard(instanceId: string): void {
  keyboardOwnerId = instanceId;
}

/** True when this instance should handle window key events. */
export function ownsSnakeKeyboard(instanceId: string): boolean {
  return keyboardOwnerId === instanceId;
}

/** Shared high score; the extension-scoped store is loaded only once. */
const sharedHighScore = ref(0);
let highScoreHydration: Promise<void> | undefined;

function hydrateHighScore(ctx: WidgetContext): Promise<void> {
  if (!ctx.sharedData) return Promise.resolve();
  if (!highScoreHydration) {
    highScoreHydration = ctx.sharedData
      .get<unknown>(SNAKE_HIGH_SCORE_KEY)
      .then((raw) => {
        if (raw && typeof raw === "object" && "highScore" in raw) {
          sharedHighScore.value = normalizeHighScore(
            (raw as { highScore: unknown }).highScore,
          );
        } else {
          sharedHighScore.value = normalizeHighScore(raw);
        }
      })
      .catch(() => {
        // A missing or corrupt shared cell simply starts the score at zero.
      });
  }
  return highScoreHydration;
}

/** Duplicate only the durable per-instance board size. */
export function duplicateSnakeData(key: string, value: unknown): unknown {
  if (key !== SNAKE_BOARD_DATA_KEY) return value;
  const raw =
    value && typeof value === "object" && "boardSize" in value
      ? (value as { boardSize: unknown }).boardSize
      : value;
  return { boardSize: clampBoardSize(typeof raw === "number" ? raw : Number(raw)) };
}

export interface SnakeModel {
  game: Ref<SnakeGame>;
  score: Ref<number>;
  phase: Ref<SnakeGame["phase"]>;
  highScore: Ref<number>;
  boardSize: Ref<number>;
  start(): void;
  reset(): void;
  pause(): void;
  turn(direction: Direction): void;
  setBoardSize(size: number, options?: { hostDriven?: boolean }): void;
}

function persistedBoardSize(raw: unknown): number {
  if (raw && typeof raw === "object" && "boardSize" in raw) {
    return clampBoardSize(Number((raw as { boardSize: unknown }).boardSize));
  }
  return clampBoardSize(Number(raw));
}

export const snakeWidget = defineWidget({
  name: "snake",
  displayName: "Snake",
  description: "Classic Nokia-style Snake on a small grid.",
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 3, h: 3 },
  mode: "both",
  capabilities: { openExternal: true },
  duplicateData: true,
  duplicateDataTransform: duplicateSnakeData,
  component: {
    setup(ctx: WidgetContext): SnakeModel {
      const game = shallowRef<SnakeGame>(createGame());
      const boardSize = ref(DEFAULT_BOARD_SIZE);
      const score = computed(() => game.value.score);
      const phase = computed(() => game.value.phase);

      let rafId = 0;
      let accMs = 0;
      let lastFrameTs = 0;
      let lastStepAt = 0;
      let alive = true;

      function clearTick(): void {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        accMs = 0;
        lastFrameTs = 0;
      }

      function recordHighScore(scoreValue: number): void {
        const next = bestScore(sharedHighScore.value, scoreValue);
        if (next === sharedHighScore.value) return;
        sharedHighScore.value = next;
        void ctx.sharedData?.set(SNAKE_HIGH_SCORE_KEY, { highScore: next });
      }

      function celebrateWin(): void {
        void ctx.openExternal?.open(RICKROLL_URL).catch(() => {
          // The win state remains useful when opening a browser is unavailable.
        });
      }

      function applyStep(): void {
        game.value = step(game.value);
        lastStepAt = performance.now();
        if (game.value.phase === "dead" || game.value.phase === "won") {
          clearTick();
          recordHighScore(game.value.score);
          if (game.value.phase === "won") celebrateWin();
        }
      }

      function onFrame(timestamp: number): void {
        rafId = 0;
        if (game.value.phase !== "playing" || !alive) return;
        if (!lastFrameTs) lastFrameTs = timestamp;
        const delta = Math.min(100, timestamp - lastFrameTs);
        lastFrameTs = timestamp;
        accMs += delta;
        while (accMs >= STEP_MS) {
          accMs -= STEP_MS;
          applyStep();
          if (game.value.phase !== "playing") return;
        }
        rafId = requestAnimationFrame(onFrame);
      }

      function startTick(): void {
        clearTick();
        lastStepAt = performance.now();
        rafId = requestAnimationFrame(onFrame);
      }

      function start(): void {
        if (game.value.phase === "playing") return;
        if (game.value.phase === "dead" || game.value.phase === "won") {
          game.value = createGame();
        }
        game.value = { ...game.value, phase: "playing" };
        startTick();
      }

      function reset(): void {
        clearTick();
        game.value = createGame();
      }

      function pause(): void {
        if (game.value.phase !== "playing") return;
        clearTick();
        game.value = { ...game.value, phase: "ready" };
      }

      function turn(direction: Direction): void {
        const current = game.value;
        if (current.phase === "dead" || current.phase === "won") return;
        const next = queueDirection(current, direction);
        if (next.pendingDirection === current.pendingDirection) return;
        game.value.pendingDirection = next.pendingDirection;
        if (current.phase !== "playing") return;
        if (performance.now() - lastStepAt < MIN_STEP_GAP_MS) return;
        accMs = 0;
        lastFrameTs = 0;
        applyStep();
        if (game.value.phase === "playing" && !rafId) rafId = requestAnimationFrame(onFrame);
      }

      function setBoardSize(size: number, options?: { hostDriven?: boolean }): void {
        const max = options?.hostDriven ? MAX_HOST_BOARD_SIZE : MAX_BOARD_SIZE;
        const next = clampBoardSize(size, max);
        if (next === boardSize.value) return;
        boardSize.value = next;
        if (!options?.hostDriven) {
          void ctx.data.set(SNAKE_BOARD_DATA_KEY, { boardSize: next });
        }
      }

      void ctx.data.get<unknown>(SNAKE_BOARD_DATA_KEY).then((raw) => {
        if (alive && raw !== undefined) boardSize.value = persistedBoardSize(raw);
      });
      void hydrateHighScore(ctx);

      onScopeDispose(() => {
        alive = false;
        clearTick();
        if (keyboardOwnerId === ctx.instanceId) keyboardOwnerId = null;
      });

      return {
        game,
        score,
        phase,
        highScore: sharedHighScore,
        boardSize,
        start,
        reset,
        pause,
        turn,
        setBoardSize,
      };
    },
  },
});
