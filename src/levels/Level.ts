import type { CameraSpec } from '../core/Camera';
import type { Game } from '../core/Game';
import type { ControlSpec, LevelInfo } from '../core/ui';

/**
 * A level describes its page text and inputs up front (`info`, `controls`),
 * then builds its scene in `setup`. The Game calls `update` every frame.
 */
export interface Level {
  /** Header text, instructions, target label. */
  readonly info: LevelInfo;
  /** Inputs shown in the control bar. */
  readonly controls: ControlSpec[];
  /** Omit to use DEFAULT_CAMERA */
  readonly camera?: CameraSpec;

  /** Build entities, add them to `game.stage` / `game.world`, set the initial UI state. */
  setup(game: Game): void;
  /** Per-frame hook; call `game.stepPhysics(dt)` here when the sim should run. */
  update?(dt: number): void;
  /** The main action button was clicked. */
  onAction(): void;
  /** Optional cleanup before the next level loads (stage and world are freed automatically). */
  dispose?(): void;
}
