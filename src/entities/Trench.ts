
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

/**
 * Trench barrier:
 * - Hexagonal-prism main body, with its hexagonal cross-section in XY.
 * - Square bar resting on top, extending in +Z.
 * - Simplified box collider for the main barrier footprint only.
 *
 * The main prism is centered at (x, z) at floor level.
 */
export class Trench {
  static readonly TRENCH_FULL_THICKNESS = 1.1938;
  static readonly BARRIER_WIDTH = 12 / 39.3701;
  static readonly SHORT_HEIGHT = 7.65 / 39.3701;
  static readonly TALL_HEIGHT = 22.5 / 39.3701;
  static readonly BAR_THICKNESS = 4 / 39.3701;
  static readonly BAR_LENGTH = 53.594 / 39.3701;

  readonly group = new THREE.Group();

  constructor(x = 0, z = 0) {
    const {
      TRENCH_FULL_THICKNESS: length,
      BARRIER_WIDTH: width,
      SHORT_HEIGHT: shortHeight,
      TALL_HEIGHT: tallHeight,
      BAR_THICKNESS: barThickness,
      BAR_LENGTH: barLength,
    } = Trench;

    const halfLength = length / 2;
    const halfWidth = width / 2;
    const halfTop = barThickness / 2;

    // Hexagonal cross-section in the XY plane.
    // Bottom corners span the full length.
    // The lower rectangular section reaches shortHeight.
    // The sloped shoulders rise to the narrow top at tallHeight.
    const profile: [number, number][] = [
      [-halfLength, 0],
      [ halfLength, 0],
      [ halfLength, shortHeight],
      [ halfTop, tallHeight],
      [-halfTop, tallHeight],
      [-halfLength, shortHeight],
    ];

    // Extrude the profile across Z to form the prism.
    const vertices: number[] = [];

    for (const zOffset of [-halfWidth, halfWidth]) {
      for (const [px, py] of profile) {
        vertices.push(px, py, zOffset);
      }
    }

    const n = profile.length;
    const indices: number[] = [];

    // Front and back caps.
    // The polygon is convex, so a triangle fan works for each cap.
    for (let i = 1; i < n - 1; i++) {
      // z = -halfWidth
      indices.push(0, i + 1, i);

      // z = +halfWidth
      indices.push(n, n + i, n + i + 1);
    }

    // Six rectangular side faces.
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      const a = i;
      const b = next;
      const c = n + next;
      const d = n + i;

      indices.push(a, b, d);
      indices.push(b, c, d);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const body = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: 0x64748b,
        roughness: 0.8,
        side: THREE.DoubleSide,
      }),
    );

    body.castShadow = true;
    this.group.add(body);

    // Square bar sitting on the narrow top of the barrier.
    // Its near end begins at the +Z face of the main prism.
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(barThickness, barThickness, barLength),
      new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.65,
      }),
    );

    bar.position.set(
      0,
      tallHeight + halfTop,
      z < 0 ? halfWidth - barLength / 2 : -halfWidth + barLength / 2,
    );

    this.group.add(bar);

    this.group.position.set(x, 0, z);
  }

  /** Add a simplified static collider for the main barrier footprint. */
  addColliders(world: RAPIER.World) {
    const { x, z } = this.group.position;

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(
        x,
        Trench.TALL_HEIGHT / 2,
        z,
      ),
    );

    const collider = RAPIER.ColliderDesc.cuboid(
      Trench.TRENCH_FULL_THICKNESS / 2,
      Trench.TALL_HEIGHT / 2,
      Trench.BARRIER_WIDTH / 2,
    );

    world.createCollider(collider, body);
  }
}
