import * as THREE from "three";
import type { Game } from "../core/Game";
import type { ControlSpec, LevelInfo } from "../core/ui";
import { FIELD_LENGTH, FIELD_WIDTH, Floor } from "../entities/Floor";
import { Hub } from "../entities/Hub";
import { SimpleRobot } from "../entities/SimpleRobot";
import type { Level } from "./Level";
import type { CameraSpec } from "../core/Camera";
import { levels } from ".";
import { LessonPanel } from "../ui/LessonPanel";
import { FloorObstacles } from "../entities/FloorObstacles";
import { PathEditor } from "../entities/PathEditor";
import { PathFollower, wrapAngle } from "../core/PathFollower";
import { Robot } from "../entities/Robot";
import { Ball } from "../entities/Ball";
import { ScoreOverlay } from "../ui/ScoreOverlay";

// Robot start (x, z) -- also the first point of every path.
const START_X = -FIELD_LENGTH / 2 + 1;
const START_Z = -2;

// Command slew limits so the robot accelerates like a real drivetrain.
const MAX_LIN_ACCEL = 6; // m/s^2
const MAX_ANG_ACCEL = 20; // rad/s^2

type Mode = "design" | "run";

interface PendingRelease {
  ball: Ball;
  timer: number; // seconds until release
}

export class Level8 implements Level {
  private levelRequirement = 50;

  readonly info: LevelInfo = {
    index: 8,
    subtitle: "Putting It All Together",
    instructions: `Plan an auto that scores at least ${this.levelRequirement} points.`,
    targetLabel: "",
    modal: {
      title: "Full Auto Mode",
      body: "Real FRC auto routines don't just drive, they need to score points as well. Teams coordinate precise navigation with well-timed mechanism control. Now it's time to build a complete routine: pathfinding, intaking, positioning and shooting. How many can you score?",
    },
  };

  readonly controls: ControlSpec[] = [];

  private readonly driverStationCamera: CameraSpec = {
    type: "perspective",
    position: [-FIELD_LENGTH / 2 - 1, 1.7, -FIELD_WIDTH / 2 + 1.5],
    target: [0, 1.0, 0],
    fov: 70,
  };

  private readonly topDownCamera: CameraSpec = {
    type: "orthographic",
    position: [0, 8, 0],
    target: [0, 0, 0],
    halfHeight: 5,
  };

  private mode: Mode = "design";

  private game!: Game;
  private robot!: Robot;
  private hub!: Hub;
  private lessonPanel!: LessonPanel;

  private scoreOverlay!: ScoreOverlay;
  private editor!: PathEditor;
  private follower: PathFollower | null = null;
  private startHeading = 0;
  private lastScored = 0;

  private completed = false;

  private balls = new Set<Ball>();
  private ballsByCollider: Map<number, Ball> = new Map<number, Ball>();
  private pendingReleases: PendingRelease[] = [];

  // Last commanded (slew-limited) velocities
  private cmdVx = 0;
  private cmdVz = 0;
  private cmdOmega = 0;

  private successfulShots = 0;
  private totalShots = 0;

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

    // Path editor lives on the stage so it is drawn in the 3D scene
    this.editor = new PathEditor(
      game.renderer.domElement,
      () => game.camera, // <-- adjust if Game exposes its active camera differently
      { x: START_X, z: START_Z, heading: this.startHeading },
      { halfLength: FIELD_LENGTH / 2, halfWidth: FIELD_WIDTH / 2 },
      {
        shooting: {
          aimTarget: (x, z) => {
            return this.aimTarget(x, z);
          },
        },
      },
    );
    this.editor.onChange = () => this.refreshPanel();
    game.stage.add(this.editor.group);

    this.game.setCamera(this.topDownCamera);

    this.lessonPanel = new LessonPanel(this.game.ui.getLevelContainer());
    this.lessonPanel.setTitle("Autonomous Driving");
    this.lessonPanel.setBody(
      "Now the robot can collect balls from the field, but only from the " +
        "front. Set up waypoints with the right heading to collect from the " +
        "middle, and then come back with them. Select a waypoint and mark it " +
        "for shooting to score points.<br><br>" +
        `<b>Challenge:</b> Score at least ${this.levelRequirement} points with a single routine.`,
    );
    this.lessonPanel.setReadout("");
    this.lessonPanel.setResult("", false);
    this.refreshPanel();
    this.game.ui.setAction("NEXT LEVEL", false);
  }

  // ------------------------------------------------------------------------
  // Mode switching
  // ------------------------------------------------------------------------

  private aimTarget(x: number, z: number): { x: number; z: number } {
    if (x < Hub.HUB_X) {
      return { x: Hub.HUB_X, z: 0 };
    }
    if (z < 0) {
      return { x: (-FIELD_LENGTH / 2 + Hub.HUB_X) / 2, z: -FIELD_WIDTH / 2 };
    }
    return { x: (-FIELD_LENGTH / 2 + Hub.HUB_X) / 2, z: FIELD_WIDTH / 2 };
  }

  private addBall(ball: Ball) {
    this.balls.add(ball);
    this.ballsByCollider.set(ball.getCollider()!.handle, ball);
    this.game.stage.add(ball.mesh);
  }

  private releaseBall(ball: Ball) {
    ball.releaseFromHub({x: Hub.HUB_X, y: 0, z: 0}, this.game.world);
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

  private startRun() {
    const { samples, stops } = this.editor.getPlan();
    if (samples.length < 2) {
      return;
    }

    this.resetRobot();
    this.lastScored = 0;
    this.follower = new PathFollower(samples, stops);
    this.follower.onFire = (pose, stop) => {
      if (this.robot.getBallCount() <= 0) {
        return true;
      }

      const pos = this.robot.group.position;
      let distance = this.robot.getDistanceToHub(this.hub.group.position);
      if (pos.x > Hub.HUB_X) {
        const target = this.aimTarget(pos.x, pos.z);
        distance = this.robot.getDistanceToHub(new THREE.Vector3(target.x, 0, target.z));
      } else {
        this.totalShots++;
        this.scoreOverlay.setScore(this.successfulShots, this.totalShots);
      }
      const targetRpm = this.game.getRpmTable().getInterpolatedValue(distance);
      const start = this.robot.getMuzzlePosition();
      const speed = this.robot.rpmToLaunchSpeed(targetRpm.value);
      const fwd = this.robot.getForward();
      const angle = THREE.MathUtils.degToRad(this.robot.getShotAngleForDistance(distance));
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
    };
    this.mode = "run";
    this.editor.setEnabled(false);
    this.game.setCamera(this.driverStationCamera);
    this.refreshPanel();
  }

  private stopRun() {
    this.follower = null;
    this.mode = "design";
    this.resetRobot();
    this.editor.setEnabled(true);
    this.game.setCamera(this.topDownCamera);
    this.refreshPanel();
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
    this.cmdVx = this.cmdVz = this.cmdOmega = 0;

    const pos = this.robot.getPhysicsBody()!.translation();
    const q = this.robot.getPhysicsBody()!.rotation();
    this.robot.group.position.set(
      pos.x,
      pos.y - SimpleRobot.ROBOT_HEIGHT / 2,
      pos.z,
    );
    this.robot.group.quaternion.set(q.x, q.y, q.z, q.w);
  }

  private drive(vx: number, vz: number, omega: number) {
    const body = this.robot.getPhysicsBody();
    if (!body) {
      return;
    }
    body.setLinvel({ x: vx, y: body.linvel().y, z: vz }, true);
    body.setAngvel({ x: 0, y: omega, z: 0 }, true);
  }

  private approach(current: number, target: number, maxStep: number) {
    return current + THREE.MathUtils.clamp(target - current, -maxStep, maxStep);
  }

  // ------------------------------------------------------------------------
  // Frame update
  // ------------------------------------------------------------------------

  update(dt: number) {
    if (this.mode === "run" && this.follower) {
      const pos = this.robot.group.position;
      const pose = {
        x: pos.x,
        z: pos.z,
        heading: this.yawOf(this.robot.group.quaternion),
      };
      const cmd = this.follower.update(pose, dt);

      this.cmdVx = this.approach(this.cmdVx, cmd.vx, MAX_LIN_ACCEL * dt);
      this.cmdVz = this.approach(this.cmdVz, cmd.vz, MAX_LIN_ACCEL * dt);
      this.cmdOmega = this.approach(
        this.cmdOmega,
        cmd.omega,
        MAX_ANG_ACCEL * dt,
      );
      this.drive(this.cmdVx, this.cmdVz, this.cmdOmega);
    }

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

    const pos = this.robot.getPhysicsBody()!.translation();
    const q = this.robot.getPhysicsBody()!.rotation();
    this.robot.group.position.set(
      pos.x,
      pos.y - SimpleRobot.ROBOT_HEIGHT / 2,
      pos.z,
    );
    this.robot.group.quaternion.set(q.x, q.y, q.z, q.w);

    if (this.mode === "run" && this.follower) {
      if (
        this.follower.finished &&
        performance.now() - this.lastScored > 5000
      ) {
        this.robot.getPhysicsBody()?.setAngvel({ x: 0, y: 0, z: 0 }, true);
        if (this.successfulShots >= this.levelRequirement) {
          this.completed = true;
          this.mode = "design";
          this.follower = null;
          this.editor.setEnabled(false);
          this.refreshPanel();
        } else {
          // The attempt is over, but the objective wasn't satisfied.
          this.follower = null;
          this.mode = "design";
          this.game.setCamera(this.topDownCamera);
          this.lessonPanel.setResult("", false);
          this.lessonPanel.setButtons([
            {
              label: "Try again",
              primary: true,
              onClick: () => {
                this.editor.setEnabled(true);
                this.resetRobot();
                this.refreshPanel();
              },
            },
          ]);
        }
      }
    }
  }

  private refreshPanel() {
    if (this.completed) {
      this.lessonPanel.setResult("Challenge complete!");
      this.lessonPanel.setButtons([
        {
          label: "This is fun, do it again",
          onClick: () => {
            this.completed = false;
            this.successfulShots = 0;
            this.totalShots = 0;
            this.scoreOverlay.setScore(this.successfulShots, this.totalShots);
            this.stopRun();
          },
        },
      ]);
      this.game.ui.setAction("NEXT LEVEL", true);
      return;
    }

    if (this.mode === "run") {
      this.lessonPanel.setResult("", false);
      this.lessonPanel.setButtons([
        {
          label: "Edit path",
          onClick: () => this.stopRun(),
        },
      ]);
      return;
    }

    this.lessonPanel.setResult("", false);
    this.lessonPanel.setButtons([
      {
        label: this.editor.selectedShoots ? "Shooting: on" : "Shoot here",
        onClick: () => {
          this.editor.toggleSelectedShoot();
          this.refreshPanel();
        },
        disabled: !this.editor.hasSelection,
      },
      {
        label: "Delete waypoint",
        onClick: () => {
          this.editor.deleteSelected();
          this.refreshPanel();
        },
        disabled: !this.editor.hasSelection,
      },
      {
        label: "Clear path",
        onClick: () => {
          this.editor.clear();
          this.refreshPanel();
        },
        disabled: this.editor.count < 1,
      },
      {
        label: "Run path",
        primary: true,
        onClick: () => this.startRun(),
        disabled: this.editor.count < 2,
      },
    ]);
  }

  // ------------------------------------------------------------------------
  // Level lifecycle
  // ------------------------------------------------------------------------

  onAction() {
    const level = levels[this.info.index]?.();
    if (level) this.game.loadLevel(level);
  }

  dispose() {
    this.editor.dispose();
    this.lessonPanel.dispose();
    for (const b of [...this.balls]) {
      this.removeBall(b);
    }
  }
}
