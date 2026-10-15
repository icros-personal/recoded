import type { Game } from "../core/Game";
import type { ControlSpec, LevelInfo } from "../core/ui";
import { SimpleBaseLevel } from "./SimpleBaseLevel";
import { RpmGraph } from "../ui/RpmGraph";
import { FixedBurstShooter } from "../core/FixedBurstShooter";
import { levels } from ".";
import type { CameraSpec } from "../core/Camera";
import { Robot } from "../entities/Robot";

const REQUIRED_HITS_PER_BURST = 6;
const REQUIRED_SUCCESSFUL_BURSTS = 3;
const INSTRUCTIONS =
  `Test your lookup table! Score at least ${REQUIRED_HITS_PER_BURST} out of 10 balls in a single burst.`;
const MAX_RPM = 5000;

type Phase = "ready" | "firing" | "waiting" | "scored" | "done";

export class Level3 extends SimpleBaseLevel {
  readonly info: LevelInfo = {
    index: 3,
    subtitle: "Flywheels are tricky",
    instructions: INSTRUCTIONS,
    targetLabel: "",
    modal: {
      title: "Pit Strategy: Motor Saturation & Recovery",
      body: "Flywheels store kinetic energy, but shooting a game piece draws current and slows the motor down. If you fire a rapid burst without letting the flywheel recover, subsequent balls will fall short! Let's test your table data under physical stress.",
    },
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

  private shooter!: FixedBurstShooter;
  private rpmGraph!: RpmGraph;

  private phase: Phase = "ready";
  private successfulShotsThisBurst = 0;
  private successfulBursts = 0;
  private shotTableMap = new Map<number, number>();

  protected override initEntities() {
    const level2Table = this.game.getStorage(2);
    if (level2Table && Array.isArray(level2Table)) {
      for (const pair of level2Table) {
        if (
          Array.isArray(pair) &&
          pair.length === 2 &&
          Number.isFinite(pair[0]) && Number.isFinite(pair[1])
        ) {
          this.shotTableMap.set(Math.round(pair[0] * 100) / 100, pair[1]);
        }
      }
    }

    const dist = this.getNextDistance();
    const robotX = this.hub.group.position.x - dist;
    this.robot = new Robot(robotX);
    this.currentDistance = this.robot.getDistanceToHub(this.hub.group.position);

    const suggestedRpm = this.getStoredRpmForDistance(dist);
    const input = this.game.ui
      .getControlsContainer()
      .querySelector<HTMLInputElement>("#rpm");
    if (input && suggestedRpm) {
      input.value = String(suggestedRpm);
    }

    this.shooter = new FixedBurstShooter(this.game, this.robot, this.hub, { maxAge: 3.5});
    this.rpmGraph = new RpmGraph(800, 300, MAX_RPM);
    this.game.ui.getControlsContainer().appendChild(this.rpmGraph.canvas);
  }

  protected override getBaseDistances() {
    return [2.23, 2.73, 3.23, 3.63];
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
      const level = levels[this.info.index]?.();
      if (level) {
        this.game.loadLevel(level);
      }
    }
  }

  private moveToNewDistance() {
    const dist = this.getNextDistance();
    this.robot.setPosition(this.hub.group.position.x - dist, 0);
    this.currentDistance = this.robot.getDistanceToHub(this.hub.group.position);

    const suggestedRpm = this.getStoredRpmForDistance(dist);
    if (suggestedRpm) {
      const input = this.game.ui
        .getControlsContainer()
        .querySelector<HTMLInputElement>("#rpm");
      if (input) {
        input.value = String(suggestedRpm);
      }
    }

    this.updateDistanceLine();
  }

  private getStoredRpmForDistance(dist: number): number | null {
    let closestRpm: number | null = null;
    let minDiff = Infinity;
    for (const [d, rpm] of this.shotTableMap.entries()) {
      const diff = Math.abs(d - dist);
      if (diff < minDiff) {
        minDiff = diff;
        closestRpm = rpm;
      }
    }
    return minDiff < 0.5 ? closestRpm : null;
  }

  update(dt: number) {
    this.updateDistanceLine();

    const targetRpm = this.game.ui.getNumber("rpm");

    this.shooter.update(
      dt,
      targetRpm,
      () => this.getShotAngle(),
      (event) => {
        this.totalShots++;
        if (event === "scored") {
          this.successfulShotsThisBurst++;
          this.recordSuccessfulShot();
        }
        this.scoreOverlay.setScore(this.successfulShots, this.totalShots);
      },
    );

    this.rpmGraph.update(this.shooter.flywheelRpm);

    if (this.phase === "firing" && !this.shooter.isBusy) {
      this.rpmGraph.stop();
      if (this.successfulShotsThisBurst >= REQUIRED_HITS_PER_BURST) {
        this.successfulBursts++;
        this.shotTableMap.set(
          this.currentDistance,
          this.game.ui.getNumber("rpm"),
        );
        if (this.successfulBursts >= REQUIRED_SUCCESSFUL_BURSTS) {
          this.phase = 'done';
          this.game.setStorage(this.info.index, Array.from(this.shotTableMap.entries()));
          this.game.ui.setStatus(`✓ Level Complete! Passed ${REQUIRED_SUCCESSFUL_BURSTS} successful bursts.`,
            "success",
          );
          this.game.ui.setAction("NEXT LEVEL");
        } else {
          this.phase = "scored";
          this.game.ui.setStatus(
            `✓ Great burst (${this.successfulShotsThisBurst}/10)! Successful bursts: ${this.successfulBursts}/${REQUIRED_SUCCESSFUL_BURSTS}. Click to move to a new distance.`,
            "success",
          );
          this.game.ui.setAction("NEXT DISTANCE");
        }
      } else {
        this.phase = "waiting";
        this.game.ui.setStatus(
          `Only scored ${this.successfulShotsThisBurst}/10. Need at least ${REQUIRED_HITS_PER_BURST}. Adjust your RPM and retry!`,
          "miss",
        );
        this.game.ui.setAction("RESET");
      }
    }
  }

  private startBurst() {
    if (!Number.isFinite(this.game.ui.getNumber("rpm"))) {
      return;
    }

    this.rpmGraph.start();
    this.shooter.startBurst();
    this.phase = "firing";
    this.successfulShotsThisBurst = 0;

    this.game.ui.setStatus("Firing burst...");
    this.game.ui.setAction("RESET");
  }

  private getShotAngle(): number {
    if (this.currentDistance >= 3) return 60;
    if (this.currentDistance <= 1) return 80;
    const t = (this.currentDistance - 1) / (3 - 1);
    return 80 + t * (60 - 80);
  }

  protected resetShot() {
    this.scoreOverlay.setScore(this.successfulShots, this.totalShots);
    this.phase = "ready";
    this.shooter.reset();
    this.game.ui.setStatus(INSTRUCTIONS);
    this.game.ui.setAction("FIRE!");
  }

  override dispose() {
    super.dispose();
    this.rpmGraph.dispose();
  }
}
