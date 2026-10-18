import * as THREE from "three";
import { SimpleRobot } from "./SimpleRobot";
import { Ball } from "./Ball";

export class Robot extends SimpleRobot {
  static readonly DEFAULT_MAX_CAPACITY = 50;

  private readonly maxCapacity: number;
  private ballCount = 0;
  private readonly ballMeshes: THREE.Mesh[] = [];
  private readonly storagePositions: THREE.Vector3[] = [];

  constructor(x = 0, z = 0, maxCapacity = Robot.DEFAULT_MAX_CAPACITY) {
    super(x, z);
    this.maxCapacity = maxCapacity;
    this.generatePackingPositions();
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
}
