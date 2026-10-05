import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { FIELD_LENGTH, FIELD_WIDTH } from './Floor';

type Vec3 = { x: number; y: number; z: number };

/** A game ball: a mesh that is parked at a position until launched into the physics world. */
export class Ball {
  static readonly RADIUS = 0.075; // 15 cm diameter

  readonly mesh: THREE.Mesh;
  private body: RAPIER.RigidBody | null = null;

  constructor() {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(Ball.RADIUS, 24, 16),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.7 })
    );
    this.mesh.castShadow = true;
  }

  get isLaunched(): boolean {
    return this.body !== null;
  }

  /** Current position: physics position while launched, otherwise the parked mesh position. */
  get position(): Vec3 {
    return this.body ? this.body.translation() : this.mesh.position;
  }

  inBounds(): boolean {
    return this.position.y > -0.1 && this.position.x < FIELD_LENGTH / 2 && this.position.x > -FIELD_LENGTH / 2 && this.position.z < FIELD_WIDTH / 2 && this.position.z > -FIELD_WIDTH / 2;
  }

  /** Park the ball (visual only) at a position. */
  place(pos: Vec3) {
    this.mesh.position.set(pos.x, pos.y, pos.z);
  }

  launch(world: RAPIER.World, pos: Vec3, velocity: Vec3) {
    this.remove(world);

    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setLinearDamping(0.05)
        .setAngularDamping(0.1)
    );
    world.createCollider(RAPIER.ColliderDesc.ball(Ball.RADIUS).setRestitution(0.35), this.body);
    this.body.setLinvel(velocity, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** Copy the physics position onto the mesh. Call after stepping the world. */
  syncMesh() {
    if (!this.body) return;
    const p = this.body.translation();
    this.mesh.position.set(p.x, p.y, p.z);
  }

  /** Remove the physics body (the mesh stays where it is). */
  remove(world: RAPIER.World) {
    if (!this.body) return;
    world.removeRigidBody(this.body);
    this.body = null;
  }
}
