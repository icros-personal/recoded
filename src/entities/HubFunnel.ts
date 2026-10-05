import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import RAPIER from '@dimforge/rapier3d-compat';

export interface HubFunnelOptions {
  /** Circumradius of the hexagon at the bottom (= side length of the hexagon). */
  bottomRadius: number;
  /** Circumradius of the hexagon at the top rim. Must be > bottomRadius. */
  topRadius: number;
  /** Vertical rise from bottom edge to top edge. */
  rise: number;
  /** Hub-local height of the bottom edge (top of the Hub deck). */
  baseY: number;
  /** Panel thickness, extruded away from the funnel interior. */
  thickness?: number;
}

/**
 * A (possibly partial) inverted hexagonal pyramid frustum. Each panel is a
 * trapezoid prism: the interior face sits exactly on a hexagon edge at the
 * bottom and the matching, larger edge at the top.
 *
 * Hexagon vertex k is at angle 60°·k, so vertices point along ±X like the
 * Hub's opening.
 */
export class HubFunnel {
  readonly group = new THREE.Group();
  /** Hub-local corner points (8 per panel), shared by the mesh and the collider. */
  private readonly panels: THREE.Vector3[][] = [];

  constructor(opts: HubFunnelOptions) {
    const { bottomRadius: r0, topRadius: r1, rise, baseY, thickness = 0.05 } = opts;
    const material = new THREE.MeshStandardMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.5, roughness: 0.6 });

    const hexPoint = (k: number, r: number, y: number) => {
      const a = (k * Math.PI) / 3;
      return new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a));
    };

    for (let k = 0; k < 6; k++) {
      // Trapezoid corners on the funnel's inner surface.
      const b0 = hexPoint(k, r0, baseY);
      const b1 = hexPoint(k + 1, r0, baseY);
      const t1 = hexPoint(k + 1, r1, baseY + rise);
      const t0 = hexPoint(k, r1, baseY + rise);

      // Panel normal, flipped (if needed) to point away from the funnel axis
      // (i.e. outward and downward), so the prism grows on the outside.
      const normal = new THREE.Vector3()
        .subVectors(b1, b0)
        .cross(new THREE.Vector3().subVectors(t0, b0))
        .normalize();
      const radial = new THREE.Vector3(b0.x + b1.x, 0, b0.z + b1.z);
      if (normal.dot(radial) < 0) normal.negate();

      const inner = [b0, b1, t1, t0];
      const points = [...inner, ...inner.map((p) => p.clone().addScaledVector(normal, thickness))];
      this.panels.push(points);

      const mesh = new THREE.Mesh(new ConvexGeometry(points), material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  /** `origin` is the Hub's world position (the points above are hub-local). */
  addColliders(world: RAPIER.World, origin: { x: number; y: number; z: number }) {
    for (const points of this.panels) {
      const flat = new Float32Array(points.length * 3);
      points.forEach((p, i) => {
        flat[i * 3] = p.x + origin.x;
        flat[i * 3 + 1] = p.y + origin.y;
        flat[i * 3 + 2] = p.z + origin.z;
      });
      const desc = RAPIER.ColliderDesc.convexHull(flat);
      if (desc) world.createCollider(desc.setRestitution(0.2)); // no parent body = fixed
    }
  }
}