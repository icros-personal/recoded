import * as THREE from 'three';
import { Ball } from './Ball';
import RAPIER from '@dimforge/rapier3d-compat';
import { RigidBody } from '@dimforge/rapier3d-compat';
import { CollisionGroups } from './CollisionGroups';

/**
 * Cartoon robot: intentionally simple for now. The important thing is that the
 * shooter and the ball make the relationship between power and trajectory clear.
 */
export class SimpleRobot {
  static readonly MUZZLE_OFFSET_X = -0.3;

  static readonly ROBOT_WIDTH = 0.6985; // 27.5"
  static readonly ROBOT_DEPTH = 0.6985; // 27.5"
  static readonly ROBOT_HEIGHT = 0.5588; // 22"

  static readonly MAX_ACCELERATION = 15.0; // m/s^2

  readonly group = new THREE.Group();
  private readonly shooter: THREE.Mesh;
  private rigidBody?: RigidBody;
  private velocity = new THREE.Vector3();

  constructor(x = 0, z = 0) {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(SimpleRobot.ROBOT_WIDTH, SimpleRobot.ROBOT_HEIGHT - 0.0508, SimpleRobot.ROBOT_DEPTH),
      new THREE.MeshStandardMaterial({ color: 0x475569, transparent: true, opacity: 0.8, roughness: 0.75 })
    );
    body.position.y = SimpleRobot.ROBOT_HEIGHT / 2 - 0.0508;
    body.castShadow = true;
    this.group.add(body);

    this.shooter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0508, 0.0508, SimpleRobot.ROBOT_DEPTH, 16),
      new THREE.MeshStandardMaterial({ color: 0x1e293b })
    );
    this.shooter.rotation.x = Math.PI / 2;
    this.shooter.position.set(-0.1397, SimpleRobot.ROBOT_HEIGHT - 2 * 0.0508, 0);
    this.group.add(this.shooter);

    for (const wx of [-SimpleRobot.ROBOT_WIDTH / 2 + 0.0508, SimpleRobot.ROBOT_WIDTH / 2 - 0.0508]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0508, 0.0508, 0.02, 16),
        new THREE.MeshStandardMaterial({ color: 0x111827 })
      );
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 0.0508, SimpleRobot.ROBOT_DEPTH / 2);
      this.group.add(wheel);

      const wheel2 = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0508, 0.0508, 0.02, 16),
        new THREE.MeshStandardMaterial({ color: 0x111827 })
      );
      wheel2.rotation.x = Math.PI / 2;
      wheel2.position.set(wx, 0.0508, -SimpleRobot.ROBOT_DEPTH / 2);
      this.group.add(wheel2);

    }

    this.group.position.set(x, 0, z);
  }

  addColliders(world: RAPIER.World) {
    // 1. Change from kinematic to dynamic, and lock rotations so the robot doesn't tip over
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(this.group.position.x, SimpleRobot.ROBOT_HEIGHT / 2, this.group.position.z)
      .lockRotations(); // Keep upright

    this.rigidBody = world.createRigidBody(rbDesc);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      SimpleRobot.ROBOT_WIDTH / 2,
      SimpleRobot.ROBOT_HEIGHT / 2,
      SimpleRobot.ROBOT_DEPTH / 2
    );
    // Optional: give it some mass/friction so it pushes balls realistically
    colliderDesc.setRestitution(0.2);
    colliderDesc.setMass(70);
    colliderDesc.setFriction(0.5);
    colliderDesc.setCollisionGroups(CollisionGroups.ROBOT << 16 | 0xffff);

    world.createCollider(colliderDesc, this.rigidBody);
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

  getMuzzlePositionFancy(target = new THREE.Vector3(), mod: 0 | 1 | 2): THREE.Vector3 {
    target.copy(this.shooter.position);
    target.x -= Ball.RADIUS + 0.0508;
    switch (mod) {
      case 1:
        target.z += Ball.RADIUS * 2;
        break;
      case 2:
        target.z -= Ball.RADIUS * 2;
        break;
    }
    return this.group.localToWorld(target);
  }

  getDistanceToHub(hub: THREE.Vector3) {
    const muzzle = this.getMuzzlePosition();
    return Math.hypot(hub.x - muzzle.x, hub.z - muzzle.z);
  }

  getForward(target = new THREE.Vector3()): THREE.Vector3 {
    this.group.updateWorldMatrix(true, false);
    return target.set(1, 0, 0).transformDirection(this.group.matrixWorld);
  }

  rpmToLaunchSpeed(rpm: number): number {
    return 0.002 * rpm;
  }

  getVelocity(target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.velocity);
  }

  updateDrive(forward: number, strafe: number, turn: number, moveSpeed: number, turnSpeed: number, dt: number) {
    this.group.rotation.y += turn * turnSpeed * dt;
    if (this.rigidBody) {
      const rot = this.group.quaternion;
      this.rigidBody.setRotation({x: rot.x, y: rot.y, z: rot.z, w: rot.w }, true);
    }

    const targetVelocity = new THREE.Vector3(forward, 0, strafe);
    if (targetVelocity.lengthSq() > 0) {
      targetVelocity.normalize().multiplyScalar(moveSpeed);
    }

    const maxChange = SimpleRobot.MAX_ACCELERATION * dt;
    const steering = new THREE.Vector3().subVectors(targetVelocity, this.velocity);
    if (steering.length() <= maxChange) {
      this.velocity.copy(targetVelocity);
    } else {
      steering.normalize().multiplyScalar(maxChange);
      this.velocity.add(steering);
    }

    if (this.rigidBody) {
      const currentLinvel = this.rigidBody.linvel();
      this.rigidBody.setLinvel({x: this.velocity.x, y: currentLinvel.y, z: this.velocity.z}, true);

      const pos = this.rigidBody.translation();
      this.group.position.set(pos.x, pos.y - SimpleRobot.ROBOT_HEIGHT / 2, pos.z);
    }
  }

  getPhysicsBody(): RAPIER.RigidBody | undefined {
    return this.rigidBody;
  }
}
