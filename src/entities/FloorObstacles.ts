import type RAPIER from "@dimforge/rapier3d-compat";
import { Bump } from "./Bump";
import { Trench } from "./Trench";
import { Hub } from "./Hub";
import { Group } from "three";

export class FloorObstacles {
  readonly group = new Group();

  private redFarBump: Bump;
  private redNearBump: Bump;
  private blueFarBump: Bump;
  private blueNearBump: Bump;
  private redFarTrench: Trench;
  private redNearTrench: Trench;
  private blueFarTrench: Trench;
  private blueNearTrench: Trench;

  constructor() {
    this.redFarBump = new Bump(Hub.HUB_X, Hub.WIDTH / 2 + Bump.WIDTH / 2);
    this.redNearBump = new Bump(Hub.HUB_X, -Hub.WIDTH / 2 - Bump.WIDTH / 2);
    this.blueFarBump = new Bump(-Hub.HUB_X, Hub.WIDTH / 2 + Bump.WIDTH / 2);
    this.blueNearBump = new Bump(-Hub.HUB_X, -Hub.WIDTH / 2 - Bump.WIDTH / 2);

    this.redFarTrench = new Trench(
      Hub.HUB_X,
      Hub.WIDTH / 2 + Bump.WIDTH + Trench.BARRIER_WIDTH / 2,
    );
    this.redNearTrench = new Trench(
      Hub.HUB_X,
      -Hub.WIDTH / 2 - Bump.WIDTH - Trench.BARRIER_WIDTH / 2,
    );
    this.blueFarTrench = new Trench(
      -Hub.HUB_X,
      Hub.WIDTH / 2 + Bump.WIDTH + Trench.BARRIER_WIDTH / 2,
    );
    this.blueNearTrench = new Trench(
      -Hub.HUB_X,
      -Hub.WIDTH / 2 - Bump.WIDTH - Trench.BARRIER_WIDTH / 2,
    );
    this.group.add(
      this.redFarBump.group,
      this.redNearBump.group,
      this.blueFarBump.group,
      this.blueNearBump.group,
      this.redFarTrench.group,
      this.redNearTrench.group,
      this.blueFarTrench.group,
      this.blueNearTrench.group,
    );
  }

  addColliders(world: RAPIER.World) {
    this.redFarBump.addColliders(world);
    this.redNearBump.addColliders(world);
    this.blueFarBump.addColliders(world);
    this.blueNearBump.addColliders(world);
    this.redFarTrench.addColliders(world);
    this.redNearTrench.addColliders(world);
    this.blueFarTrench.addColliders(world);
    this.blueNearTrench.addColliders(world);
  }
}
