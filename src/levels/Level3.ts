import * as THREE from "three";
import type { Game } from "../core/Game";
import type { ControlSpec, LevelInfo } from "../core/ui";
import { Ball } from "../entities/Ball";
import { FIELD_LENGTH, Floor } from "../entities/Floor";
import { Hub } from "../entities/Hub";
import { Robot } from "../entities/Robot";
import type { Level } from "./Level";
import { CameraSpec } from "../core/camera";
import { levels } from ".";

const INSTRUCTIONS =
  "Unfortunately, our shooter can't spin up instantly, and each ball slows it down. Can you still score them all?";
const SHOT_ANGLE_DEG = 60;
const MAX_RPM = 5000;
const RPM_LOG_MAX = 200;

type Phase = "ready" | "firing" | "waiting" | "scored" | "done";

export class Level3 implements Level {
  readonly info: LevelInfo = {
    index: 3,
    subtitle: "Flywheels are tricky",
    instructions: INSTRUCTIONS,
    targetLabel: "",
  };

  readonly controls: ControlSpec[] = [
    {
      id: "rpm",
      label: "Shooter RPM",
      value: 4000,
      min: 2000,
      max: MAX_RPM,
      step: 100,
    },
  ];

  readonly camera: CameraSpec = {
    type: "perspective",
    position: [-6, 2.5, 6],
    target: [-6, 1.25, 0],
    fov: 40,
  };

  private readonly BALLS_PER_BURST = 10;
  private readonly TIME_BETWEEN_BALLS = 0.05;
  private readonly RPM_DROP_PER_BALL = 350;

  private ballsFired = 0;
  private timeToNextBall = 0;

  private game!: Game;
  private robot!: Robot;
  private hub!: Hub;
  private balls: Ball[] = [];
  private shots: { previousY: number; ball: Ball }[] = [];

  private flywheelRpm = 0;

  private phase: Phase = "ready";
  private currentDistance = 0;
  private successfulShots = 0;
  private totalShots = 0;

  private shotTable: [number, number][] = [];
  private distanceLabel: HTMLDivElement = document.createElement("div");
  private shotLabel: HTMLDivElement = document.createElement("div");

  private logRpm = false;
  private rpmLog: number[] = [];
  private canvas: HTMLCanvasElement = document.createElement("canvas");

  setup(game: Game) {
    this.game = game;
    this.game.ui.getLevelContainer().appendChild(this.distanceLabel);
    this.shotLabel.innerText = `Shots on target: ${this.successfulShots} / ${this.totalShots}`;
    this.game.ui.getLevelContainer().appendChild(this.shotLabel);

    this.canvas.width = 800;
    this.canvas.height = 300;
    this.game.ui.getControlsContainer().appendChild(this.canvas);

    const floor = new Floor();
    floor.addColliders(game.world);

    this.hub = new Hub(Hub.HUB_X);
    this.robot = new Robot(this.getNewRobotPosition());
    this.setCurrentDistance();
    this.hub.addColliders(game.world);
    for (let i = 0; i < this.BALLS_PER_BURST; i++) {
      this.balls.push(new Ball());
    }

    game.stage.add(
      floor.mesh,
      this.robot.group,
      this.hub.group,
      ...this.balls.map((ball) => ball.mesh),
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
    if (this.phase === "ready") {
      this.startBurst();
    } else if (this.phase === "firing" || this.phase === "waiting") {
      this.resetShot();
    } else if (this.phase === "scored") {
      this.moveToNewDistance();
      this.resetShot();
    } else {
      this.game.loadLevel(levels[this.info.index]());
    }
  }

  private recordSuccessfulShot() {
    this.shotTable.push([this.currentDistance, this.game.ui.getNumber("rpm")]);
    this.successfulShots++;
    this.shotLabel.innerText = `Shots on target: ${this.successfulShots} / ${this.totalShots}`;
  }

  private moveToNewDistance() {
    const robotPosition = this.getNewRobotPosition();
    this.robot.setPosition(robotPosition, 0);
    this.setCurrentDistance();
  }

  private updateFlywheel(dt: number, targetRpm: number) {
    const acceleration = 5000; // RPM/s?
    const delta = targetRpm - this.flywheelRpm;
    const maxChange = acceleration * dt;
    if (Math.abs(delta) <= maxChange) {
      this.flywheelRpm = targetRpm;
    } else {
      this.flywheelRpm += Math.sign(delta) * maxChange;
    }

    if (this.logRpm) {
      this.rpmLog.push(this.flywheelRpm);
      if (this.rpmLog.length > RPM_LOG_MAX) {
        this.rpmLog.shift();
      }
      const ctx = this.canvas.getContext("2d")!;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (this.rpmLog.length > 1) {
        ctx.beginPath();
        ctx.moveTo(
          this.canvas.width,
          ((MAX_RPM - this.rpmLog[this.rpmLog.length - 1]) / MAX_RPM) *
            this.canvas.height,
        );
        for (let i = 1; i < this.rpmLog.length; i++) {
          const logIndex = this.rpmLog.length - 1 - i;
          ctx.lineTo(
            this.canvas.width - i * (this.canvas.width / RPM_LOG_MAX),
            ((MAX_RPM - this.rpmLog[logIndex]) / MAX_RPM) * this.canvas.height,
          );
        }
        ctx.strokeStyle = "blue";
        ctx.stroke();
        ctx.strokeStyle = '#aaa';
        ctx.beginPath();
        ctx.moveTo(0, 0),
        ctx.lineTo(0, this.canvas.height);
        ctx.stroke();
        for (let i = 0; i <= MAX_RPM; i += 1000) {
          ctx.beginPath();
          ctx.moveTo(0, i / MAX_RPM * this.canvas.height),
          ctx.lineTo(this.canvas.width, i / MAX_RPM * this.canvas.height);
          ctx.stroke();
        }
        ctx.fillText(MAX_RPM.toString(), 0, 12);
        ctx.fillText('0', 0, this.canvas.height);
      }
    }
  }

  update(dt: number) {
    this.updateFlywheel(dt, this.game.ui.getNumber("rpm"));

    if (this.phase === "firing") {
      this.timeToNextBall -= dt;
      if (this.timeToNextBall <= 0) {
        this.fireBall();
        if (this.ballsFired >= this.BALLS_PER_BURST) {
          this.phase = "waiting";
        } else {
          this.timeToNextBall = this.TIME_BETWEEN_BALLS;
        }
      }
    }

    if (this.shots.length < 1) {
      return;
    }

    this.game.stepPhysics(dt);

    for (let i = this.shots.length - 1; i >= 0; i--) {
      const shot = this.shots[i];
      shot.ball.syncMesh();

      const p = shot.ball.position;
      if (this.hub.isScoringCrossing(shot.previousY, p)) {
        this.recordSuccessfulShot();
        this.finishShot(i);
        continue;
      }

      shot.previousY = p.y;

      if (!shot.ball.inBounds()) {
        this.finishShot(i);
      }
    }

    if (this.phase === "waiting" && this.shots.length === 0) {
      this.finishBurst();
    }
  }

  private finishBurst() {
    this.logRpm = false;
    this.game.ui.setStatus("Try again?");
    this.game.ui.setAction("RESET");
  }

  private finishShot(index: number) {
    const shot = this.shots[index];
    shot.ball.remove(this.game.world);
    this.shots.splice(index, 1);
  }

  private startBurst() {
    if (!Number.isFinite(this.game.ui.getNumber("rpm"))) return;

    this.logRpm = true;
    this.phase = "firing";

    this.game.ui.setStatus("Firing...");
    this.game.ui.setAction("RESET");
  }

  private fireBall() {
    this.totalShots++;
    const start = this.robot.getMuzzlePosition();

    const speed = this.robot.rpmToLaunchSpeed(this.flywheelRpm);
    const fwd = this.robot.getForward();
    const angle = THREE.MathUtils.degToRad(SHOT_ANGLE_DEG);
    const horizontal = Math.cos(angle) * speed;
    const ball = this.balls[this.ballsFired];
    ball.place(this.robot.getMuzzlePosition());
    this.ballsFired++;
    this.shots.push({ ball, previousY: start.y });
    ball.launch(this.game.world, start, {
      x: fwd.x * horizontal,
      y: Math.sin(angle) * speed,
      z: fwd.z * horizontal,
    });

    this.flywheelRpm = Math.max(0, this.flywheelRpm - this.RPM_DROP_PER_BALL);

    this.game.ui.setStatus("Watch the shots...");
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
    this.shots = [];
    this.ballsFired = 0;
    this.timeToNextBall = 0;
    this.game.ui.setStatus(INSTRUCTIONS);
    this.game.ui.setAction("FIRE!");
  }
}
