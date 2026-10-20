import * as THREE from "three";
import { SimpleBaseLevel } from "./SimpleBaseLevel";
import { Ball } from "../entities/Ball";
import { levels } from ".";
import { SimpleRobot } from "../entities/SimpleRobot";

const INSTRUCTIONS = "Score from 3 different distances.";
const SHOT_ANGLE_DEG = 60;

type Phase = "ready" | "flying" | "scored" | "done";

export class Level2 extends SimpleBaseLevel {
  readonly info = {
    index: 2,
    subtitle: "Scoring from distance",
    instructions: INSTRUCTIONS,
    targetLabel: "",
    modal: {
      title: "Pit Strategy: Calibration",
      body: "In a real FRC match, drivers don't guess shot power. We need to map distance to shooter RPM so the robot knows how to adjust automatically. Let's log a few data points across different positions!",
    },
  };

  readonly controls = [
    {
      id: "rpm",
      label: "Shooter RPM",
      value: 4000,
      min: 2000,
      max: 5000,
      step: 100,
    },
  ];

  readonly camera = {
    type: "perspective" as const,
    position: [-6, 2.5, 6] as [number, number, number],
    target: [-6, 1.25, 0] as [number, number, number],
    fov: 40,
  };

  readonly shotRequirements = 3;

  private ball!: Ball;
  private phase: Phase = "ready";
  private previousBallY = 0;
  private shotTable: [number, number][] = [];

  protected override initEntities() {
    const dist = this.getNextDistance();
    const robotX = this.hub.group.position.x - dist;
    this.robot = new SimpleRobot(robotX);
    this.currentDistance = this.robot.getDistanceToHub(this.hub.group.position);

    this.ball = new Ball();
    this.game.stage.add(this.ball.mesh);
  }

  protected override getBaseDistances() {
    // 3.77 is off the field, unfortunately.
    return [2.23, 2.73, 3.23, 3.63];
  }

  onAction() {
    if (this.phase === "ready") {
      this.fire();
    } else if (this.phase === "flying") {
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
    this.updateDistanceLine();
  }

  update(dt: number) {
    this.updateDistanceLine();

    if (this.phase !== "flying") return;

    this.flightTime += dt;
    this.game.stepPhysics(dt);
    this.ball.syncMesh();

    const p = this.ball.position;
    if (this.flightTime > this.MAX_FLIGHT_TIME || !this.ball.inBounds()) {
      this.resetShot();
      this.game.ui.setStatus("Missed! Try a different RPM.", "miss");
      return;
    }

    if (this.hub.isScoringCrossing(this.previousBallY, p)) {
      this.shotTable.push([
        this.currentDistance,
        this.game.ui.getNumber("rpm"),
      ]);
      this.recordSuccessfulShot();

      if (this.successfulShots < this.shotRequirements) {
        this.phase = "scored";
        this.game.ui.setStatus(
          `✓ Nice shot! Get ${this.shotRequirements - this.successfulShots} more to pass the level.`,
          "success",
        );
        this.game.ui.setAction("NEXT DISTANCE");
      } else {
        this.phase = "done";
        this.game.setStorage('rpmTable', this.shotTable);
        this.game.ui.setStatus("✓ Shot speeds recorded!", "success");
        this.game.ui.setAction("NEXT LEVEL");
      }
      return;
    }
    this.previousBallY = p.y;
  }

  private fire() {
    const rpm = this.game.ui.getNumber("rpm");
    if (!Number.isFinite(rpm)) return;

    this.totalShots++;
    const start = this.robot.getMuzzlePosition();
    const speed = this.robot.rpmToLaunchSpeed(rpm);
    const fwd = this.robot.getForward();
    const angle = THREE.MathUtils.degToRad(SHOT_ANGLE_DEG);
    const horizontal = Math.cos(angle) * speed;

    this.ball.launch(this.game.world, start, {
      x: fwd.x * horizontal,
      y: Math.sin(angle) * speed,
      z: fwd.z * horizontal,
    });

    this.phase = "flying";
    this.previousBallY = start.y;
    this.game.ui.setStatus("Watch the shot...");
    this.game.ui.setAction("RESET");
  }

  protected override resetShot() {
    super.resetShot();
    this.phase = "ready";
    this.ball.remove(this.game.world);
    this.ball.place(this.robot.getMuzzlePosition());
    this.game.ui.setStatus(INSTRUCTIONS);
    this.game.ui.setAction("FIRE!");
  }
}
