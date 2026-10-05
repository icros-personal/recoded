import * as THREE from "three";
import type { Game } from "../core/Game";
import type { ControlSpec, LevelInfo } from "../core/ui";
import { Ball } from "../entities/Ball";
import { FIELD_LENGTH, Floor } from "../entities/Floor";
import { Hub } from "../entities/Hub";
import { Robot } from "../entities/Robot";
import type { Level } from "./Level";
import { CameraSpec } from "../core/camera";

const INSTRUCTIONS =
  "Get the ball through the hexagonal opening on top of the Hub.";
const SHOT_ANGLE_DEG = 60;

type Phase = "ready" | "flying" | "scored" | "done";

export class Level2 implements Level {
  readonly info: LevelInfo = {
    subtitle: "Level 2: Scoring from distance",
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

  private distanceLabel: HTMLDivElement = document.createElement('div');
  private shotLabel: HTMLDivElement = document.createElement('div');

  setup(game: Game) {
    this.game = game;
    this.game.ui.getLevelContainer().appendChild(this.distanceLabel);
    this.shotLabel.innerText = `Shots on target: ${this.successfulShots} / ${this.totalShots}`;
    this.game.ui.getLevelContainer().appendChild(this.shotLabel);

    const floor = new Floor();
    floor.addColliders(game.world);

    this.hub = new Hub(-4.1995);
    this.robot = new Robot(this.getNewRobotPosition());
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
      location.href = '/?level=3';
    }
  }

  private recordSuccessfulShot() {
    this.successfulShots++;
    this.shotLabel.innerText = `Shots on target: ${this.successfulShots} / ${this.totalShots}`;
  }

  private moveToNewDistance() {
    const robotPosition = this.getNewRobotPosition();
    this.robot.setPosition(robotPosition, 0);
    this.setCurrentDistance();
  }

  update(dt: number) {
    if (this.phase !== "flying") return;

    this.game.stepPhysics(dt);
    this.ball.syncMesh();

    const p = this.ball.position;
    if (this.hub.isScoringCrossing(this.previousBallY, p)) {
      this.recordSuccessfulShot();
      if (this.successfulShots < 5) {
        this.phase = "scored";
        this.game.ui.setStatus(
          "✓ Nice shot! You found the opening. Can you get 5 shots on target?",
          "success",
        );
        this.game.ui.setAction("NEXT");
      } else {
        this.phase = "done";
        this.game.ui.setStatus(
          "✓ Nice shot! You found the opening. Can you get 5 shots on target?",
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
    const speed = this.rpmToLaunchSpeed(rpm);
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

  private rpmToLaunchSpeed(rpm: number) {
    return 0.0025 * rpm;
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
