import * as THREE from "three";
import { SimpleRobot } from "./SimpleRobot";
import { Ball } from "./Ball";
import type { World } from "@dimforge/rapier3d-compat";
import RAPIER from "@dimforge/rapier3d-compat";
import { CollisionGroups } from "./CollisionGroups";
import type { Hub } from "./Hub";

export class Robot extends SimpleRobot {
  static readonly DEFAULT_MAX_CAPACITY = 50;
  static readonly INTAKE_HEIGHT = Ball.RADIUS * 2;
  static readonly INTAKE_DEPTH = 0.06;

  private readonly maxCapacity: number;
  private ballCount = 0;
  private readonly ballMeshes: THREE.Mesh[] = [];
  private readonly storagePositions: THREE.Vector3[] = [];

  private intakeMesh: THREE.Mesh;
  private intakeCollider!: RAPIER.Collider;

  constructor(x = 0, z = 0, maxCapacity = Robot.DEFAULT_MAX_CAPACITY) {
    super(x, z);
    this.intakeMesh = new THREE.Mesh(
        new THREE.BoxGeometry(Robot.INTAKE_DEPTH, Robot.INTAKE_HEIGHT, SimpleRobot.ROBOT_DEPTH),
        new THREE.MeshStandardMaterial({ color: 0x475569, transparent: true, opacity: 0.6, roughness: 0.75}),
    );
    this.intakeMesh.position.x = SimpleRobot.ROBOT_WIDTH / 2 + Robot.INTAKE_DEPTH / 2;
    this.intakeMesh.position.y = -SimpleRobot.ROBOT_HEIGHT / 2 + Robot.INTAKE_HEIGHT;
    this.group.children[0]?.add(this.intakeMesh);

    this.maxCapacity = maxCapacity;
    this.generatePackingPositions();
  }

  override addColliders(world: World): void {
      super.addColliders(world);
      const intakeDesc = RAPIER.ColliderDesc
        .cuboid(Robot.INTAKE_DEPTH / 2, Robot.INTAKE_HEIGHT / 2, SimpleRobot.ROBOT_DEPTH / 2)
        .setSensor(true)
        .setTranslation(this.intakeMesh.position.x, this.intakeMesh.position.y, 0)
        .setDensity(0)
        .setCollisionGroups((CollisionGroups.ROBOT_INTAKE << 16) | CollisionGroups.BALL_ACTIVE);

    this.intakeCollider = world.createCollider(intakeDesc, this.getPhysicsBody());
  }

  /**
   * Generates a tightly-nested offset 3D lattice (close-packing) inside the robot's
   * internal volume. Alternating layers are offset in X and Z so spheres nest in gaps.
   */
  private generatePackingPositions() {
    const radius = Ball.RADIUS;
    const diameter = radius * 2;
    const clearance = 0.01; // Small gap from the inner walls

    // Usable internal dimensions
    const boxWidth = SimpleRobot.ROBOT_WIDTH - clearance * 2;
    const boxHeight = (SimpleRobot.ROBOT_HEIGHT - 0.0508) - clearance * 2;
    const boxDepth = SimpleRobot.ROBOT_DEPTH - clearance * 2;

    // Box center and bounds in group local coordinates
    const boxCenterY = SimpleRobot.ROBOT_HEIGHT / 2 - 0.0508;
    const minY = boxCenterY - boxHeight / 2 + radius;
    const maxY = boxCenterY + boxHeight / 2 - radius;

    const minX = -boxWidth / 2 + radius;
    const maxX = boxWidth / 2 - radius;

    const minZ = -boxDepth / 2 + radius;
    const maxZ = boxDepth / 2 - radius;

    if (minX > maxX || minY > maxY || minZ > maxZ) {
      return; // Robot internal volume is too small for a ball
    }

    // Vertical spacing for close-packed spheres (sqrt(6)/3 ≈ 0.8165 of diameter)
    const verticalStep = diameter * (Math.sqrt(6) / 3);

    for (let y = minY, layer = 0; y <= maxY; y += verticalStep, layer++) {
      // Offset alternating layers to nest spheres into gaps
      const xOffset = (layer % 2) * radius;
      const zOffset = (Math.floor(layer / 2) % 2) * radius;

      for (let z = minZ; z <= maxZ; z += diameter) {
        for (let x = minX; x <= maxX; x += diameter) {
          const posX = x + xOffset;
          const posZ = z + zOffset;

          // Ensure the shifted ball stays within the inner wall bounds
          if (
            posX - radius >= -boxWidth / 2 &&
            posX + radius <= boxWidth / 2 &&
            posZ - radius >= -boxDepth / 2 &&
            posZ + radius <= boxDepth / 2
          ) {
            this.storagePositions.push(new THREE.Vector3(posX, y, posZ));
          }
        }
      }
    }
  }

  /**
   * Returns the current number of balls the robot is holding.
   */
  getBallCount(): number {
    return this.ballCount;
  }

  /**
   * Returns the maximum capacity of balls the robot can hold.
   */
  getMaxCapacity(): number {
    return this.maxCapacity;
  }

  /**
   * Checks if the robot has room for another ball.
   */
  isFull(): boolean {
    return this.ballCount >= this.maxCapacity;
  }

  clearBalls() {
    this.group.remove(...this.ballMeshes);
    this.ballCount = 0;
  }

  /**
   * Attempts to add a ball to the robot's inventory.
   * Returns true if successful, or false if the robot is already at max capacity.
   */
  addBall(): boolean {
    if (this.isFull()) {
      return false;
    }

    const currentIdx = this.ballCount;
    this.ballCount++;

    if (currentIdx < this.storagePositions.length) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(Ball.RADIUS, 24, 16),
        new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.7 }),
      );

      // Place mesh at the corresponding predefined storage position
      const pos = this.storagePositions[currentIdx]!;
      mesh.position.copy(pos);

      this.group.add(mesh);
      this.ballMeshes.push(mesh);
    }

    return true;
  }

  /**
   * Removes and disposes of a ball from the robot's inventory (e.g., when shooting).
   * Returns true if a ball was successfully removed, or false if the robot was empty.
   */
  removeBall(): boolean {
    if (this.ballCount <= 0) {
      return false;
    }

    this.ballCount--;
    if (this.ballCount < this.storagePositions.length) {
      const mesh = this.ballMeshes.pop();

      if (mesh) {
        this.group.remove(mesh);
        mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((mat) => mat.dispose());
        } else {
          mesh.material.dispose();
        }
      }
    }

    return true;
  }

  getIntakeCollider(): RAPIER.Collider {
    return this.intakeCollider;
  }

  getShotAngle(hub: Hub): number {
    const distance = this.getDistanceToHub(hub.group.position);
    return this.getShotAngleForDistance(distance);
  }

  getShotAngleForDistance(distance: number): number {
    if (distance >= 3) return 60;
    if (distance <= 1) return 80;
    const t = (distance - 1) / (3 - 1);
    return 80 + t * (60 - 80);
  }
}
