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
import { inAllianceZone, inNeutralZone } from "../core/zoneChecks";
import { Robot } from "../entities/Robot";
import { Ball } from "../entities/Ball";

// Robot start (x, z) -- also the first point of every path.
const START_X = -FIELD_LENGTH / 2 + 1;
const START_Z = -2;

// Command slew limits so the robot accelerates like a real drivetrain.
const MAX_LIN_ACCEL = 6; // m/s^2
const MAX_ANG_ACCEL = 20; // rad/s^2

type Mode = "design" | "run";

export class Level8 implements Level {
  readonly info: LevelInfo = {
    index: 8,
    subtitle: "Full auto!",
    instructions:
      "Set a path that the robot can follow that crosses into the middle and then comes back.",
    targetLabel: "",
    modal: {
      title: "Autonomous Driving",
      body: "During a match, a driver reacts to what's happening on the field. But what if the robot could handle some of that driving itself?  FRC teams can program autonomous routines before a match begins. They plan a route through a series of waypoints, then use a path-following algorithm to steer the robot along it.",
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

  private editor!: PathEditor;
  private follower: PathFollower | null = null;
  private startHeading = 0;

  private visitedMiddle = false;
  private completed = false;

  private balls = new Set<Ball>();
  private ballsByCollider: Map<number, Ball> = new Map<number, Ball>();

  // Last commanded (slew-limited) velocities
  private cmdVx = 0;
  private cmdVz = 0;
  private cmdOmega = 0;

  setup(game: Game) {
    this.game = game;

    this.game.initializeRpmTableIfEmpty([
      [1.5, 2500],
      [3.0, 3500],
      [5.0, 4800],
    ])

    // Floor, hubs, obstacles
    const floor = new Floor(true);
    floor.addColliders(game.world);

    this.hub = new Hub(Hub.HUB_X);
    this.hub.addColliders(game.world);
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
      {shooting: {aimTarget: (x, z) => {
        if (x < Hub.HUB_X) {
          return {x: Hub.HUB_X, z: 0};
        }
        if (z < 0) {
          return {x: (-FIELD_LENGTH / 2 + Hub.HUB_X) / 2, z: -FIELD_WIDTH / 2};
        }
        return {x: (-FIELD_LENGTH / 2 + Hub.HUB_X) / 2, z: FIELD_WIDTH / 2};
      }}}
    );
    this.editor.onChange = () => this.refreshPanel();
    game.stage.add(this.editor.group);

    this.game.setCamera(this.topDownCamera);

    this.lessonPanel = new LessonPanel(this.game.ui.getLevelContainer());
    this.lessonPanel.setTitle("Autonomous Driving");
    this.lessonPanel.setBody(
      "Drivers usually control the robot during a match, but FRC teams " +
        "can also program autonomous routines. Plan a route through a series " +
        "of waypoints, then let the robot attempt to follow it.<br><br>" +
        "<b>Challenge:</b> Travel from your starting area into the middle " +
        "of the field, then return to your starting area and aim at the hub.",
    );
    this.lessonPanel.setResult("", false);
    this.refreshPanel();
    this.game.ui.setAction('NEXT LEVEL', false);
  }

  // ------------------------------------------------------------------------
  // Mode switching
  // ------------------------------------------------------------------------

  private addBall(ball: Ball) {
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
        const ball =  new Ball('field');
        const x = (ix - (12 - 1) / 2) * Ball.RADIUS * 2;
        const z = (iz - (30 - 1) / 2) * Ball.RADIUS * 2;
        ball.place({x, y: Ball.RADIUS, z});
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
    this.visitedMiddle = false;
    this.completed = false;
    this.follower = new PathFollower(samples, stops);
    this.follower.onFire = (pose, stop) => {
      if (this.robot.getBallCount() <= 0) {
        return true;
      }

      const distance = this.robot.getDistanceToHub(this.hub.group.position);
      const targetRpm = this.game.getRpmTable().getInterpolatedValue(distance);
      const start = this.robot.getMuzzlePosition();
      const speed = this.robot.rpmToLaunchSpeed(targetRpm.value);
      const fwd = this.robot.getForward();
      const angle = THREE.MathUtils.degToRad(this.robot.getShotAngle(this.hub));
      const horizontal = Math.cos(angle) * speed;

      const ball = new Ball('field');
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
    this.robot.group.position.set(pos.x, pos.y - SimpleRobot.ROBOT_HEIGHT / 2, pos.z);
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
    this.game.world.intersectionPairsWith(this.robot.getIntakeCollider(), (otherCollider) => {
      const ball = this.ballsByCollider.get(otherCollider.handle);
      if (ball) {
        collected.push(ball);
      }
    });

    for (const ball of collected) {
      if (this.robot.getBallCount() < this.robot.getMaxCapacity()) {
        this.removeBall(ball);
        this.robot.addBall();
      }
    }

    for (const ball of this.balls) {
      ball.syncMesh();
    }
    const pos = this.robot.getPhysicsBody()!.translation();
    const q = this.robot.getPhysicsBody()!.rotation();
    this.robot.group.position.set(pos.x, pos.y - SimpleRobot.ROBOT_HEIGHT / 2, pos.z);
    this.robot.group.quaternion.set(q.x, q.y, q.z, q.w);

    if (this.mode === "run" && this.follower) {
      const pos = this.robot.group.position;
      if (inNeutralZone(pos.x, pos.z)) {
        this.visitedMiddle = true;
      }

      if (this.follower.finished) {
        this.robot.getPhysicsBody()?.setAngvel({x: 0, y: 0, z: 0}, true);
        if (this.visitedMiddle && inAllianceZone(pos.x, pos.z) && this.isPointingAtHub()) {
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
          this.lessonPanel.setReadout(
            this.visitedMiddle
              ? "The robot reached the middle, but didn't finish in the starting area pointing at the hub. Try another route."
              : "The robot finished without reaching the middle zone. Try another route.",
          );
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

  private isPointingAtHub(): boolean {
    const robotPos = this.robot.group.position;
    const hubPos = this.hub.group.position;

    // 1. Vector from robot to hub
    const dx = hubPos.x - robotPos.x;
    const dz = hubPos.z - robotPos.z;

    // 2. Target angle, current heading, and the (wrapped) error between them
    const targetHeading = Math.atan2(dx, dz);
    const currentHeading = this.robot.group.rotation.y + Math.PI / 2;
    const angleError = wrapAngle(targetHeading - currentHeading);
    return Math.abs(angleError) < Math.PI / 9; // within 20 degrees?
  }

  private refreshPanel() {
    if (this.completed) {
      this.lessonPanel.setReadout("Autonomous route completed!", true);
      this.lessonPanel.setResult(
        "Challenge complete! Your robot travelled through the middle of the field and returned to its starting area pointed at the hub.",
      );
      this.lessonPanel.setButtons([{
        label: "This is fun, do it again",
        onClick: () => {
          this.completed = false;
          this.visitedMiddle = false;
          this.stopRun();
        }
      }]);
      this.game.ui.setAction('NEXT LEVEL', true);
      return;
    }

    if (this.mode === "run") {
      this.lessonPanel.setReadout(
        this.visitedMiddle
          ? "Middle zone reached! Return to the starting area."
          : "Following path... Travel through the middle zone.",
      );
      this.lessonPanel.setResult("", false);
      this.lessonPanel.setButtons([
        {
          label: "Edit path",
          onClick: () => this.stopRun(),
        },
      ]);
      return;
    }

    this.lessonPanel.setReadout(
      "Add waypoints to enter the middle zone, return to the starting area and point at the hub.",
    );
    this.lessonPanel.setResult("", false);
    this.lessonPanel.setButtons([
      {
        label: this.editor.selectedShoots ? 'Shooting: on': 'Shoot here',
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
