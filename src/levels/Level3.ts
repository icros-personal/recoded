import * as THREE from "three";
import type { Game } from "../core/Game";
import type { ControlSpec, LevelInfo } from "../core/ui";
import { Ball } from "../entities/Ball";
import { FIELD_LENGTH, FIELD_WIDTH, Floor } from "../entities/Floor";
import { Hub } from "../entities/Hub";
import { Robot } from "../entities/Robot";
import type { Level } from "./Level";
import { CameraSpec } from "../core/camera";
import { Table } from "../ui/Table";
import { levels } from ".";

const INSTRUCTIONS =
  "It's a lot of work coming up with the right value for each distance. Can we just add a few values to a table and let the robot figure out the in-between steps?";
const SHOT_ANGLE_DEG = 60;

type Phase = "ready" | "flying" | "scored" | "done";

export class Level3 implements Level {
  readonly levelRequirement = 10;
  readonly info: LevelInfo = {
    index: 3,
    subtitle: "Can't the robot figure this out?",
    instructions: INSTRUCTIONS,
    targetLabel: "",
  };

  readonly controls: ControlSpec[] = [];

  readonly rotationAngle = -Math.atan2(
    FIELD_WIDTH / 2,
    FIELD_LENGTH / 2 + Hub.HUB_X,
  );
  readonly rotationMatrix = new THREE.Matrix4()
    .makeTranslation(Hub.HUB_X, 0, 0)
    .multiply(
      new THREE.Matrix4()
        .makeRotationY(this.rotationAngle)
        .multiply(new THREE.Matrix4().makeTranslation(-Hub.HUB_X, 0, 0)),
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
  private ball!: Ball;

  private phase: Phase = "ready";
  private previousBallY = 0;
  private currentDistance = 0;
  private successfulShots = 0;
  private totalShots = 0;

  private table: Table | null = null;
  private distanceLabel: HTMLDivElement = document.createElement("div");
  private shotLabel: HTMLDivElement = document.createElement("div");

  setup(game: Game) {
    this.game = game;
    this.game.ui.getLevelContainer().appendChild(this.distanceLabel);
    this.shotLabel.innerText = `Shots on target: ${this.successfulShots} / ${this.totalShots}`;
    this.game.ui.getLevelContainer().appendChild(this.shotLabel);

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
    this.game.ui
      .getControlsContainer()
      .insertBefore(
        this.table.getRoot(),
        this.game.ui.getControlsContainer().firstElementChild,
      );

    const floor = new Floor();
    floor.addColliders(game.world);

    this.hub = new Hub(Hub.HUB_X);
    this.robot = new Robot(...this.getNewRobotPosition(4.5));
    this.robot.group.rotation.y = this.rotationAngle;
    this.setCurrentDistance();
    this.hub.addColliders(game.world);
    this.ball = new Ball();

    game.stage.add(
      floor.mesh,
      this.robot.group,
      this.hub.group,
      this.ball.mesh,
    );
    this.resetShot();
  }

  private setCurrentDistance() {
    this.currentDistance = this.getDistanceToHub();
    this.distanceLabel.innerText = `Distance from hub: ${Math.round(this.currentDistance * 100) / 100} m`;
  }

  private getNewRobotPosition(hint?: number): [number, number] {
    const min =
      -Math.hypot(FIELD_LENGTH, FIELD_WIDTH) / 2 + Robot.ROBOT_WIDTH / 2;
    const max = -5 - Hub.WIDTH / 2 - Robot.ROBOT_WIDTH / 2;
    const distance = hint
      ? Hub.HUB_X - hint
      : Math.random() * (max - min) + min;
    const position = new THREE.Vector3(distance, 0, 0).applyMatrix4(
      this.rotationMatrix,
    );
    return [position.x, position.z];
  }

  onAction() {
    if (this.phase === "ready") {
      this.fire();
    } else if (this.phase === "flying") {
      this.resetShot();
    } else if (this.phase === "scored") {
      this.moveToNewDistance();
      this.resetShot();
    } else {
      this.game.loadLevel(levels[this.info.index]());
    }
  }

  private recordSuccessfulShot() {
    this.successfulShots++;
    this.shotLabel.innerText = `Shots on target: ${this.successfulShots} / ${this.totalShots}`;
  }

  private moveToNewDistance() {
    this.robot.setPosition(...this.getNewRobotPosition());
    this.setCurrentDistance();
  }

  update(dt: number) {
    if (this.phase !== "flying") return;

    this.game.stepPhysics(dt);
    this.ball.syncMesh();

    const p = this.ball.position;
    if (this.hub.isScoringCrossing(this.previousBallY, p)) {
      this.recordSuccessfulShot();
      if (this.successfulShots < this.levelRequirement) {
        this.phase = "scored";
        this.game.ui.setStatus(
          `✓ Nice shot! You found the opening. Can you get ${this.levelRequirement - this.successfulShots} more shots on target?`,
          "success",
        );
        this.game.ui.setAction("NEXT");
      } else {
        this.phase = "done";
        this.game.ui.setStatus(
          "✓ Nice shot! You're getting the hang of this.",
          "success",
        );
        this.game.ui.setAction("DONE");
      }
      return;
    }
    this.previousBallY = p.y;

    if (!this.ball.inBounds()) {
      this.resetShot();
      this.game.ui.setStatus("Missed. Try a different shot power.", "miss");
    }
  }

  private getInterpolatedRPM(): number {
    // Assuming this.table.values() returns Map<number, number>
    const entries = Array.from(this.table!.values().entries());

    if (entries.length === 0) {
      return 0;
    }

    // Clamp to lower bound if below or equal to the first distance
    if (this.currentDistance <= entries[0][0]) {
      this.table?.highlight(0);
      return entries[0][1];
    }

    // Clamp to upper bound if above or equal to the last distance
    if (this.currentDistance >= entries[entries.length - 1][0]) {
      this.table?.highlight(entries.length - 1);
      return entries[entries.length - 1][1];
    }

    // Find the interval [i - 1, i] containing currentDistance
    let i = 1;
    while (i < entries.length && entries[i][0] < this.currentDistance) {
      i++;
    }

    this.table?.highlight(i - 1, i);
    const [d0, rpm0] = entries[i - 1];
    const [d1, rpm1] = entries[i];

    // Standard linear interpolation formula: y = y0 + (x - x0) * (y1 - y0) / (x1 - x0)
    const t = (this.currentDistance - d0) / (d1 - d0);
    return rpm0 + t * (rpm1 - rpm0);
  }

  private fire() {
    const rpm = this.getInterpolatedRPM();
    if (!Number.isFinite(rpm)) return;

    this.totalShots++;
    const start = this.robot.getMuzzlePosition();

    // Level 3: assume shooter instantly reaches target RPM.
    const speed = this.robot.rpmToLaunchSpeed(rpm);
    const fwd = this.robot.getForward();
    const angle = THREE.MathUtils.degToRad(SHOT_ANGLE_DEG);
    const horizontal = Math.cos(angle) * speed;
    this.ball.launch(this.game.world, start, {
      x: fwd.x * horizontal,
      y: Math.sin(angle) * speed,
      z: fwd.z * horizontal,
    });

    this.phase = "flying";
    this.previousBallY = start.y;
    this.game.ui.setStatus("Watch the shot...");
    this.game.ui.setAction("RESET");
  }

  private getDistanceToHub() {
    const muzzle = this.robot.getMuzzlePosition();
    const hub = this.hub.group.position;
    return Math.hypot(hub.x - muzzle.x, hub.z - muzzle.z);
  }

  private resetShot() {
    this.shotLabel.innerText = `Shots on target: ${this.successfulShots} / ${this.totalShots}`;
    this.phase = "ready";
    this.ball.remove(this.game.world);
    this.ball.place(this.robot.getMuzzlePosition());
    this.game.ui.setStatus(INSTRUCTIONS);
    this.game.ui.setAction("FIRE!");
  }
}
