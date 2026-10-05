import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { ControlSpec, LevelInfo } from '../core/ui';
import { Ball } from '../entities/Ball';
import { FIELD_LENGTH, FIELD_WIDTH, Floor } from '../entities/Floor';
import { Hub } from '../entities/Hub';
import { Robot } from '../entities/Robot';
import type { Level } from './Level';
import { CameraSpec } from '../core/camera';

const INSTRUCTIONS = 'Get the ball through the hexagonal opening on top of the Hub.';
const SHOT_ANGLE_DEG = 60;

type Phase = 'ready' | 'flying' | 'done';

export class Level1 implements Level {
  readonly info: LevelInfo = {
    subtitle: 'Level 1: Make the shot',
    instructions: INSTRUCTIONS,
    targetLabel: '',
  };

  readonly controls: ControlSpec[] = [
    { id: 'rpm', label: 'Shooter RPM', value: 4000, min: 2000, max: 6000, step: 100 },
  ];

  readonly camera: CameraSpec = {
    type: 'perspective',
    position: [-6, 2.5, 6],
    target: [-6, 1.25, 0],
    fov: 40,
  };

  private game!: Game;
  private robot!: Robot;
  private hub!: Hub;
  private ball!: Ball;

  private phase: Phase = 'ready';
  private previousBallY = 0;

  setup(game: Game) {
    this.game = game;

    const floor = new Floor();
    floor.addColliders(game.world);

    this.robot = new Robot(-7.0);
    this.hub = new Hub(-4.1995);
    this.hub.addColliders(game.world);
    this.ball = new Ball();

    game.stage.add(floor.mesh, this.robot.group, this.hub.group, this.ball.mesh);
    this.resetShot();
  }

  onAction() {
    if (this.phase === 'ready') this.fire();
    else this.resetShot();
  }

  update(dt: number) {
    if (this.phase !== 'flying') return;

    this.game.stepPhysics(dt);
    this.ball.syncMesh();

    const p = this.ball.position;
    if (this.hub.isScoringCrossing(this.previousBallY, p)) {
      this.phase = 'done';
      this.game.ui.setStatus('✓ Nice shot! You found the opening. Level complete.', 'success');
      return;
    }
    this.previousBallY = p.y;

    if (!this.ball.inBounds()) {
      this.resetShot();
      this.game.ui.setStatus('Missed. Try a different shot power.', 'miss');
    }
  }

  private fire() {
    const rpm = this.game.ui.getNumber('rpm');
    if (!Number.isFinite(rpm)) return;

    const start = this.robot.getMuzzlePosition();

    // Level 1: assume shooter instantly reaches target RPM.
    const speed = this.rpmToLaunchSpeed(rpm);
    const fwd = this.robot.getForward();
    const angle = THREE.MathUtils.degToRad(SHOT_ANGLE_DEG);
    const horizontal = Math.cos(angle) * speed;
    this.ball.launch(this.game.world, start, {
      x: fwd.x * horizontal,
      y: Math.sin(angle) * speed,
      z: fwd.z * horizontal,
    });

    this.phase = 'flying';
    this.previousBallY = start.y;
    this.game.ui.setStatus('Watch the shot...');
    this.game.ui.setAction('RESET');
  }

  private rpmToLaunchSpeed(rpm: number) {
    return 0.002 * rpm;
  }

  private resetShot() {
    this.phase = 'ready';
    this.ball.remove(this.game.world);
    this.ball.place(this.robot.getMuzzlePosition());
    this.game.ui.setStatus(INSTRUCTIONS);
    this.game.ui.setAction('FIRE!');
  }
}
