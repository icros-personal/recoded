import * as THREE from "three";
import type { Game } from "../core/Game";
import { Ball } from "../entities/Ball";
import { Hub } from "../entities/Hub";
import { Robot } from "../entities/Robot";

export interface BurstShooterConfig {
  ballsPerBurst?: number;
  timeBetweenBalls?: number;
  rpmDropPerBall?: number;
  acceleration?: number;
  maxRpm?: number;
}

export type ShotCallback = (event: "scored" | "missed") => void;

export class BurstShooter {
  public flywheelRpm = 0;
  private readonly config: Required<BurstShooterConfig>;

  private balls: Ball[] = [];
  private shots: { previousY: number; ball: Ball }[] = [];
  private ballsFired = 0;
  private timeToNextBall = 0;
  private isFiring = false;

  constructor(
    private game: Game,
    private robot: Robot,
    private hub: Hub,
    config: BurstShooterConfig = {}
  ) {
    this.config = {
      ballsPerBurst: 10,
      timeBetweenBalls: 0.05,
      rpmDropPerBall: 350,
      acceleration: 5000,
      maxRpm: 5000,
      ...config,
    };

    // Preallocate pool of balls
    for (let i = 0; i < this.config.ballsPerBurst; i++) {
      this.balls.push(new Ball());
    }
    game.stage.add(...this.balls.map((b) => b.mesh));
  }

  startBurst() {
    this.isFiring = true;
    this.ballsFired = 0;
    this.timeToNextBall = 0;
  }

  reset() {
    this.isFiring = false;
    for (const shot of this.shots) {
      shot.ball.remove(this.game.world);
    }
    this.shots = [];
    this.ballsFired = 0;
    this.timeToNextBall = 0;
  }

  get isBusy(): boolean {
    return this.isFiring || this.shots.length > 0;
  }

  update(dt: number, targetRpm: number, getShotAngle: () => number, onShotEvent?: ShotCallback) {
    // 1. Update Flywheel Physics
    const delta = targetRpm - this.flywheelRpm;
    const maxChange = this.config.acceleration * dt;
    if (Math.abs(delta) <= maxChange) {
      this.flywheelRpm = targetRpm;
    } else {
      this.flywheelRpm += Math.sign(delta) * maxChange;
    }

    // 2. Multi-ball firing sequence
    if (this.isFiring) {
      this.timeToNextBall -= dt;
      if (this.timeToNextBall <= 0) {
        this.fireSingleBall(getShotAngle());
        if (this.ballsFired >= this.config.ballsPerBurst) {
          this.isFiring = false;
        } else {
          this.timeToNextBall = this.config.timeBetweenBalls;
        }
      }
    }

    // 3. Update shots in flight
    if (this.shots.length === 0) return;

    this.game.stepPhysics(dt);

    for (let i = this.shots.length - 1; i >= 0; i--) {
      const shot = this.shots[i];
      shot.ball.syncMesh();

      const p = shot.ball.position;
      if (this.hub.isScoringCrossing(shot.previousY, p)) {
        onShotEvent?.("scored");
        this.finishShot(i);
        continue;
      }

      shot.previousY = p.y;

      if (!shot.ball.inBounds()) {
        onShotEvent?.("missed");
        this.finishShot(i);
      }
    }
  }

  private fireSingleBall(shotAngleDeg: number) {
    const start = this.robot.getMuzzlePosition();
    const speed = this.robot.rpmToLaunchSpeed(this.flywheelRpm);
    const fwd = this.robot.getForward();
    const angle = THREE.MathUtils.degToRad(shotAngleDeg);
    const horizontal = Math.cos(angle) * speed;

    const ball = this.balls[this.ballsFired];
    ball.place(start);
    this.ballsFired++;

    this.shots.push({ ball, previousY: start.y });
    ball.launch(this.game.world, start, {
      x: fwd.x * horizontal,
      y: Math.sin(angle) * speed,
      z: fwd.z * horizontal,
    });

    this.flywheelRpm = Math.max(0, this.flywheelRpm - this.config.rpmDropPerBall);
  }

  private finishShot(index: number) {
    const shot = this.shots[index];
    shot.ball.remove(this.game.world);
    this.shots.splice(index, 1);
  }
}