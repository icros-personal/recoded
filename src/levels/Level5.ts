import type { Game } from "../core/Game";
import type { ControlSpec, LevelInfo } from "../core/ui";
import { FIELD_LENGTH, FIELD_WIDTH, Floor } from "../entities/Floor";
import { Hub } from "../entities/Hub";
import { Robot } from "../entities/Robot";
import type { Level } from "./Level";
import type { CameraSpec } from "../core/Camera";
import { Table } from "../ui/Table";
import { levels } from ".";
import { DistanceLine } from "../entities/DistanceLine";
import { ScoreOverlay } from "../ui/ScoreOverlay";
import { DynamicShooter } from "../core/DynamicShooter";
import { TouchOverlay } from "../ui/TouchOverlay";
import { KeyboardListener } from "../core/KeyboardListener";

const INSTRUCTIONS =
  "Drive with WASD, rotate with J/L, and press K to shoot. Score as many of your 10 balls as you can!";
const MAX_BALLS = 10;

export class Level5 implements Level {
  readonly levelRequirement = 20; // e.g., score 5 out of 10 to pass
  readonly info: LevelInfo = {
    index: 5,
    subtitle: "The Driver Station",
    instructions: INSTRUCTIONS,
    targetLabel: "",
    modal: {
      title: "The Driver Station",
      body: "In a real FRC match, your drivers aren't sitting on the field—they're stuck behind the driver station glass, looking at the robot from a fixed perspective. Driving without being right next to your robot takes practice, especially when lining up to score!",
    },
  };

  readonly controls: ControlSpec[] = [];

  // Driver station camera: positioned behind the alliance wall looking downfield
  readonly camera: CameraSpec = {
    type: "perspective",
    position: [-FIELD_LENGTH / 2 - 1, 1.7, -FIELD_WIDTH / 2 + 1.5],
    target: [0, 1.0, 0],
    fov: 70,
  };

  private game!: Game;
  private robot!: Robot;
  private hub!: Hub;
  private distanceLine!: DistanceLine;
  private scoreOverlay!: ScoreOverlay;
  private touchOverlay: TouchOverlay | null = null;
  private table!: Table;

  private shooter!: DynamicShooter;
  private ballsRemaining = MAX_BALLS;
  private successfulShots = 0;
  private totalShots = 0;

  private keyboardListener!: KeyboardListener;

  setup(game: Game) {
    this.game = game;

    this.distanceLine = new DistanceLine(
      this.game.renderer.domElement.parentElement!,
    );
    this.scoreOverlay = new ScoreOverlay(
      this.game.renderer.domElement.parentElement!,
    );
    this.scoreOverlay.setScore(this.successfulShots, this.totalShots);

    if (
      window.PointerEvent &&
      "maxTouchPoints" in navigator &&
      navigator.maxTouchPoints > 0
    ) {
      this.touchOverlay = new TouchOverlay(
        this.game.renderer.domElement.parentElement!,
        {
          handleShoot: (isDown) => this.handleShootInput(isDown),
        },
      );
    }

    // Setup Table UI (Load from storage or use a robust default fallback)
    const storedTable = this.game.getStorage(2);
    const map = new Map<number, number>();
    if (storedTable && Array.isArray(storedTable)) {
      for (const pair of storedTable) {
        if (
          Array.isArray(pair) &&
          pair.length === 2 &&
          Number.isFinite(pair[0])
        ) {
          map.set(Math.round(pair[0] * 100) / 100, pair[1]);
        }
      }
    }
    // Fallback default table if no previous data exists
    if (map.size === 0) {
      map.set(1.5, 2500);
      map.set(3.0, 3500);
      map.set(5.0, 4800);
    }
    this.table = new Table(["Distance", "RPM"], map);

    const controlsContainer = this.game.ui.getControlsContainer();
    controlsContainer.insertBefore(
      this.table.getRoot(),
      controlsContainer.firstElementChild,
    );

    // Setup Floor, Walls, and Hubs
    const floor = new Floor(true); // Ensure Floor includes boundary walls
    floor.addColliders(game.world);

    this.hub = new Hub(Hub.HUB_X); // Center field or standard hub position
    this.hub.addColliders(game.world);

    // Start robot near the driver station end of the field
    this.robot = new Robot(-FIELD_LENGTH / 2 + 1, 2);
    this.robot.addColliders(game.world);

    this.shooter = new DynamicShooter(this.game, this.robot, this.hub, {
      numBalls: 10,
      timeBetweenBalls: 0.1,
    });

    game.stage.add(
      floor.mesh,
      this.robot.group,
      this.hub.group,
      this.distanceLine.group,
    );

    this.keyboardListener = new KeyboardListener((e, isDown) => {
      if (e.key.toLowerCase() === "k") {
        this.handleShootInput(isDown);
      }
    });
    this.resetLevelState(false /* moveRobot */);
  }

  private handleShootInput(isDown: boolean) {
    this.shooter.setKeyHeld(isDown);
    if (isDown) {
      this.shooter.tryFire(() => this.getShotAngle());
      this.updateUIStatus();
    }
  }

  private getShotAngle(): number {
    const distance = this.robot.getDistanceToHub(this.hub.group.position);
    if (distance >= 3) return 60;
    if (distance <= 1) return 80;
    const t = (distance - 1) / (3 - 1);
    return 80 + t * (60 - 80);
  }

  private handleShotEvent(event: "scored" | "missed" | "round_complete") {
    if (event !== "round_complete") {
      this.totalShots++;
    }

    if (event === "scored") {
      this.successfulShots++;
      this.game.ui.setStatus("✓ Scored!", "success");
    } else if (event === "round_complete") {
      const passed = this.successfulShots >= this.levelRequirement;
      if (passed) {
        this.game.ui.setStatus(
          `✓ Level Complete! Scored ${this.successfulShots}/${this.totalShots}`,
          "success",
        );
        this.game.ui.setAction("NEXT LEVEL");
      } else {
        this.game.ui.setStatus(
          `Round over. Scored ${this.successfulShots}/${this.totalShots}. Press RELOAD to try again.`,
          "miss",
        );
        this.game.ui.setAction("RELOAD");
      }
    }
    this.scoreOverlay.setScore(this.successfulShots, this.totalShots);
    this.updateUIStatus();
  }

  private updateUIStatus() {
    if (this.shooter.ballsRemaining > 0) {
      this.game.ui.setStatus(`Balls remaining: ${this.shooter.ballsRemaining}`);
    }
  }

  update(dt: number) {
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

    this.robot.updateDrive(
      forwardInput,
      strafeInput,
      turnInput,
      moveSpeed,
      turnSpeed,
      dt,
    );

    const distance = this.robot.getDistanceToHub(this.hub.group.position);
    const targetRpm = this.table.getInterpolatedValue(distance);

    this.shooter.update(
      dt,
      targetRpm,
      () => this.getShotAngle(),
      (event) => this.handleShotEvent(event),
    );

    this.game.stepPhysics(dt);

    this.distanceLine.update(
      this.robot.getMuzzlePosition(),
      this.hub.group.position,
      this.game.camera,
    );
  }

  onAction() {
    if (
      this.ballsRemaining <= 0 ||
      this.successfulShots >= this.levelRequirement
    ) {
      const level = levels[this.info.index]?.();
      if (level) this.game.loadLevel(level);
    } else {
      this.resetLevelState();
    }
  }

  private resetLevelState(moveRobot = true) {
    this.ballsRemaining = MAX_BALLS;
    this.shooter.reset();
    if (moveRobot) {
      this.robot.group.position.x = -FIELD_LENGTH / 2 + Math.random() * 2 - 1;
      this.robot.group.position.y = Math.random() * 4 - 2;
      this.robot.group.rotation.y = Math.random() * 2 * Math.PI;
    }
    this.scoreOverlay.setScore(this.successfulShots, this.totalShots);
    this.game.ui.setStatus(INSTRUCTIONS);
    this.game.ui.setAction("RESET");
  }

  dispose() {
    this.keyboardListener.dispose();
    this.distanceLine.dispose();
    this.scoreOverlay.dispose();
    this.touchOverlay?.dispose();
  }
}
