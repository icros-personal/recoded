/**
 * Pure-pursuit path follower for a holonomic (swerve) robot.
 *
 * Translation and rotation are independent:
 *  - translation: drive (field-relative) toward a point a fixed distance
 *    ahead of the robot's closest progress along the path
 *  - rotation:    P-control toward the heading interpolated at that progress
 *
 * It knows nothing about obstacles. If the robot gets blocked, "progress"
 * simply stops advancing and the robot keeps pushing toward the same target.
 *
 * Conventions (match three.js with a yaw rotation about +Y):
 *   heading h  ->  robot forward = (cos h, 0, -sin h) in (x, y, z)
 *   positive omega = counter-clockwise when viewed from above
 */

export interface PathSample {
  x: number;
  z: number;
  /** cumulative arc length from the start of the path (m) */
  s: number;
  /** desired robot heading at this point (rad) */
  heading: number;
}

export interface PathStop {
  index: number;
  target: { x: number, z: number };
}

export interface Pose {
  x: number;
  z: number;
  heading: number;
}

/** Field-relative velocity command. */
export interface DriveCommand {
  vx: number; // m/s along +x
  vz: number; // m/s along +z
  omega: number; // rad/s about +y
}

export type FollowerState = 'driving' | 'aiming' | 'shooting';

export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
export const lerpAngle = (a: number, b: number, t: number) =>
  a + wrapAngle(b - a) * t;

export const headingToward = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tz - z), tx - x);

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

export class PathFollower {
  maxSpeed = 2.5; // m/s
  lookahead = 0.8; // m
  maxOmega = 4; // rad/s
  headingKp = 4; // (rad/s) per rad of error
  decel = 3; // m/s^2, used to slow down for the end of the path
  minSpeed = 0.3; // m/s, so we don't stall short of the end
  holdKp = 3; // 1/s, position hold while aiming/shooting
  /** how far ahead (m of arc length) we look for the closest point */
  searchWindow = 3;
  positionTolerance = 0.08; // m
  headingTolerance = 0.05; // rad

  settleTime = 0.2;
  fireInterval = 0.05;

  onFire: ((pose: Pose, stop: PathStop) => boolean) | null = null;

  finished = false;
  state: FollowerState = 'driving';

  private idx = 0;
  private stopCursor = 0;
  private timer = 0;

  constructor(private readonly path: PathSample[], private readonly stops: PathStop[]) {}

  /** Arc-length progress along the path (m). */
  get progress() {
    return this.path.length ? this.path[this.idx]!.s : 0;
  }

  get length() {
    return this.path.length ? this.path[this.path.length - 1]!.s : 0;
  }

  update(pose: Pose, dt: number): DriveCommand {
    const p = this.path;
    if (p.length === 0) return { vx: 0, vz: 0, omega: 0 };

    const stop: PathStop | undefined = this.stops[this.stopCursor];
    const goalIdx = stop ? stop.index : p.length - 1;
    const goal = p[goalIdx]!;

    if (stop && this.state !== 'driving') {
      return this.holdAndShoot(pose, dt, stop, goal);
    }

    // 1. Advance progress: closest sample within a forward-only window.
    //    (Forward-only so a path that loops back near itself can't make the
    //    follower jump to the wrong part.)
    const sLimit = p[this.idx]!.s + this.searchWindow;
    let best = this.idx;
    let bestD2 = Infinity;
    for (let j = this.idx; j < p.length && p[j]!.s <= sLimit; j++) {
      const dx = p[j]!.x - pose.x;
      const dz = p[j]!.z - pose.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = j;
      }
    }
    this.idx = best;
    const here = p[this.idx]!;

    // 2. Heading control
    const headingErr = wrapAngle(here.heading - pose.heading);
    const omega = clamp(
      this.headingKp * headingErr,
      -this.maxOmega,
      this.maxOmega,
    );

    // 3. Are we done?
    const remaining = goal.s - here.s;
    const dEnd = Math.hypot(goal.x - pose.x, goal.z - pose.z);
    if (remaining < 0.1 && dEnd < this.positionTolerance) {
      if (stop) {
        this.state = 'aiming';
        this.timer = 0;
        return { vx: 0, vz: 0, omega };
      }
      this.finished = Math.abs(headingErr) < this.headingTolerance;
      return { vx: 0, vz: 0, omega };
    }

    // 4. Pick the lookahead point and drive toward it
    let j = this.idx;
    while (j < goalIdx && p[j]!.s < here.s + this.lookahead) j++;
    const target = p[j]!;

    const dx = target.x - pose.x;
    const dz = target.z - pose.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-6) return { vx: 0, vz: 0, omega };

    // Slow down as the end of the path approaches (kinematic decel profile)
    const stopSpeed = Math.sqrt(2 * this.decel * Math.max(remaining, 0));
    const speed = clamp(stopSpeed, this.minSpeed, this.maxSpeed);

    return { vx: (dx / dist) * speed, vz: (dz / dist) * speed, omega };
  }

  private holdAndShoot(
    pose: Pose,
    dt: number,
    stop: PathStop,
    goal: PathSample,
  ): DriveCommand {
    const aim = headingToward(pose.x, pose.z, stop.target.x, stop.target.z);
    const headingErr = wrapAngle(aim - pose.heading);
    const omega = clamp(
      this.headingKp * headingErr,
      -this.maxOmega,
      this.maxOmega
    );
    const hold: DriveCommand = {
      vx: clamp(this.holdKp * (goal.x - pose.x), -1, 1),
      vz: clamp(this.holdKp * (goal.z - pose.z), -1, 1),
      omega,
    };

    if (this.state === 'aiming') {
      this.timer = Math.abs(headingErr) < this.headingTolerance ? this.timer + dt : 0;
      if (this.timer >= this.settleTime) {
        this.state = 'shooting';
      }
      return hold;
    }

    this.timer += dt;
    if (this.timer >= this.fireInterval) {
      this.timer = 0;
      const doneFiring = this.onFire?.(pose, stop) ?? true;
      if (doneFiring) {
        this.stopCursor++;
        this.state = 'driving';
        this.timer = 0;
      }
    }
    return hold;
  }
}