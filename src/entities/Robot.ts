import * as THREE from 'three';
import { Ball } from './Ball';

/**
 * Cartoon robot: intentionally simple for now. The important thing is that the
 * shooter and the ball make the relationship between power and trajectory clear.
 */
export class Robot {
  static readonly MUZZLE_OFFSET_X = -0.3;

  static readonly ROBOT_WIDTH = 0.6985; // 27.5"
  static readonly ROBOT_DEPTH = 0.6985; // 27.5"
  static readonly ROBOT_HEIGHT = 0.5588; // 22"

  readonly group = new THREE.Group();
  private readonly shooter: THREE.Mesh;

  constructor(x = 0, z = 0) {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(Robot.ROBOT_WIDTH, Robot.ROBOT_HEIGHT - 0.0508, Robot.ROBOT_DEPTH),
      new THREE.MeshStandardMaterial({ color: 0x475569, transparent: true, opacity: 0.8, roughness: 0.75 })
    );
    body.position.y = Robot.ROBOT_HEIGHT / 2 - 0.0508;
    this.group.add(body);

    this.shooter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0508, 0.0508, Robot.ROBOT_DEPTH, 16),
      new THREE.MeshStandardMaterial({ color: 0x1e293b })
    );
    this.shooter.rotation.x = Math.PI / 2;
    this.shooter.position.set(-0.1397, Robot.ROBOT_HEIGHT - 2 * 0.0508, 0);
    this.group.add(this.shooter);

    for (const wx of [-Robot.ROBOT_WIDTH / 2 + 0.0508, Robot.ROBOT_WIDTH / 2 - 0.0508]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0508, 0.0508, 0.02, 16),
        new THREE.MeshStandardMaterial({ color: 0x111827 })
      );
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 0.0508, Robot.ROBOT_DEPTH / 2);
      this.group.add(wheel);

      const wheel2 = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0508, 0.0508, 0.02, 16),
        new THREE.MeshStandardMaterial({ color: 0x111827 })
      );
      wheel2.rotation.x = Math.PI / 2;
      wheel2.position.set(wx, 0.0508, -Robot.ROBOT_DEPTH / 2);
      this.group.add(wheel2);

    }

    this.group.position.set(x, 0, z);
  }

  setPosition(x: number, z: number) {
    this.group.position.set(x, 0, z);
  }

  /** World-space point where a ball leaves the shooter. */
  getMuzzlePosition(target = new THREE.Vector3()): THREE.Vector3 {
    target.copy(this.shooter.position);
    target.x -= Ball.RADIUS + 0.0508;
    return this.group.localToWorld(target);
  }

  getForward(target = new THREE.Vector3()): THREE.Vector3 {
    this.group.updateWorldMatrix(true, false);
    return target.set(1, 0, 0).transformDirection(this.group.matrixWorld);
  }

  rpmToLaunchSpeed(rpm: number): number {
    return 0.002 * rpm;
  }
}
