import type { CameraSpec } from "../core/Camera";
import type { Game } from "../core/Game";
import type { ControlSpec, LevelInfo } from "../core/ui";
import { DistanceLine } from "../entities/DistanceLine";
import { Floor } from "../entities/Floor";
import { Hub } from "../entities/Hub";
import type { SimpleRobot } from "../entities/SimpleRobot";
import { ScoreOverlay } from "../ui/ScoreOverlay";
import type { Level } from "./Level";

export abstract class SimpleBaseLevel implements Level {
  abstract readonly info: LevelInfo;
  abstract readonly controls: ControlSpec[];
  abstract readonly camera: CameraSpec;

  protected game!: Game;
  protected robot!: SimpleRobot;
  protected hub!: Hub;

  protected distanceLine!: DistanceLine;
  protected scoreOverlay!: ScoreOverlay;

  protected successfulShots = 0;
  protected totalShots = 0;
  protected currentDistance = 0;

  private distanceQueue: number[] = [];

  protected flightTime = 0;
  protected readonly MAX_FLIGHT_TIME = 5.0;

  setup(game: Game) {
    this.game = game;

    const parent = this.game.renderer.domElement.parentElement!;
    this.distanceLine = new DistanceLine(parent);
    this.scoreOverlay = new ScoreOverlay(parent);
    this.scoreOverlay.setScore(this.successfulShots, this.totalShots);

    const floor = new Floor();
    floor.addColliders(game.world);

    this.hub = new Hub(Hub.HUB_X);
    this.hub.addColliders(game.world);

    this.initEntities();

    this.game.stage.add(
      floor.mesh,
      this.hub.group,
      this.robot.group,
      this.distanceLine.group,
    );
    this.resetShot();
  }

  protected abstract initEntities(): void;
  protected abstract getBaseDistances(): number[];

  protected getNextDistance(): number {
    if (this.distanceQueue.length === 0) {
        const baseDistances = this.getBaseDistances();
        this.distanceQueue = [...baseDistances].sort(() => Math.random() - 0.5);
    }
    return this.distanceQueue.pop()!;
  }

  protected updateDistanceLine() {
    this.distanceLine.update(
      this.robot.getMuzzlePosition(),
      this.hub.group.position,
      this.game.camera,
    );
  }

  protected recordSuccessfulShot() {
    this.successfulShots++;
    this.game.achievements.add('shots', 1);
    this.scoreOverlay.setScore(this.successfulShots, this.totalShots);
  }

  abstract update(dt: number): void;
  abstract onAction(): void;

  protected resetShot() {
    this.flightTime = 0;
    this.scoreOverlay.setScore(this.successfulShots, this.totalShots);
    this.updateDistanceLine();
  }

  dispose() {
    this.scoreOverlay.dispose();
    this.distanceLine.dispose();
  }
}
