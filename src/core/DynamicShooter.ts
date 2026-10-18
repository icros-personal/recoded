import * as THREE from "three";
import type { Game } from "./Game";
import { Ball } from "../entities/Ball";
import { Hub } from "../entities/Hub";
import { SimpleRobot } from "../entities/SimpleRobot";

export interface DynamicShooterConfig {
  numBalls: number;
  timeBetweenBalls?: number;
  rpmDropPerBall?: number;
  acceleration?: number;
  maxRpm?: number;
  maxAge?: number;
}

export type ShotCallback = (event: "scored" | "missed" | "round_complete") => void;

export class DynamicShooter {
  private accumulator = 0;
  private readonly FIXED_DT = 1 / 60;

  public flywheelRpm = 0;
  private readonly config: Required<DynamicShooterConfig>;

  private balls: Ball[] = [];
  private shots: { previousY: number; ball: Ball; age: number }[] = [];
  
  private ballsFired = 0;
  private timeSinceLastShot = 999; // Allows immediate first shot
  private isKeyHeld = false;
  private roundEnded = false;

  constructor(
    private game: Game,
    private robot: SimpleRobot,
    private hub: Hub,
    config: DynamicShooterConfig,
  ) {
    this.config = {
      timeBetweenBalls: 0.15, // Rate limit interval
      rpmDropPerBall: 350,
      acceleration: 5000,
      maxRpm: 5000,
      maxAge: 4.0,
      ...config,
    };

    // Preallocate pool of balls matching numBalls exactly
    for (let i = 0; i < this.config.numBalls; i++) {
      this.balls.push(new Ball());
    }
    game.stage.add(...this.balls.map((b) => b.mesh));
  }

  setKeyHeld(held: boolean) {
    this.isKeyHeld = held;
  }

  /** Attempts to fire a single ball, respecting the rate limit and ball budget. */
  tryFire(getShotAngle: () => number): boolean {
    if (this.roundEnded) return false;
    if (this.ballsFired >= this.config.numBalls) return false;
    if (this.timeSinceLastShot < this.config.timeBetweenBalls) return false;

    this.fireSingleBall(getShotAngle());
    this.timeSinceLastShot = 0;
    return true;
  }

  reset() {
    for (const shot of this.shots) {
      shot.ball.remove(this.game.world);
    }
    this.shots = [];
    this.ballsFired = 0;
    this.timeSinceLastShot = 999;
    this.isKeyHeld = false;
    this.roundEnded = false;
  }

  get isBusy(): boolean {
    return this.shots.length > 0 || this.ballsFired < this.config.numBalls;
  }

  get ballsRemaining(): number {
    return this.config.numBalls - this.ballsFired;
  }

  update(
    dt: number,
    targetRpm: number,
    getShotAngle: () => number,
    onShotEvent?: ShotCallback,
  ) {
    this.accumulator += dt;
    while (this.accumulator >= this.FIXED_DT) {
      this.stepShooter(this.FIXED_DT, targetRpm, getShotAngle, onShotEvent);
      this.accumulator -= this.FIXED_DT;
    }
  }

  private stepShooter(
    dt: number,
    targetRpm: number,
    getShotAngle: () => number,
    onShotEvent?: ShotCallback,
  ) {
    // Increment rate-limit timer
    this.timeSinceLastShot += dt;

    // Handle hold-to-fire continuous mode
    if (this.isKeyHeld && this.ballsFired < this.config.numBalls) {
      if (this.timeSinceLastShot >= this.config.timeBetweenBalls) {
        this.tryFire(getShotAngle);
      }
    }

    // 1. Update Flywheel Physics
    const delta = targetRpm - this.flywheelRpm;
    const maxChange = this.config.acceleration * dt;
    if (Math.abs(delta) <= maxChange) {
      this.flywheelRpm = targetRpm;
    } else {
      this.flywheelRpm += Math.sign(delta) * maxChange;
    }

    // 2. Update shots in flight
    if (this.shots.length > 0) {
      for (let i = this.shots.length - 1; i >= 0; i--) {
        const shot = this.shots[i]!;
        shot.age += dt;
        shot.ball.syncMesh();

        const p = shot.ball.position;

        if (this.hub.isScoringCrossing(shot.previousY, p)) {
          onShotEvent?.("scored");
          this.finishShot(i);
          this.checkRoundCompletion(onShotEvent);
          continue;
        }

        shot.previousY = p.y;

        if (!shot.ball.inBounds() || p.y <= 0.1 || shot.age >= this.config.maxAge) {
          onShotEvent?.("missed");
          this.finishShot(i);
          this.checkRoundCompletion(onShotEvent);
        }
      }
    }
  }

  private fireSingleBall(shotAngleDeg: number) {
    const ball = this.balls[this.ballsFired]!;
    this.ballsFired++;

    const start = this.robot.getMuzzlePosition();
    const speed = this.robot.rpmToLaunchSpeed(this.flywheelRpm);
    const fwd = this.robot.getForward();
    const angle = THREE.MathUtils.degToRad(shotAngleDeg);
    const horizontal = Math.cos(angle) * speed;

    ball.place(start);
    this.shots.push({ ball, previousY: start.y, age: 0 });

    const robotVel = this.robot.getVelocity();
    ball.launch(this.game.world, start, {
      x: fwd.x * horizontal + robotVel.x,
      y: Math.sin(angle) * speed + robotVel.y,
      z: fwd.z * horizontal + robotVel.z,
    });

    this.flywheelRpm = Math.max(
      0,
      this.flywheelRpm - this.config.rpmDropPerBall,
    );
  }

  private finishShot(index: number) {
    const shot = this.shots[index];
    if (!shot) return;
    shot.ball.remove(this.game.world);
    this.shots.splice(index, 1);
  }

  private checkRoundCompletion(onShotEvent?: ShotCallback) {
    if (!this.roundEnded && this.ballsFired >= this.config.numBalls && this.shots.length === 0) {
      this.roundEnded = true;
      onShotEvent?.("round_complete");
    }
  }
}