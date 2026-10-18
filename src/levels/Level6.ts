import * as THREE from "three";
import type { Game } from "../core/Game";
import type { ControlSpec, LevelInfo } from "../core/ui";
import { FIELD_LENGTH, FIELD_WIDTH, Floor } from "../entities/Floor";
import { Hub } from "../entities/Hub";
import { SimpleRobot } from "../entities/SimpleRobot";
import type { Level } from "./Level";
import type { CameraSpec } from "../core/Camera";
import { levels } from ".";
import { TouchOverlay } from "../ui/TouchOverlay";
import { KeyboardListener } from "../core/KeyboardListener";
import { LessonPanel } from "../ui/LessonPanel";
import { ErrorGraph } from "../ui/ErrorGraph";
import { FloorObstacles } from "../entities/FloorObstacles";

// --- Turning model -------------------------------------------------------
const TURN_SPEED = 5.0; // rad/s at full turn input
// keeps the motion from looking jerky
const TURN_LAG = 0.05; // seconds
// adds seconds of sensor/motor latency
const TURN_DELAY = 0.06;

// --- Tuning / display ----------------------------------------------------
const KP_MIN = 0.1;
const KP_MAX = 2;
const KP_STEP = 0.1;
const KP_START = 0.1; // deliberately too low so students discover they need more
const ALIGNED_TOLERANCE = (2 * Math.PI) / 180; // 2 degrees
const GRAPH_SECONDS = 4;

const TEST_START_ERROR = (80 * Math.PI) / 180;
const SETTLE_HOLD = 0.4;
const TARGET_SETTLE = 1.5;
const TRIAL_TIMEOUT = 6;

type Stage = "geometry" | "bangbang" | "proportional";

const toDeg = (r: number) => (r * 180) / Math.PI;
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
/** Wrap to [-PI, PI] so we always turn the short way around. */
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

interface Trial {
  elapsed: number;
  inTolSince: number | null;
  overshoot: number; // peak error past zero, radians
  startSign: number;
}

interface TrialResult {
  settle: number | null;
  overshoot: number; // radians
  ok: boolean;
}

export class Level6 implements Level {
  readonly info: LevelInfo = {
    index: 6,
    subtitle: "How do I turn this thing anyway?",
    instructions:
      "Work out which way to turn, try a bang-bang controller, then tune a proportional one.",
    targetLabel: "",
    modal: {
      title: "The Long Road to Automatic Aim",
      body: "To aim, the robot needs a target angle (from the vector between robot and hub) and a rule for turning toward it. A bang-bang controller always uses full power, so it overshoots and wobbles. A proportional (P) controller scales power by the remaining error, so it eases in smoothly. You'll build up to it in three steps.",
    },
  };

  readonly controls: ControlSpec[] = [];

  // Camera specs for toggling
  private readonly driverStationCamera: CameraSpec = {
    type: "perspective",
    position: [-FIELD_LENGTH / 2 - 1, 1.7, -FIELD_WIDTH / 2 + 1.5],
    target: [0, 1.0, 0],
    fov: 70,
  };

  private readonly topDownCamera: CameraSpec = {
    type: "perspective",
    position: [Hub.HUB_X, 7, 0],
    target: [Hub.HUB_X, 0, 0],
    fov: 60,
  };

  private isTopDown = false;

  private game!: Game;
  private robot!: SimpleRobot;
  private hub!: Hub;
  private touchOverlay: TouchOverlay | null = null;
  private lessonPanel!: LessonPanel;
  private errorGraph!: ErrorGraph;

  // Lesson state
  private stage: Stage = "geometry";
  private kp = KP_START;
  private bangBangOn = false;
  private pEnabled = false;
  private appliedTurn = 0; // lagged turn command actually sent to the drive
  private cmdQueue: { t: number; cmd: number }[] = [];
  private time = 0;
  private errorHistory: { t: number; e: number }[] = [];

  private trial: Trial | null = null;
  private lastResult: TrialResult | null = null;
  private passed = false;

  // Visual aids
  private facingArrow!: THREE.ArrowHelper;
  private targetArrow!: THREE.ArrowHelper;

  private keyboardListener!: KeyboardListener;

  setup(game: Game) {
    this.game = game;

    if (
      window.PointerEvent &&
      "maxTouchPoints" in navigator &&
      navigator.maxTouchPoints > 0
    ) {
      const parent = this.game.renderer.domElement.parentElement!;
      this.touchOverlay = new TouchOverlay(parent, {
        noTranslate: true,
      });
    }

    // Setup Floor, Walls, and Hubs
    const floor = new Floor(true);
    floor.addColliders(game.world);

    const obstacles = new FloorObstacles();
    obstacles.addColliders(game.world);

    this.hub = new Hub(Hub.HUB_X);
    this.hub.addColliders(game.world);

    // Start robot near the driver station end
    this.robot = new SimpleRobot(-FIELD_LENGTH / 2 + 1, -2);
    this.robot.addColliders(game.world);

    // Arrows: blue = where the robot faces, green = where it SHOULD face
    this.facingArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(),
      2,
      0x4aa3ff,
      0.4,
      0.25,
    );
    this.targetArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(),
      3,
      0x5ee6a8,
      0.4,
      0.25,
    );

    game.stage.add(
      floor.mesh,
      obstacles.group,
      this.robot.group,
      this.hub.group,
      this.facingArrow,
      this.targetArrow,
    );

    this.lessonPanel = new LessonPanel(this.game.ui.getLevelContainer());
    this.errorGraph = new ErrorGraph(window.innerWidth / 2, window.innerHeight / 8);
    this.lessonPanel.setCustomContent(this.errorGraph.canvas);

    this.keyboardListener = new KeyboardListener((e, isDown) =>
      this.handleKey(e, isDown),
    );

    this.resetLevelState(false);
    this.setStage("geometry");
  }

  private setStage(stage: Stage) {
    this.lessonPanel.scrollToTop();
    this.stage = stage;
    this.bangBangOn = false;
    this.pEnabled = false;
    this.trial = null;
    this.lastResult = null;
    if (stage === "bangbang") {
      this.scrambleHeading();
    } else {
      this.resetTurnModel();
    }
    this.errorHistory = [];

    // Top-down is best for seeing angles; driver station is best for shooting
    this.isTopDown = true;
    this.game.setCamera(
      this.isTopDown ? this.topDownCamera : this.driverStationCamera,
    );

    this.renderStage();
    this.updateUIStatus();
  }

  private renderStage() {
    this.lessonPanel.setResult(this.resultText(), this.stage === 'proportional');
    if (this.stage === "geometry") {
      this.lessonPanel.setTitle("1 · Where are we, and where should we point?");
      this.lessonPanel.setBody(`
        Think of the floor as a flat map: every position is an <b>(x, z)</b> pair.
        The <b>vector</b> from the robot to the hub is just subtraction:
        <br><code>d = (hubX − robotX, hubZ − robotZ) = (dx, dz)</code>
        <br>The direction that vector points is the <b>target angle</b> (the green arrow):
        <br><code>target = atan2(dx, dz)</code>
        <br>The robot also has a <b>heading</b> θ (the blue arrow). The difference is the <b>error</b>:
        <br><code>error = target − θ</code>
        <br>(We keep it between −180° and 180° so we always turn the short way.)
        <br><br><b>Try it:</b> turn with <b>A / D</b> (or ←/→) until the error reads 0°. The green arrow is where you <i>should</i> face. Our controller's whole job is to drive that error to zero.
      `);
      this.lessonPanel.setButtons([
        {label: "Next ▶", onClick: () => this.setStage('bangbang')}
      ]);
    } else if (this.stage === "bangbang") {
      this.lessonPanel.setTitle("2 · The simplest controller: bang-bang");
      this.lessonPanel.setBody(`
        Rule: if the error is positive, turn one way at <b>full power</b>; if negative, turn the other way at full power.
        <br><code>output = error &gt; 0 ? +1 : −1</code>
        <br>Press <b>Enable</b> and watch the error graph. The robot is always acting on slightly old information (sensor and motor delay), so by the time it reverses it has already flown past the target. It overshoots, flips, overshoots the other way, and never settles.
        <br>Hit <b>Scramble</b> to try it from a new heading.
      `);
      this.lessonPanel.setButtons([
        {
          label: this.bangBangOn ? 'Disable bang-bang' : 'Enable bang-bang',
          onClick: () => {
            this.bangBangOn = !this.bangBangOn;
            this.renderStage();
          }
        },
        { label: "Scramble ⟲", onClick: () => this.scrambleHeading() },
        { label: "◀ Back", onClick: () => this.setStage("geometry") },
        { label: "Next ▶", onClick: () => this.setStage("proportional") },
      ]);
    } else {
      this.lessonPanel.setTitle("3 · Proportional control");
      this.lessonPanel.setBody(`
        Better idea: the further away you are, the harder you push.
        <br><code>output = kP × error</code> (limited to −1…+1)
        <br>Big error → full speed. Small error → gentle. Zero error → stop. The robot brakes <i>itself</i> as it arrives.
        <br><b>kP</b> is the gain you tune: too low and the robot is lazy; too high and it overshoots and wobbles (crank it far enough and it turns back into bang-bang!).
        <br><br><b>Your challenge:</b> pick a kP (↑ / ↓ or the buttons), then press <b>Run test</b>. The robot starts ${Math.round(toDeg(TEST_START_ERROR))}° off target. Settle to within ${Math.round(toDeg(ALIGNED_TOLERANCE))}° in under <b>${TARGET_SETTLE} s</b> to pass.
        ${this.passed ? "<br><b>Passed!</b> You can now fire some balls (hold K or the Shoot button) and press Next Level when ready." : ""}
      `);
      this.lessonPanel.setButtons([
        {
          label: this.pEnabled ? 'Disable P control' : 'Enable P control',
          onClick: () => {
            this.pEnabled = !this.pEnabled;
            if (!this.pEnabled) {
              this.trial = null;
            }
            this.renderStage();
          }
        },
        { label: "kP −", onClick: () => this.changeKp(-KP_STEP) },
        { label: "kP +", onClick: () => this.changeKp(KP_STEP) },
        { label: "Run test ▶", onClick: () => this.startTrial() },
        { label: "◀ Back", onClick: () => this.setStage("bangbang") },
      ]);
    }
  }

  private changeKp(delta: number) {
    this.kp = clamp(Math.round((this.kp + delta) * 100) / 100, KP_MIN, KP_MAX);
    this.updateUIStatus();
  }

  private scrambleHeading() {
    this.robot.group.rotation.y = Math.random() * Math.PI * 2;
    this.resetTurnModel();
    this.errorHistory = [];
  }

  private setHeadingError(err: number) {
    const robotPos = this.robot.group.position;
    const hubPos = this.hub.group.position;
    const target = Math.atan2(hubPos.x - robotPos.x, hubPos.z - robotPos.z);
    // error = target - heading and heading = rotation.y + PI/2
    this.robot.group.rotation.y = target - err - Math.PI / 2;
  }

  private startTrial() {
    if (this.stage !== "proportional") {
      return;
    }
    const sign = Math.random() < 0.5 ? -1 : 1;
    this.setHeadingError(sign * TEST_START_ERROR);
    this.resetTurnModel();
    this.renderStage();
    this.errorHistory = [];
    this.pEnabled = true;
    this.lastResult = null;
    this.trial = {
      elapsed: 0,
      inTolSince: null,
      overshoot: 0,
      startSign: sign,
    };
    this.updateUIStatus();
  }

  private updateTrial(dt: number, angleError: number) {
    const t = this.trial;
    if (!t) {
      return;
    }
    t.elapsed += dt;

    t.overshoot = Math.max(t.overshoot, -t.startSign * angleError);
    if (Math.abs(angleError) < ALIGNED_TOLERANCE) {
      if (t.inTolSince === null) {
        t.inTolSince = t.elapsed;
      }
      if (t.elapsed - t.inTolSince >= SETTLE_HOLD) {
        this.finishTrial(t.inTolSince);
        return;
      }
    } else {
      t.inTolSince = null;
    }

    if (t.elapsed > TRIAL_TIMEOUT) {
      this.finishTrial(null);
    }
  }

  private finishTrial(settle: number | null) {
    const t = this.trial!;
    this.trial = null;
    const ok = settle !== null && settle <= TARGET_SETTLE;
    this.lastResult = { settle, overshoot: t.overshoot, ok };

    if (ok && !this.passed) {
      this.passed = true;
      this.game.ui.setAction("NEXT LEVEL");
      this.renderStage();
    }
    this.updateUIStatus();
  }

  private resultText(): string {
    if (this.trial) return `Test running... ${this.trial.elapsed.toFixed(1)} s`;
    const r = this.lastResult;
    if (!r) return "Press Run test to measure how fast your kP settles.";

    const wobbly = toDeg(r.overshoot) > 10;
    const hint = wobbly
      ? "It's wobbling: try a lower kP."
      : "Too sluggish: try a higher kP.";
    if (r.settle === null) {
      return `✗ Never settled within ${TRIAL_TIMEOUT} s (overshoot ${toDeg(r.overshoot).toFixed(0)}°). ${hint}`;
    }
    const base = `Settled in ${r.settle.toFixed(2)} s, overshoot ${toDeg(r.overshoot).toFixed(0)}°`;
    return r.ok
      ? `✓ ${base}. PASS (goal ≤ ${TARGET_SETTLE} s)`
      : `✗ ${base}. Goal ≤ ${TARGET_SETTLE} s. ${hint}`;
  }

  // ------------------------------------------------------------------------
  // Input
  // ------------------------------------------------------------------------

  private handleKey(e: KeyboardEvent, isDown: boolean) {
    const k = e.key.toLowerCase();

    if (isDown) {
      if (k === "c") {
        this.toggleCameraView();
      } else if (this.stage === "proportional") {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          this.changeKp(KP_STEP);
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          this.changeKp(-KP_STEP);
        }
      } else if (
        this.stage === "geometry" &&
        (e.key === "ArrowLeft" || e.key === "ArrowRight")
      ) {
        e.preventDefault();
      }
    }
  }

  /** Manual turning for stage 1. Positive = same direction as positive error. */
  private manualTurn(): number {
    let left =
      this.keyboardListener.isDown("a") ||
      this.keyboardListener.isDown("arrowleft")
        ? 1
        : 0;
    let right =
      this.keyboardListener.isDown("d") ||
      this.keyboardListener.isDown("arrowright")
        ? 1
        : 0;
    if (this.touchOverlay) {
      if (this.touchOverlay.state.turnRight) {
        right = 1;
      }
      if (this.touchOverlay.state.turnLeft) {
        left = 1;
      }
    }
    return left - right;
  }

  private toggleCameraView() {
    this.isTopDown = !this.isTopDown;
    this.game.setCamera(
      this.isTopDown ? this.topDownCamera : this.driverStationCamera,
    );
  }

  // ------------------------------------------------------------------------
  // Scoring / status
  // ------------------------------------------------------------------------

  private updateUIStatus() {
    if (this.stage === "geometry") {
      this.game.ui.setStatus(
        "Stage 1/3: turn with A / D until the error is 0° | [C] Camera",
      );
    } else if (this.stage === "bangbang") {
      this.game.ui.setStatus(
        "Stage 2/3: enable bang-bang and watch the error graph | [C] Camera",
      );
    } else if (this.passed) {
      this.game.ui.setStatus(
        `Stage 3/3 ✓ Passed! kP ${this.kp.toFixed(2)} | Press NEXT LEVEL when ready | [C] Camera`,
        "success",
      );
    } else {
      this.game.ui.setStatus(
        `Stage 3/3: kP ${this.kp.toFixed(2)} (↑/↓) | Run a test and settle in under ${TARGET_SETTLE} s | [C] Camera`,
      );
    }
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

  private resetTurnModel() {
    this.appliedTurn = 0;
    this.cmdQueue = [];
  }

  update(dt: number) {
    this.time += dt;

    const robotPos = this.robot.group.position;
    const hubPos = this.hub.group.position;

    // 1. Vector from robot to hub
    const dx = hubPos.x - robotPos.x;
    const dz = hubPos.z - robotPos.z;

    // 2. Target angle, current heading, and the (wrapped) error between them
    const targetHeading = Math.atan2(dx, dz);
    const currentHeading = this.robot.group.rotation.y + Math.PI / 2;
    const angleError = wrapAngle(targetHeading - currentHeading);

    // 3. Controller: turn the error into a motor command in [-1, 1]
    let cmd = 0;
    switch (this.stage) {
      case "geometry":
        cmd = this.manualTurn();
        break;
      case "bangbang":
        // Full power toward the target, no matter how small the error is
        cmd = this.bangBangOn ? Math.sign(angleError) : 0;
        break;
      case "proportional":
        // Power scales with error, clamped to what the motors can do
        cmd = this.pEnabled ? clamp(this.kp * angleError, -1, 1) : 0;
        break;
    }

    // 4. Simulated motor/inertia lag, then drive
    const turn = this.stepTurnModel(cmd, dt);
    this.robot.updateDrive(0, 0, turn, 0, TURN_SPEED, dt);

    // 5. Visuals + lesson panel
    if (this.stage === "proportional") {
      this.updateTrial(dt, angleError);
      this.lessonPanel.setResult(this.resultText(), true);
    }
    this.errorHistory.push({ t: this.time, e: angleError });
    while (
      this.errorHistory.length &&
      this.time - this.errorHistory[0]!.t > GRAPH_SECONDS
    ) {
      this.errorHistory.shift();
    }
    this.updateArrows(robotPos, currentHeading, dx, dz);
    this.updateReadout(
      robotPos,
      hubPos,
      dx,
      dz,
      targetHeading,
      currentHeading,
      angleError,
      cmd,
    );
    this.errorGraph.draw(this.errorHistory, this.time);

    this.game.stepPhysics(dt);
  }

  private updateArrows(
    robotPos: THREE.Vector3,
    heading: number,
    dx: number,
    dz: number,
  ) {
    const origin = new THREE.Vector3(robotPos.x, 0.1, robotPos.z);

    this.facingArrow.position.copy(origin);
    this.facingArrow.setDirection(
      new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading)),
    );

    const dist = Math.hypot(dx, dz);
    this.targetArrow.position.copy(origin);
    if (dist > 1e-4) {
      this.targetArrow.setDirection(new THREE.Vector3(dx / dist, 0, dz / dist));
      this.targetArrow.setLength(Math.max(0.6, dist / 2), 0.4, 0.25);
    }
  }

  private updateReadout(
    robotPos: THREE.Vector3,
    hubPos: THREE.Vector3,
    dx: number,
    dz: number,
    targetHeading: number,
    heading: number,
    error: number,
    cmd: number,
  ) {
    const f = (n: number) => n.toFixed(2);
    const deg = (r: number) => `${toDeg(r).toFixed(1)}°`;
    const aligned = Math.abs(error) < ALIGNED_TOLERANCE;

    let text =
      `robot (x, z)   = (${f(robotPos.x)}, ${f(robotPos.z)})\n` +
      `hub   (x, z)   = (${f(hubPos.x)}, ${f(hubPos.z)})\n` +
      `d = hub−robot  = (${f(dx)}, ${f(dz)})\n` +
      `target angle   = ${deg(targetHeading)}\n` +
      `heading θ      = ${deg(wrapAngle(heading))}\n` +
      `error          = ${deg(error)}   ${aligned ? "● ALIGNED" : "○"}`;

    if (this.stage === "bangbang") {
      text += `\noutput         = ${cmd >= 0 ? "+" : ""}${f(cmd)}`;
    } else if (this.stage === "proportional") {
      text +=
        `\nkP             = ${f(this.kp)}` +
        `\noutput         = clamp(kP × error) = ${cmd >= 0 ? "+" : ""}${f(cmd)}`;
    }

    this.lessonPanel.setReadout(text, aligned);
  }

  // ------------------------------------------------------------------------
  // Level lifecycle
  // ------------------------------------------------------------------------

  onAction() {
    // In the lesson stages the action button just re-randomizes the heading
    if (this.stage !== "proportional") {
      this.scrambleHeading();
      return;
    }

    if (this.passed) {
      const level = levels[this.info.index]?.();
      if (level) this.game.loadLevel(level);
    } else {
      this.startTrial();
    }
  }

  private resetLevelState(moveRobot = true) {
    if (moveRobot) {
      this.robot.group.rotation.y = Math.random() * Math.PI * 2;
    }
    this.resetTurnModel();
    this.errorHistory = [];
    this.updateUIStatus();
    this.game.ui.setAction("RESET");
  }

  dispose() {
    this.keyboardListener.dispose();
    this.game.stage.remove(this.facingArrow, this.targetArrow);
    this.facingArrow.dispose();
    this.targetArrow.dispose();
    this.lessonPanel.dispose();
    this.touchOverlay?.dispose();
  }
}
