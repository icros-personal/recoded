import * as THREE from "three";
import type { Game } from "../core/Game";
import type { ControlSpec, LevelInfo } from "../core/ui";
import { FIELD_LENGTH, FIELD_WIDTH, Floor } from "../entities/Floor";
import { Hub } from "../entities/Hub";
import { SimpleRobot } from "../entities/SimpleRobot";
import type { Level } from "./Level";
import type { CameraSpec } from "../core/Camera";
import { levels } from ".";
import { FloorObstacles } from "../entities/FloorObstacles";
import { PathEditor } from "../entities/PathEditor";
import { PathFollower } from "../core/PathFollower";
import { Robot } from "../entities/Robot";
import { Ball } from "../entities/Ball";
import { ScoreOverlay } from "../ui/ScoreOverlay";
import { KeyboardListener } from "../core/KeyboardListener";
import type { TouchOverlay } from "../ui/TouchOverlay";

// Robot start (x, z) -- also the first point of every path.
const START_X = -FIELD_LENGTH / 2 + 1;
const START_Z = -2;

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

// Command slew limits so the robot accelerates like a real drivetrain.
const MAX_LIN_ACCEL = 6; // m/s^2
const MAX_ANG_ACCEL = 20; // rad/s^2

const TURN_SPEED = 5.0; // rad/s at full turn input
// keeps the motion from looking jerky
const TURN_LAG = 0.05; // seconds
// adds seconds of sensor/motor latency
const TURN_DELAY = 0.06;

interface PendingRelease {
  ball: Ball;
  timer: number; // seconds until release
}

export class Level9 implements Level {
  private levelRequirement = 50;

  readonly info: LevelInfo = {
    index: 9,
    subtitle: "How did we get here?",
    instructions:
      "Drive with WASD, rotate with J/L, and press K to shoot. Adjust your shot table and Kp in settings.",
    targetLabel: "",
    modal: {
      title: "Just for Fun",
      body: "Congratulations! You finished all the levels so far.",
    },
  };

  readonly controls: ControlSpec[] = [];

  private readonly driverStationCamera: CameraSpec = {
    type: "perspective",
    position: [-FIELD_LENGTH / 2 - 1, 1.7, -FIELD_WIDTH / 2 + 1.5],
    target: [0, 1.0, 0],
    fov: 70,
  };

  private game!: Game;
  private robot!: Robot;
  private hub!: Hub;

  private scoreOverlay!: ScoreOverlay;
  private startHeading = 0;
  private lastScored = 0;

  private balls = new Set<Ball>();
  private ballsByCollider: Map<number, Ball> = new Map<number, Ball>();
  private pendingReleases: PendingRelease[] = [];

  private appliedTurn = 0; // lagged turn command actually sent to the drive
  private cmdQueue: { t: number; cmd: number }[] = [];
  private time = 0;

  private successfulShots = 0;
  private totalShots = 0;
  private lastShotTime = 0;

  private keyboardListener!: KeyboardListener;
  private touchOverlay: TouchOverlay | null = null;

  setup(game: Game) {
    this.game = game;

    this.game.initializeRpmTableIfEmpty([
      [1.5, 2500],
      [3.0, 3500],
      [5.0, 4800],
    ]);

    this.scoreOverlay = new ScoreOverlay(
      this.game.renderer.domElement.parentElement!,
    );
    this.scoreOverlay.setScore(this.successfulShots, this.totalShots);

    // Floor, hubs, obstacles
    const floor = new Floor(true);
    floor.addColliders(game.world);

    this.hub = new Hub(Hub.HUB_X);
    this.hub.addColliders(game.world, true);
    const blueHub = new Hub(-Hub.HUB_X);
    blueHub.addColliders(game.world);

    const obstacles = new FloorObstacles();
    obstacles.addColliders(game.world);

    this.robot = new Robot(START_X, START_Z);
    this.robot.addColliders(game.world);
    this.startHeading = this.yawOf(this.robot.group.quaternion);

    this.resetField();

    game.stage.add(
      floor.mesh,
      this.robot.group,
      this.hub.group,
      blueHub.group,
      obstacles.group,
    );

    this.game.setCamera(this.driverStationCamera);
    this.game.ui.setAction("RESET", true);

    this.keyboardListener = new KeyboardListener((e, isDown) => {
      if (e.key.toLowerCase() === "k") {
        this.handleShootInput(isDown);
      }
    });
  }

  private handleShootInput(isDown: boolean) {}

  private aimTarget(x: number, z: number): { x: number; z: number } {
    if (x < Hub.HUB_X) {
      return { x: Hub.HUB_X, z: 0 };
    }
    if (z < 0) {
      return { x: (-FIELD_LENGTH / 2 + Hub.HUB_X) / 2, z: -FIELD_WIDTH / 4 };
    }
    return { x: (-FIELD_LENGTH / 2 + Hub.HUB_X) / 2, z: FIELD_WIDTH / 4 };
  }

  private addBall(ball: Ball) {
    this.balls.add(ball);
    this.ballsByCollider.set(ball.getCollider()!.handle, ball);
    this.game.stage.add(ball.mesh);
  }

  private releaseBall(ball: Ball) {
    ball.releaseFromHub({ x: Hub.HUB_X, y: 0, z: 0 }, this.game.world);
    this.balls.add(ball);
    this.ballsByCollider.set(ball.getCollider()!.handle, ball);
    this.game.stage.add(ball.mesh);
  }

  private removeBall(ball: Ball) {
    if (!this.balls.delete(ball)) return;
    this.ballsByCollider.delete(ball.getCollider()!.handle);
    ball.remove(this.game.world);
    ball.mesh.removeFromParent();
  }

  private resetField() {
    for (const ball of [...this.balls]) {
      this.removeBall(ball);
    }

    for (let ix = 0; ix < 12; ix++) {
      for (let iz = 0; iz < 30; iz++) {
        const ball = new Ball("field");
        const x = (ix - (12 - 1) / 2) * Ball.RADIUS * 2;
        const z = (iz - (30 - 1) / 2) * Ball.RADIUS * 2;
        ball.place({ x, y: Ball.RADIUS, z });
        ball.addColliders(this.game.world);
        this.addBall(ball);
      }
    }
  }

  private shoot() {
    if (this.robot.getBallCount() <= 0) {
      return;
    }

    const pos = this.robot.group.position;
    let distance = this.robot.getDistanceToHub(this.hub.group.position);
    if (pos.x > Hub.HUB_X) {
      const target = this.aimTarget(pos.x, pos.z);
      distance = this.robot.getDistanceToHub(
        new THREE.Vector3(target.x, 0, target.z),
      );
    } else {
      this.totalShots++;
      this.scoreOverlay.setScore(this.successfulShots, this.totalShots);
    }
    const targetRpm = this.game.getRpmTable().getInterpolatedValue(distance);
    const start = this.robot.getMuzzlePosition();
    const speed = this.robot.rpmToLaunchSpeed(targetRpm.value);
    const fwd = this.robot.getForward();
    const angle = THREE.MathUtils.degToRad(
      this.robot.getShotAngleForDistance(distance),
    );
    const horizontal = Math.cos(angle) * speed;

    const ball = new Ball("field");
    ball.place(start);
    this.game.stage.add(ball.mesh);
    ball.launch(this.game.world, start, {
      x: fwd.x * horizontal,
      y: Math.sin(angle) * speed,
      z: fwd.z * horizontal,
    });
    this.addBall(ball);
    this.robot.removeBall();
    return false;
  }

  // ------------------------------------------------------------------------
  // Robot adapter -- the only place that touches the physics body.
  // Assumes Robot exposes its Rapier RigidBody as `robot.body` and that the
  // body's rotation is only free about Y. Adjust these if yours differs.
  // ------------------------------------------------------------------------

  private yawOf(q: { x: number; y: number; z: number; w: number }) {
    // Quaternion -> yaw (avoids Euler's +/-90deg limit on the Y axis)
    return wrapAngle(2 * Math.atan2(q.y, q.w));
  }

  private resetRobot() {
    const body = this.robot.getPhysicsBody();
    if (!body) {
      return;
    }

    this.robot.clearBalls();
    this.resetField();
    this.successfulShots = 0;
    this.totalShots = 0;
    this.lastScored = 0;
    this.scoreOverlay.setScore(this.successfulShots, this.totalShots);

    const y = body.translation().y;
    body.setTranslation({ x: START_X, y, z: START_Z }, true);
    const h = this.startHeading;
    body.setRotation(
      { x: 0, y: Math.sin(h / 2), z: 0, w: Math.cos(h / 2) },
      true,
    );
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);

    const pos = this.robot.getPhysicsBody()!.translation();
    const q = this.robot.getPhysicsBody()!.rotation();
    this.robot.group.position.set(
      pos.x,
      pos.y - SimpleRobot.ROBOT_HEIGHT / 2,
      pos.z,
    );
    this.robot.group.quaternion.set(q.x, q.y, q.z, q.w);
  }

  // ------------------------------------------------------------------------
  // Frame update
  // ------------------------------------------------------------------------

  private stepTurnModel(cmd: number, dt: number): number {
    this.cmdQueue.push({ t: this.time, cmd });
    while (
      this.cmdQueue.length > 1 &&
      this.cmdQueue[1]!.t <= this.time - TURN_DELAY
    ) {
      this.cmdQueue.shift();
    }
    const delayed = this.cmdQueue[0]!.cmd; // what the robot is acting on *now*
    const alpha = 1 - Math.exp(-dt / TURN_LAG);
    this.appliedTurn += (delayed - this.appliedTurn) * alpha;
    return this.appliedTurn;
  }

  update(dt: number) {
    this.time += dt;
    const moveSpeed = 4.0; // meters per second
    const turnSpeed = 2.5; // radians per second

    let forwardInput =
      (this.keyboardListener.isDown("w") ? 1 : 0) -
      (this.keyboardListener.isDown("s") ? 1 : 0);
    let strafeInput =
      (this.keyboardListener.isDown("d") ? 1 : 0) -
      (this.keyboardListener.isDown("a") ? 1 : 0);
    let turnInput =
      (this.keyboardListener.isDown("j") ? 1 : 0) -
      (this.keyboardListener.isDown("l") ? 1 : 0);

    if (this.touchOverlay) {
      if (Math.abs(this.touchOverlay.state.forward) > 0) {
        forwardInput = this.touchOverlay.state.forward;
      }
      if (Math.abs(this.touchOverlay.state.strafe) > 0) {
        strafeInput = this.touchOverlay.state.strafe;
      }

      if (this.touchOverlay.state.turnRight) {
        turnInput = -1;
      }
      if (this.touchOverlay.state.turnLeft) {
        turnInput = 1;
      }
    }

    let tryingToShoot = this.keyboardListener.isDown("k");
    if (this.touchOverlay?.state.shoot) {
      tryingToShoot = true;
    }

    if (tryingToShoot) {
      const robotPos = this.robot.group.position;
      const target = this.aimTarget(robotPos.x, robotPos.z);

      const dx = target.x - robotPos.x;
      const dz = target.z - robotPos.z;
      const targetHeading = Math.atan2(dx, dz);
      const currentHeading = this.robot.group.rotation.y + Math.PI / 2;
      const angleError = wrapAngle(targetHeading - currentHeading);
      let turnCmd = clamp(this.game.getKp() * angleError, -1, 1);
      turnCmd = this.stepTurnModel(turnCmd, dt);
      turnInput = turnCmd;
      const alignmentTolerance = 0.1;
      if (Math.abs(angleError) < alignmentTolerance) {
        const now = performance.now();
        const fireIntervalMs = 50;
        if (now - (this.lastShotTime || 0) >= fireIntervalMs) {
          this.shoot();
          this.lastShotTime = now;
        }
      }
    }

    this.robot.updateDrive(
      forwardInput,
      strafeInput,
      turnInput,
      moveSpeed,
      turnSpeed,
      dt,
    );

    this.game.stepPhysics(dt);

    const collected: Ball[] = [];
    this.game.world.intersectionPairsWith(
      this.robot.getIntakeCollider(),
      (otherCollider) => {
        const ball = this.ballsByCollider.get(otherCollider.handle);
        if (ball) {
          collected.push(ball);
        }
      },
    );

    for (const ball of collected) {
      if (this.robot.getBallCount() < this.robot.getMaxCapacity()) {
        this.removeBall(ball);
        this.robot.addBall();
      }
    }

    collected.length = 0;

    const hubCollider = this.hub.getScoreCollider();
    if (hubCollider) {
      this.game.world.intersectionPairsWith(hubCollider, (ballCollider) => {
        const ball = this.ballsByCollider.get(ballCollider.handle);
        if (ball) {
          collected.push(ball);
        }
      });
    }

    for (const ball of collected) {
      this.successfulShots++;
      this.lastScored = performance.now();
      this.removeBall(ball);
      this.pendingReleases.push({ ball, timer: 0.5 });
    }
    this.scoreOverlay.setScore(this.successfulShots, this.totalShots);

    for (let i = this.pendingReleases.length - 1; i >= 0; i--) {
      const pendingRelease = this.pendingReleases[i]!;
      pendingRelease.timer -= dt;
      if (pendingRelease.timer <= 0) {
        this.releaseBall(pendingRelease.ball);
        this.pendingReleases.splice(i, 1);
      }
    }

    for (const ball of this.balls) {
      ball.syncMesh();
    }
  }

  // ------------------------------------------------------------------------
  // Level lifecycle
  // ------------------------------------------------------------------------

  onAction() {
    this.resetField();
    this.resetRobot();
  }

  dispose() {
    for (const b of [...this.balls]) {
      this.removeBall(b);
    }
  }
}
