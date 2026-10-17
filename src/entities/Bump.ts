import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

export class Bump {
  static readonly HEIGHT = 0.1651;
  static readonly WIDTH = 1.8542; // width for robot to go through
  static readonly LENGTH = 1.1938; // basically the same as hub, parallel to hub
  static readonly ANGLE = (15 * Math.PI) / 180;

  readonly group = new THREE.Group();

  constructor(x = 0, z = 0) {
    const l = Bump.LENGTH / 2;
    const w = Bump.WIDTH / 2;
    const h = Bump.HEIGHT;

    const vertices = new Float32Array([
      // Ramp on the -x side
      -l,
      0,
      -w,
      0,
      h,
      -w,
      0,
      h,
      w,
      -l,
      0,
      w,
      // Ramp on the +x side
      0,
      h,
      -w,
      l,
      0,
      -w,
      l,
      0,
      w,
      0,
      h,
      w,
    ]);

    const indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      color: x < 0 ? 0xbc2626 : 0x4085ea,
      roughness: 0.85,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;

    this.group.add(mesh);
    this.group.position.set(x, 0, z);
  }

  addColliders(world: RAPIER.World) {
    const { x, y, z } = this.group.position;
    const vertices = new Float32Array([
      -Bump.WIDTH / 2,
      0,
      -Bump.LENGTH / 2,
      0,
      Bump.HEIGHT,
      -Bump.LENGTH / 2,
      Bump.WIDTH / 2,
      0,
      -Bump.LENGTH / 2,

      -Bump.WIDTH / 2,
      0,
      Bump.LENGTH / 2,
      0,
      Bump.HEIGHT,
      Bump.LENGTH / 2,
      Bump.WIDTH / 2,
      0,
      Bump.LENGTH / 2,
    ]);

    const shape = RAPIER.ColliderDesc.convexHull(vertices);

    if (!shape) {
      throw new Error("Failed to create bump convex hull");
    }

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z),
    );

    world.createCollider(shape, body);
  }
}
