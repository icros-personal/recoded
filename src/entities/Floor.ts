import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export const FIELD_WIDTH = 8.128; // z-direction
export const FIELD_LENGTH = 16.459; // x-direction, meters
const FLOOR_THICKNESS = 0.2;

export class Floor {
  readonly mesh: THREE.Mesh;

  constructor() {
    this.mesh = new THREE.Mesh(
      new THREE.BoxGeometry(FIELD_LENGTH, FLOOR_THICKNESS, FIELD_WIDTH),
      new THREE.MeshStandardMaterial({ color: 0x8fa3b5 })
    );
    this.mesh.position.set(0, -FLOOR_THICKNESS / 2, 0);
    this.mesh.receiveShadow = true;
  }

  addColliders(world: RAPIER.World) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -FLOOR_THICKNESS, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(FIELD_LENGTH / 2, FLOOR_THICKNESS / 2, FIELD_WIDTH / 2), body);
  }
}
