import { FIELD_LENGTH, FIELD_WIDTH } from "../entities/Floor";
import { Hub } from "../entities/Hub";

export function inNeutralZone(x: number, z: number): boolean {
  return (
    x >= Hub.HUB_X + Hub.WIDTH / 2 &&
    x <= -Hub.HUB_X - Hub.WIDTH / 2 &&
    z >= -FIELD_WIDTH / 2 &&
    z <= FIELD_WIDTH / 2
  );
}

export function inAllianceZone(x: number, z: number): boolean {
  return (
    x >= -FIELD_LENGTH / 2 &&
    x <= Hub.HUB_X - Hub.WIDTH / 2 &&
    z >= -FIELD_WIDTH / 2 &&
    z <= FIELD_WIDTH / 2
  );
}
