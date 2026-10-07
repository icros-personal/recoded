import type { Game } from "../core/Game";
import type { ControlSpec, LevelInfo } from "../core/ui";
import { FIELD_LENGTH, Floor } from "../entities/Floor";
import { Hub } from "../entities/Hub";
import { Robot } from "../entities/Robot";
import type { Level } from "./Level";
import { CameraSpec } from "../core/camera";
import { levels } from ".";
import { RpmGraph } from "../ui/RpmGraph";
import { BurstShooter } from "../core/BurstShooter";
import { DistanceLine } from "../entities/DistanceLine";
import { ScoreOverlay } from "../ui/ScoreOverlay";

const INSTRUCTIONS =
  "Unfortunately, our shooter can't spin up instantly, and each ball slows it down. Can you still score them all?";
const SHOT_ANGLE_DEG = 60;
const MAX_RPM = 5000;

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

  private game!: Game;
  private robot!: Robot;
  private hub!: Hub;
  private shooter!: BurstShooter;
  private rpmGraph!: RpmGraph;

  private phase: Phase = "ready";
  private successfulShotsThisBurst = 0;
  private currentDistance = 0;
  private successfulShots = 0;
  private totalShots = 0;

  private distanceLine!: DistanceLine;
  private scoreOverlay!: ScoreOverlay;

  setup(game: Game) {
    this.game = game;

    this.distanceLine = new DistanceLine(this.game.renderer.domElement.parentElement!);

    this.scoreOverlay = new ScoreOverlay(this.game.renderer.domElement.parentElement!);
    this.scoreOverlay.setScore(this.successfulShots, this.totalShots);

    this.rpmGraph = new RpmGraph(800, 300, MAX_RPM);
    this.game.ui.getControlsContainer().appendChild(this.rpmGraph.canvas);

    const floor = new Floor();
    floor.addColliders(game.world);

    this.hub = new Hub(Hub.HUB_X);
    this.robot = new Robot(this.getNewRobotPosition());
    this.currentDistance = this.robot.getDistanceToHub(this.hub.group.position);

    this.hub.addColliders(game.world);
    this.shooter = new BurstShooter(game, this.robot, this.hub);

    game.stage.add(floor.mesh, this.robot.group, this.hub.group, this.distanceLine.group);
    this.resetShot();
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
    const targetRpm = this.game.ui.getNumber("rpm");
    
    this.shooter.update(
      dt,
      targetRpm,
      () => this.getShotAngle(),
      (event) => {
        this.totalShots++;
        if (event === "scored") {
          this.successfulShotsThisBurst++;
          this.successfulShots++;
          if (this.successfulShotsThisBurst >= 5) this.phase = "scored";
          if (this.successfulShots > 30) {
            this.phase = "done";
            this.game.ui.setStatus("Well done!");
            this.game.ui.setAction("NEXT");
          }
        }

        this.scoreOverlay.setScore(this.successfulShots, this.totalShots);
      }
    );

    this.distanceLine.update(
      this.robot.getMuzzlePosition(),
      this.hub.group.position,
      this.game.camera,
    );

    this.rpmGraph.update(this.shooter.flywheelRpm);

    if (this.phase === "firing" && !this.shooter.isBusy) {
      this.phase = "waiting";
      this.rpmGraph.stop();
      this.game.ui.setStatus("Try again?");
      this.game.ui.setAction("RESET");
    }
  }

  private startBurst() {
    if (!Number.isFinite(this.game.ui.getNumber("rpm"))) return;

    this.rpmGraph.start();
    this.shooter.startBurst();
    this.phase = "firing";
    this.successfulShotsThisBurst = 0;

    this.game.ui.setStatus("Firing...");
    this.game.ui.setAction("RESET");
  }

  private getShotAngle(): number {
    if (this.currentDistance >= 3) return SHOT_ANGLE_DEG;
    if (this.currentDistance <= 1) return 80;
    const t = (this.currentDistance - 1) / (3 - 1);
    return 80 + t * (SHOT_ANGLE_DEG - 80);
  }

  private resetShot() {
    this.scoreOverlay.setScore(this.successfulShots, this.totalShots);
    this.phase = "ready";
    this.shooter.reset();
    this.game.ui.setStatus(INSTRUCTIONS);
    this.game.ui.setAction("FIRE!");
  }

  dispose() {
    this.scoreOverlay.dispose();
    this.distanceLine.dispose();
  }
}