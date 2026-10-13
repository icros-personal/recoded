import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export const FIELD_WIDTH = 8.128; // z-direction
export const FIELD_LENGTH = 16.459; // x-direction, meters
const FLOOR_THICKNESS = 0.2;
const WALL_HEIGHT = 1;
const WALL_THICKNESS = 0.1;

export class Floor {
  readonly mesh: THREE.Mesh;
  private includeWalls = false;

  constructor(includeWalls = false) {
    this.includeWalls = includeWalls;
    this.mesh = new THREE.Mesh(
      new THREE.BoxGeometry(FIELD_LENGTH, FLOOR_THICKNESS, FIELD_WIDTH),
      new THREE.MeshStandardMaterial({ color: 0x8fa3b5 })
    );
    this.mesh.position.set(0, -FLOOR_THICKNESS / 2, 0);
    this.mesh.receiveShadow = true;
  }

  addColliders(world: RAPIER.World) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -FLOOR_THICKNESS / 2, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(FIELD_LENGTH / 2, FLOOR_THICKNESS / 2, FIELD_WIDTH / 2).setCollisionGroups(0x0001ffff), body);

    if (this.includeWalls) {
      let wall = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, WALL_HEIGHT / 2, -FIELD_WIDTH / 2));
      world.createCollider(RAPIER.ColliderDesc.cuboid(FIELD_LENGTH / 2, WALL_HEIGHT / 2, WALL_THICKNESS / 2).setCollisionGroups(0x0001ffff), wall);
      wall = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, WALL_HEIGHT / 2, FIELD_WIDTH / 2));
      world.createCollider(RAPIER.ColliderDesc.cuboid(FIELD_LENGTH / 2, WALL_HEIGHT / 2, WALL_THICKNESS / 2).setCollisionGroups(0x0001ffff), wall);
      wall = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(-FIELD_LENGTH / 2, WALL_HEIGHT / 2, 0));
      world.createCollider(RAPIER.ColliderDesc.cuboid(WALL_THICKNESS / 2, WALL_HEIGHT / 2, FIELD_WIDTH / 2).setCollisionGroups(0x0001ffff), wall);
      wall = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(FIELD_LENGTH / 2, WALL_HEIGHT / 2, 0));
      world.createCollider(RAPIER.ColliderDesc.cuboid(WALL_THICKNESS / 2, WALL_HEIGHT / 2, FIELD_WIDTH / 2).setCollisionGroups(0x0001ffff), wall);
    }
  }
}
