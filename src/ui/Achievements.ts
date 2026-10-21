
export type AchievementKey =
  | "distance-driven"
  | "path-followed"
  | "rotations"
  | "shots"
  | "fuel";

function sanitizeNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return 0;
}

export class Achievements {
  private static STORAGE_KEY = 'achievements_v1';
  private distanceDriven = 0;
  private pathFollowed = 0;
  private rotations = 0;
  private shots = 0;
  private fuel = 0;

  constructor() {
    try {
        const raw = localStorage.getItem(Achievements.STORAGE_KEY);
        if (raw) {
            const data = JSON.parse(raw);
            if (typeof data === 'object' && data !== null) {
                this.distanceDriven = sanitizeNumber(data.distanceDriven);
                this.pathFollowed = sanitizeNumber(data.pathFollowed);
                this.rotations = sanitizeNumber(data.rotations);
                this.shots = sanitizeNumber(data.shots);
                this.fuel = sanitizeNumber(data.fuel);
            }
            
        }
    } catch (e) {
    }
  }

  add(key: AchievementKey, increment: number) {
    switch (key) {
      case "distance-driven":
        this.distanceDriven += increment;
        break;
      case "path-followed":
        this.pathFollowed += increment;
        break;
      case "rotations":
        this.rotations += increment;
        break;
      case "shots":
        this.shots += increment;
        break;
      case "fuel":
        this.fuel += increment;
        break;
    }
    localStorage.setItem(Achievements.STORAGE_KEY, JSON.stringify({
        distanceDriven: this.distanceDriven,
        pathFollowed: this.pathFollowed,
        rotations: this.rotations,
        shots: this.shots,
        fuel: this.fuel,
    }));
  }

  formatDistance(key: "distance-driven" | "path-followed"): string {
    const meters =
      key === "distance-driven" ? this.distanceDriven : this.pathFollowed;
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(1)} <small>km</small>`;
    }
    return `${meters.toFixed(1)} <small>m</small>`;
  }

  formatRotations(key: "rotations"): string {
    if (this.rotations < 5) {
      return `${this.rotations * 360}°`;
    }
    return `${Math.floor(this.rotations)} <small>rotations</small>`;
  }

  formatNumber(key: "shots" | "fuel"): string {
    return key === "shots" ? String(this.shots) : String(this.fuel);
  }
}
