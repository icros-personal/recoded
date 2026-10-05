import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { Ball } from "./Ball";
import { HubFunnel } from "./HubFunnel";
import { HubTop } from "./HubTop";

/**
 * REBUILT-inspired cartoon Hub. The real Hub is a 47" x 47" box with a
 * 41.7" hexagonal opening in the top, whose front edge is 72" above carpet.
 * We model the opening explicitly so the player has an unmistakable target.
 */
export class Hub {
  static readonly WIDTH = 47 / 39.3701;
  static readonly HEIGHT = 54 / 39.3701;
  static readonly DEPTH = 47 / 39.3701;
  static readonly WALL_THICKNESS = 0.12;
  /** Visual approximation of the 41.7" hex opening. */
  static readonly OPENING_RADIUS = 24.7 / 39.3701 / 2;
  /** Slightly smaller than the visual so scoring is "conservative". */
  static readonly SCORING_RADIUS = 24 / 39.3701 / 2;

  readonly group = new THREE.Group();
  private readonly top: HubTop;
  private readonly funnel: HubFunnel;

  constructor(x = 0, z = 0) {
    const { WIDTH, HEIGHT, DEPTH, OPENING_RADIUS } = Hub;

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(WIDTH, HEIGHT, DEPTH),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.72 }),
    );
    body.position.y = HEIGHT / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    this.group.add(body);

    // Cover the top visually, then put a dark hexagonal hole on top of it. The
    // dark face is deliberately slightly above the red top so it reads clearly
    // even with the fixed camera.
    //const top = new THREE.Mesh(
      //new THREE.BoxGeometry(WIDTH + 0.04, 0.08, DEPTH + 0.04),
      //new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.65 }),
    //);
    //top.position.y = HEIGHT + 0.04;
    //top.castShadow = true;
    //this.group.add(top);
    this.top = new HubTop({
      halfSize: (WIDTH + 0.04) / 2,
      holeRadius: OPENING_RADIUS,
      baseY: HEIGHT,
      thickness: 0.08,
    });
    this.group.add(this.top.group);

    const hole = new THREE.Mesh(
      new THREE.CircleGeometry(OPENING_RADIUS, 6),
      new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 }),
    );
    hole.rotation.x = -Math.PI / 2;
    hole.position.y = HEIGHT + 0.085;
    this.group.add(hole);

    this.funnel = new HubFunnel({
      bottomRadius: OPENING_RADIUS,
      baseY: HEIGHT + 0.08,
      topRadius: 41.7 / 39.3701 / 2,
      rise: (72 / 39.3701) - HEIGHT,
    });
    this.group.add(this.funnel.group);

    this.group.position.set(x, 0, z);
  }

  /** Add the four walls as static colliders. Call after positioning the hub. */
  addColliders(world: RAPIER.World) {
    const { x: hx, z: hz } = this.group.position;
    const w = Hub.WIDTH / 2;
    const d = Hub.DEPTH / 2;
    const h = Hub.HEIGHT / 2;
    const t = Hub.WALL_THICKNESS / 2;

    const walls = [
      // Front/back
      { x: hx, z: hz - d, sx: w, sz: t },
      { x: hx, z: hz + d, sx: w, sz: t },
      // Left/right
      { x: hx - w, z: hz, sx: t, sz: d },
      { x: hx + w, z: hz, sx: t, sz: d },
    ];

    for (const wall of walls) {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(wall.x, h, wall.z),
      );
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(wall.sx, h, wall.sz),
        body,
      );
    }

    this.top.addColliders(world, this.group.position);
    this.funnel.addColliders(world, this.group.position);
  }

  /**
   * True if a ball moving from height `prevY` to `pos` passed downward through
   * the opening this step. Level 1 treats the opening as a simple scoring
   * plane with a conservative hex-like footprint.
   */
  isScoringCrossing(
    prevY: number,
    pos: { x: number; y: number; z: number },
  ): boolean {
    const dx = Math.abs(pos.x - this.group.position.x);
    const dz = Math.abs(pos.z - this.group.position.z);
    const r = Hub.SCORING_RADIUS;
    // circle approximation
    const insideHex = Math.hypot(dx, dz) < r;
    const crossedOpening =
      prevY > Hub.HEIGHT - Ball.RADIUS && pos.y <= Hub.HEIGHT - Ball.RADIUS;
    return crossedOpening && insideHex;
  }
}
