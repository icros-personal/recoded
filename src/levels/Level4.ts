import * as THREE from "three";
import type { Game } from "../core/Game";
import type { ControlSpec, LevelInfo } from "../core/ui";
import { FIELD_LENGTH, FIELD_WIDTH, Floor } from "../entities/Floor";
import { Hub } from "../entities/Hub";
import { Robot } from "../entities/Robot";
import type { Level } from "./Level";
import { CameraSpec } from "../core/camera";
import { Table } from "../ui/Table";
import { levels } from ".";
import { RpmGraph } from "../ui/RpmGraph";
import { BurstShooter } from "../core/BurstShooter";
import { DistanceLine } from "../entities/DistanceLine";
import { ScoreOverlay } from "../ui/ScoreOverlay";

const INSTRUCTIONS =
  "It's a lot of work coming up with the right value for each distance. Can we just add a few values to a table and let the robot figure out the in-between steps?";
const SHOT_ANGLE_DEG = 60;
const MAX_RPM = 5000;

type Phase = "ready" | "firing" | "waiting" | "scored" | "done";

export class Level4 implements Level {
  readonly levelRequirement = 10;
  readonly info: LevelInfo = {
    index: 4,
    subtitle: "Can't the robot figure this out?",
    instructions: INSTRUCTIONS,
    targetLabel: "",
  };

  readonly controls: ControlSpec[] = [];

  readonly rotationAngle = -Math.atan2(
    FIELD_WIDTH / 2,
    FIELD_LENGTH / 2 + Hub.HUB_X
  );
  readonly rotationMatrix = new THREE.Matrix4()
    .makeTranslation(Hub.HUB_X, 0, 0)
    .multiply(
      new THREE.Matrix4()
        .makeRotationY(this.rotationAngle)
        .multiply(new THREE.Matrix4().makeTranslation(-Hub.HUB_X, 0, 0))
    );
  readonly camera: CameraSpec = {
    type: "perspective",
    position: new THREE.Vector3(-6, 2.5, 6)
      .applyMatrix4(this.rotationMatrix)
      .toArray(),
    target: new THREE.Vector3(-6, 1.25, 0)
      .applyMatrix4(this.rotationMatrix)
      .toArray(),
    fov: 40,
  };

  private game!: Game;
  private robot!: Robot;
  private hub!: Hub;
  private shooter!: BurstShooter;
  private rpmGraph!: RpmGraph;

  private phase: Phase = "ready";
  private currentDistance = 0;
  private successfulShots = 0;
  private totalShots = 0;

  private table: Table | null = null;

  private distanceLine!: DistanceLine;
  private scoreOverlay!: ScoreOverlay;

  setup(game: Game) {
    this.game = game;

    this.distanceLine = new DistanceLine(this.game.renderer.domElement.parentElement!);

    this.scoreOverlay = new ScoreOverlay(this.game.renderer.domElement.parentElement!);
    this.scoreOverlay.setScore(this.successfulShots, this.totalShots);

    // Setup Table UI
    const level2Table = this.game.getStorage(2);
    if (level2Table && Array.isArray(level2Table)) {
      const map = new Map<number, number>();
      for (const pair of level2Table) {
        if (
          Array.isArray(pair) &&
          pair.length === 2 &&
          Number.isFinite(pair[0]) &&
          Number.isFinite(pair[1])
        ) {
          map.set(Math.round(pair[0] * 100) / 100, pair[1]);
        }
      }
      this.table = new Table(["Distance", "RPM"], map);
    } else {
      this.table = new Table(["Distance", "RPM"]);
    }
    
    const controlsContainer = this.game.ui.getControlsContainer();
    controlsContainer.insertBefore(
      this.table.getRoot(),
      controlsContainer.firstElementChild
    );

    // Setup RPM Graph Canvas
    this.rpmGraph = new RpmGraph(800, 300, MAX_RPM);
    controlsContainer.appendChild(this.rpmGraph.canvas);

    const floor = new Floor();
    floor.addColliders(game.world);

    this.hub = new Hub(Hub.HUB_X);
    this.robot = new Robot(...this.getNewRobotPosition(4.5));
    this.robot.group.rotation.y = this.rotationAngle;
    this.currentDistance = this.robot.getDistanceToHub(this.hub.group.position);

    this.hub.addColliders(game.world);
    this.shooter = new BurstShooter(game, this.robot, this.hub);

    game.stage.add(floor.mesh, this.robot.group, this.hub.group, this.distanceLine.group);
    this.resetShot();
  }

  private getNewRobotPosition(hint?: number): [number, number] {
    const min =
      -Math.hypot(FIELD_LENGTH, FIELD_WIDTH) / 2 + Robot.ROBOT_WIDTH / 2;
    const max = -5 - Hub.WIDTH / 2 - Robot.ROBOT_WIDTH / 2;
    const distance = hint
      ? Hub.HUB_X - hint
      : Math.random() * (max - min) + min;
    const position = new THREE.Vector3(distance, 0, 0).applyMatrix4(
      this.rotationMatrix
    );
    return [position.x, position.z];
  }

  onAction() {
    if (this.phase === "ready") {
      this.fire();
    } else if (this.phase === "firing" || this.phase === "waiting") {
      this.resetShot();
    } else if (this.phase === "scored") {
      this.moveToNewDistance();
      this.resetShot();
    } else {
      this.game.loadLevel(levels[this.info.index]());
    }
  }

  private moveToNewDistance() {
    this.robot.setPosition(...this.getNewRobotPosition());
    this.currentDistance = this.robot.getDistanceToHub(this.hub.group.position);
    this.distanceLine.update(
      this.robot.getMuzzlePosition(),
      this.hub.group.position,
      this.game.camera,
    );
  }

  update(dt: number) {
    const targetRpm = this.getInterpolatedRPM();

    this.distanceLine.update(
      this.robot.getMuzzlePosition(),
      this.hub.group.position,
      this.game.camera,
    );

    this.shooter.update(
      dt,
      targetRpm,
      () => this.getShotAngle(),
      (event) => {
        this.totalShots++;
        if (event === "scored") {
          this.successfulShots++;
          if (this.successfulShots >= this.levelRequirement) {
            this.phase = "done";
            this.game.ui.setStatus(
              "✓ Nice shot! You're getting the hang of this.",
              "success"
            );
            this.game.ui.setAction("DONE");
          } else {
            this.phase = "scored";
            this.game.ui.setStatus(
              `✓ Nice shot! Can you get ${this.levelRequirement - this.successfulShots} more shots on target?`,
              "success"
            );
            this.game.ui.setAction("NEXT");
          }
        }
        this.scoreOverlay.setScore(this.successfulShots, this.totalShots);
      }
    );

    this.rpmGraph.update(this.shooter.flywheelRpm);

    if (this.phase === "firing" && !this.shooter.isBusy) {
      this.phase = "waiting";
      this.rpmGraph.stop();
      this.game.ui.setStatus("Try a different set of RPM table values.", "miss");
      this.game.ui.setAction("RESET");
    }
  }

  private getInterpolatedRPM(): number {
    const entries = Array.from(this.table!.values().entries());

    if (entries.length === 0) return 0;

    if (this.currentDistance <= entries[0][0]) {
      this.table?.highlight(0);
      return entries[0][1];
    }

    if (this.currentDistance >= entries[entries.length - 1][0]) {
      this.table?.highlight(entries.length - 1);
      return entries[entries.length - 1][1];
    }

    let i = 1;
    while (i < entries.length && entries[i][0] < this.currentDistance) {
      i++;
    }

    this.table?.highlight(i - 1, i);
    const [d0, rpm0] = entries[i - 1];
    const [d1, rpm1] = entries[i];

    const t = (this.currentDistance - d0) / (d1 - d0);
    return rpm0 + t * (rpm1 - rpm0);
  }

  private fire() {
    const targetRpm = this.getInterpolatedRPM();
    if (!Number.isFinite(targetRpm)) return;

    this.rpmGraph.start();
    this.shooter.startBurst();
    this.phase = "firing";

    this.game.ui.setStatus("Watch the burst...");
    this.game.ui.setAction("RESET");
  }

  private getShotAngle(): number {
    if (this.currentDistance >= 3) return SHOT_ANGLE_DEG;
    if (this.currentDistance <= 1) return 80;
    const t = (this.currentDistance - 1) / (3 - 1);
    return 80 + t * (SHOT_ANGLE_DEG - 80);
  }

  private resetShot() {
    this.scoreOverlay.setScore(this.successfulShots, this.totalShots);
    this.phase = "ready";
    this.shooter.reset();
    this.rpmGraph.reset();
    this.game.ui.setStatus(INSTRUCTIONS);
    this.game.ui.setAction("FIRE!");
  }

  dispose() {
    this.scoreOverlay.dispose();
    this.distanceLine.dispose();
  }
}