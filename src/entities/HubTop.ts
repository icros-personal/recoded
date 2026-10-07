import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import RAPIER from '@dimforge/rapier3d-compat';

export interface HubTopOptions {
  /** Half the deck's side length (the deck is a square centered on the hub). */
  halfSize: number;
  /** Circumradius of the hexagonal hole. Corners point along ±X, flats face ±Z. */
  holeRadius: number;
  /** Hub-local height of the underside of the deck. */
  baseY: number;
  thickness: number;
}

type Point2 = [x: number, z: number];

/**
 * The top of the Hub: a square slab with a hexagonal hole, built from six
 * convex pieces (a collider can't have a hole, but a union of convex shapes
 * can). The same points drive the visual mesh and the physics colliders.
 *
 *        +Z
 *   ┌───────────┐
 *   │  strip    │   2 strips on the flat (±Z) sides of the hole
 *   ├──┬─────┬──┤
 *   │c1│ hex │c2│   4 corner pieces, split at z = 0 so each is convex
 *   ├──┴─────┴──┤
 *   │  strip    │
 *   └───────────┘
 */
export class HubTop {
  readonly group = new THREE.Group();
  /** Hub-local corner points (2 × polygon size per piece). */
  private readonly parts: THREE.Vector3[][] = [];

  constructor({ halfSize: w, holeRadius: r, baseY, thickness }: HubTopOptions) {
    const a = (r * Math.sqrt(3)) / 2; // hexagon apothem: its flats are at z = ±a

    const polygons: Point2[][] = [
      // Strips beyond the hexagon's flat sides, full width.
      [[-w, a], [w, a], [w, w], [-w, w]],
      [[-w, -w], [w, -w], [w, -a], [-w, -a]],
    ];
    // Corner pieces: from the hexagon's pointed corner (±r, 0) and its slanted
    // edge out to the square's edge, one per quadrant.
    for (const sx of [1, -1]) {
      for (const sz of [1, -1]) {
        polygons.push([
          [sx * r, 0],
          [(sx * r) / 2, sz * a],
          [sx * w, sz * a],
          [sx * w, 0],
        ]);
      }
    }

    const material = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.65 });

    for (const polygon of polygons) {
      const points = [
        ...polygon.map(([x, z]) => new THREE.Vector3(x, baseY, z)),
        ...polygon.map(([x, z]) => new THREE.Vector3(x, baseY + thickness, z)),
      ];
      this.parts.push(points);

      const mesh = new THREE.Mesh(new ConvexGeometry(points), material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  /** `origin` is the Hub's world position (the points above are hub-local). */
  addColliders(world: RAPIER.World, origin: { x: number; y: number; z: number }) {
    for (const points of this.parts) {
      const flat = new Float32Array(points.length * 3);
      points.forEach((p, i) => {
        flat[i * 3] = p.x + origin.x;
        flat[i * 3 + 1] = p.y + origin.y;
        flat[i * 3 + 2] = p.z + origin.z;
      });
      const desc = RAPIER.ColliderDesc.convexHull(flat);
      if (desc) world.createCollider(desc); // no parent body = fixed
    }
  }
}