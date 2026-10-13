import * as THREE from "three";
import type { Game } from "../core/Game";
import type { ControlSpec, LevelInfo } from "../core/ui";
import { BaseLevel } from "./BaseLevel";
import { FIELD_LENGTH, FIELD_WIDTH } from "../entities/Floor";
import { Hub } from "../entities/Hub";
import { Robot } from "../entities/Robot";
import type { Level } from "./Level";
import type { CameraSpec } from "../core/Camera";
import { Table } from "../ui/Table";
import { levels } from ".";
import { RpmGraph } from "../ui/RpmGraph";
import { FixedBurstShooter } from "../core/FixedBurstShooter";

const INSTRUCTIONS =
  "It's a lot of work coming up with values for every distance. Can we add a few points to a table and let the robot interpolate?";
const MAX_RPM = 5000;
const LEVEL_REQUIREMENT = 30; // Total successful shots needed across bursts to pass

type Phase = "ready" | "firing" | "waiting" | "scored" | "done";

export class Level4 extends BaseLevel {
  readonly info: LevelInfo = {
    index: 4,
    subtitle: "Can't the robot figure this out?",
    instructions: INSTRUCTIONS,
    targetLabel: "",
    modal: {
      title: "Pit Strategy: Automated Interpolation",
      body: "Manually tuning RPM for every spot on the field is too slow for a real FRC match. By feeding your tuned data points into a lookup table, the robot can automatically calculate the exact RPM needed for any random distance using linear interpolation!",
    },
  };

  readonly controls: ControlSpec[] = [];

  readonly rotationAngle = -Math.atan2(
    FIELD_WIDTH / 2,
    FIELD_LENGTH / 2 + Hub.HUB_X
  );
  readonly rotationMatrix = new THREE.Matrix4()
    .makeTranslation(Hub.HUB_X, 0, 0)
    .multiply(
      new THREE.Matrix4()
        .makeRotationY(this.rotationAngle)
        .multiply(new THREE.Matrix4().makeTranslation(-Hub.HUB_X, 0, 0))
    );

  readonly camera: CameraSpec = {
    type: "perspective",
    position: new THREE.Vector3(-6, 2.5, 6)
      .applyMatrix4(this.rotationMatrix)
      .toArray(),
    target: new THREE.Vector3(-6, 1.25, 0)
      .applyMatrix4(this.rotationMatrix)
      .toArray(),
    fov: 40,
  };

  private shooter!: FixedBurstShooter;
  private rpmGraph!: RpmGraph;

  private phase: Phase = "ready";
  private table: Table | null = null;

  protected override initEntities() {
    // Prefer Level 3 storage if available, otherwise fall back to Level 2
    const storageData = this.game.getStorage(3) ?? this.game.getStorage(2);
    
    const map = new Map<number, number>();
    if (storageData && Array.isArray(storageData)) {
      for (const pair of storageData) {
        if (
          Array.isArray(pair) &&
          pair.length === 2 &&
          Number.isFinite(pair[0]) &&
          Number.isFinite(pair[1])
        ) {
          map.set(Math.round(pair[0] * 100) / 100, pair[1]);
        }
      }
    }
    
    this.table = new Table(["Distance", "RPM"], map);
    
    const controlsContainer = this.game.ui.getControlsContainer();
    controlsContainer.insertBefore(
      this.table.getRoot(),
      controlsContainer.firstElementChild
    );

    // Setup RPM Graph Canvas
    this.rpmGraph = new RpmGraph(800, 300, MAX_RPM);
    controlsContainer.appendChild(this.rpmGraph.canvas);

    const initialDistance = 4.23;
    const [robotX, robotZ] = this.positionRobotAtDistance(initialDistance);
    this.robot = new Robot(robotX);
    this.robot.group.position.z = robotZ;
    this.robot.group.rotation.y = this.rotationAngle;
    this.currentDistance = this.robot.getDistanceToHub(this.hub.group.position);

    this.shooter = new FixedBurstShooter(this.game, this.robot, this.hub, {maxAge: 3.5 });
  }

  protected override getBaseDistances(): number[] {
    return [2.23, 2.48, 2.73, 2.98, 3.23, 3.48, 3.73, 3.98, 4.23, 4.48, 4.73];
  }

  private positionRobotAtDistance(distanceFromHub: number): [number, number] {
    const targetX = this.hub.group.position.x - distanceFromHub;
    const position = new THREE.Vector3(targetX, 0, 0).applyMatrix4(this.rotationMatrix);
    return [position.x, position.z];
  }

  onAction() {
    if (this.phase === "ready") {
      this.fire();
    } else if (this.phase === "firing" || this.phase === "waiting") {
      this.resetShot();
    } else if (this.phase === "scored") {
      this.moveToNewDistance();
      this.resetShot();
    } else if (this.phase === "done") {
      const level = levels[this.info.index]?.();
      if (level) {
        this.game.loadLevel(level);
      }
    }
  }

  private moveToNewDistance() {
    const dist = this.getNextDistance();
    const [x, z] = this.positionRobotAtDistance(dist);
    this.robot.setPosition(x, z);
    // Keep robot rotation aligned to the field angle
    this.robot.group.rotation.y = this.rotationAngle;
    this.currentDistance = this.robot.getDistanceToHub(this.hub.group.position);
    this.updateDistanceLine();
  }

  update(dt: number) {
    this.updateDistanceLine();

    const targetRpm = this.table?.getInterpolatedValue(this.currentDistance) ?? 0;

    this.shooter.update(
      dt,
      targetRpm,
      () => this.getShotAngle(),
      (event) => {
        this.totalShots++;
        if (event === "scored") {
          this.recordSuccessfulShot();
          if (this.successfulShots >= LEVEL_REQUIREMENT) {
            this.phase = "done";
            this.game.ui.setStatus(
              "✓ Level Complete! Autonomous interpolation mastered.",
              "success"
            );
            this.game.ui.setAction("DONE");
          } else {
            this.phase = "scored";
            this.game.ui.setStatus(
              `✓ Nice shot! Can you get ${LEVEL_REQUIREMENT - this.successfulShots} more total shots on target?`,
              "success"
            );
            this.game.ui.setAction("NEXT DISTANCE");
          }
        }
        this.scoreOverlay.setScore(this.successfulShots, this.totalShots);
      }
    );

    this.rpmGraph.update(this.shooter.flywheelRpm);

    if (this.phase === "firing" && !this.shooter.isBusy) {
      this.phase = "waiting";
      this.rpmGraph.stop();
      this.game.ui.setStatus("Burst finished. Try tweaking your table values if shots missed.", "miss");
      this.game.ui.setAction("RESET");
    }
  }

  private getInterpolatedRPM(): number {
    const entries = Array.from(this.table!.values().entries());

    if (entries.length === 0) return 1000;

    if (this.currentDistance <= entries[0]![0]) {
      this.table?.highlight(0);
      return entries[0]![1];
    }

    if (this.currentDistance >= entries[entries.length - 1]![0]) {
      this.table?.highlight(entries.length - 1);
      return entries[entries.length - 1]![1];
    }

    let i = 1;
    while (i < entries.length && entries[i]![0] < this.currentDistance) {
      i++;
    }

    this.table?.highlight(i - 1, i);
    const [d0, rpm0] = entries[i - 1]!;
    const [d1, rpm1] = entries[i]!;

    const t = (this.currentDistance - d0) / (d1 - d0);
    return rpm0 + t * (rpm1 - rpm0);
  }

  private fire() {
    const targetRpm = this.table?.getInterpolatedValue(this.currentDistance);
    if (!Number.isFinite(targetRpm)) return;

    this.rpmGraph.start();
    this.shooter.startBurst();
    this.phase = "firing";

    this.game.ui.setStatus("Watch the automated burst...");
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
    this.rpmGraph.reset();
    this.game.ui.setStatus(INSTRUCTIONS);
    this.game.ui.setAction("FIRE!");
  }

  override dispose() {
    super.dispose();
    this.rpmGraph.dispose();
    this.table?.dispose?.();
  }
}