import RAPIER from "@dimforge/rapier3d-compat";
import { Game } from "./core/Game";
import { GameUI } from "./core/ui";
import { levels } from "./levels";

import "./style.css";

await RAPIER.init();

const ui = new GameUI(document.querySelector<HTMLDivElement>("#app")!);
const game = new Game(ui);

// Pick a level with ?level=2 (defaults to level 1).
const requested = Number(
  new URLSearchParams(location.search).get("level") ?? 1,
);
const index = Number.isInteger(requested)
  ? Math.min(Math.max(requested, 1), levels.length) - 1
  : 0;

const level = levels[index]?.();
if (level) {
  game.loadLevel(level);
  game.start();
}
