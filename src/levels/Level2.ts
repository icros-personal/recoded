import * as THREE from "three";
import type { Game } from "../core/Game";
import type { ControlSpec, LevelInfo } from "../core/ui";
import { Ball } from "../entities/Ball";
import { FIELD_LENGTH, Floor } from "../entities/Floor";
import { Hub } from "../entities/Hub";
import { Robot } from "../entities/Robot";
import type { Level } from "./Level";
import type { CameraSpec } from "../core/Camera";
import { levels } from ".";
import { DistanceLine } from "../entities/DistanceLine";
import { ScoreOverlay } from "../ui/ScoreOverlay";

const INSTRUCTIONS =
  "Get the ball through the hexagonal opening on top of the Hub.";
const SHOT_ANGLE_DEG = 60;

type Phase = "ready" | "flying" | "scored" | "done";

export class Level2 implements Level {
  readonly info: LevelInfo = {
    index: 2,
    subtitle: "Scoring from distance",
    instructions: INSTRUCTIONS,
    targetLabel: "",
  };

  readonly controls: ControlSpec[] = [
    {
      id: "rpm",
      label: "Shooter RPM",
      value: 4000,
      min: 2000,
      max: 5000,
      step: 100,
    },
  ];

  readonly camera: CameraSpec = {
    type: "perspective",
    position: [-6, 2.5, 6],
    target: [-6, 1.25, 0],
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

  private shotTable: [number, number][] = [];
  private distanceLine!: DistanceLine;
  private scoreOverlay!: ScoreOverlay;

  setup(game: Game) {
    this.game = game;

    this.distanceLine = new DistanceLine(this.game.renderer.domElement.parentElement!);

    this.scoreOverlay = new ScoreOverlay(this.game.renderer.domElement.parentElement!);
    this.scoreOverlay.setScore(this.successfulShots, this.totalShots);

    const floor = new Floor();
    floor.addColliders(game.world);

    this.hub = new Hub(Hub.HUB_X);
    this.robot = new Robot(this.getNewRobotPosition());
    this.currentDistance = this.robot.getDistanceToHub(this.hub.group.position);
    this.hub.addColliders(game.world);
    this.ball = new Ball();

    game.stage.add(
      floor.mesh,
      this.robot.group,
      this.hub.group,
      this.ball.mesh,
      this.distanceLine.group,
    );
    this.resetShot();
  }

  private getNewRobotPosition() {
    const min = -FIELD_LENGTH / 2 + Robot.ROBOT_WIDTH / 2;
    const max = -5 - Hub.WIDTH / 2 - Robot.ROBOT_WIDTH / 2;
    return Math.random() * (max - min) + min;
  }

  onAction() {
    if (this.phase === 'ready') {
      this.fire();
    } else if (this.phase === 'flying') {
      this.resetShot();
    } else if (this.phase === 'scored') {
      this.moveToNewDistance();
      this.resetShot();
    } else {
      const level = levels[this.info.index]?.();
      if (level) {
        this.game.loadLevel(level);
      }
    }
  }

  private recordSuccessfulShot() {
    this.shotTable.push([this.currentDistance, this.game.ui.getNumber('rpm')]);
    this.successfulShots++;
    this.scoreOverlay.setScore(this.successfulShots, this.totalShots);
  }

  private moveToNewDistance() {
    const robotPosition = this.getNewRobotPosition();
    this.robot.setPosition(robotPosition, 0);
    this.currentDistance = this.robot.getDistanceToHub(this.hub.group.position);

    this.distanceLine.update(
      this.robot.getMuzzlePosition(),
      this.hub.group.position,
      this.game.camera,
    );
  }

  update(dt: number) {
    this.distanceLine.update(
      this.robot.getMuzzlePosition(),
      this.hub.group.position,
      this.game.camera,
    );

    if (this.phase !== "flying") return;

    this.game.stepPhysics(dt);
    this.ball.syncMesh();

    const p = this.ball.position;
    if (this.hub.isScoringCrossing(this.previousBallY, p)) {
      this.recordSuccessfulShot();
      if (this.successfulShots < 5) {
        this.phase = "scored";
        this.game.ui.setStatus(
          `✓ Nice shot! You found the opening. Can you get ${5 - this.successfulShots} more shots on target?`,
          "success",
        );
        this.game.ui.setAction("NEXT");
      } else {
        this.phase = "done";
        this.game.setStorage(2, this.shotTable);
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

  private fire() {
    const rpm = this.game.ui.getNumber("rpm");
    if (!Number.isFinite(rpm)) return;

    this.totalShots++;
    const start = this.robot.getMuzzlePosition();

    // Level 2: assume shooter instantly reaches target RPM.
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

  private resetShot() {
    this.scoreOverlay.setScore(this.successfulShots, this.totalShots);
    this.phase = "ready";
    this.ball.remove(this.game.world);
    this.ball.place(this.robot.getMuzzlePosition());
    this.game.ui.setStatus(INSTRUCTIONS);
    this.game.ui.setAction("FIRE!");
  }

  dispose() {
    this.scoreOverlay.dispose();
    this.distanceLine.dispose();
  }
}
