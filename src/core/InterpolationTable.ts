export type InterpolationResult = {
  value: number;
  indices: [] | [number] | [number, number];
};

/**
 * A numeric lookup table with linear interpolation between entries.
 * Keys are sorted in ascending order for interpolation.
 */
export class InterpolationTable {
  private readonly map: Map<number, number>;

  constructor(initialValues: Map<number, number> = new Map()) {
    this.map = new Map(initialValues);
  }

  /** A copy of the values, sorted by key. */
  values(): Map<number, number> {
    return new Map([...this.map].sort(([a], [b]) => a - b));
  }

  set(key: number, value: number): void {
    this.map.set(key, value);
  }

  delete(key: number): void {
    this.map.delete(key);
  }

  getInterpolatedValue(key: number): InterpolationResult {
    const entries = [...this.values()];

    if (entries.length === 0) {
      return { value: 1000, indices: [] };
    }

    if (key <= entries[0]![0]) {
      return { value: entries[0]![1], indices: [0] };
    }

    const last = entries.length - 1;
    if (key >= entries[last]![0]) {
      return { value: entries[last]![1], indices: [last] };
    }

    let i = 1;
    while (entries[i]![0] < key) {
      i++;
    }

    const [x0, y0] = entries[i - 1]!;
    const [x1, y1] = entries[i]!;

    const t = (key - x0) / (x1 - x0);

    return {
      value: y0 + t * (y1 - y0),
      indices: [i - 1, i],
    };
  }

  static fromStorage(value: unknown, defaults?: [number, number][]): InterpolationTable {
    const map = new Map<number, number>();
    if (Array.isArray(value)) {
      for (const pair of value) {
        if (
          Array.isArray(pair) &&
          pair.length === 2 &&
          typeof pair[0] === "number" &&
          Number.isFinite(pair[0]) &&
          typeof pair[1] === "number" &&
          Number.isFinite(pair[1])
        ) {
          map.set(Math.round(pair[0] * 100) / 100, pair[1]);
        }
      }
    }

    if (map.size === 0 && defaults) {
      for (const pair of defaults) {
        map.set(pair[0], pair[1]);
      }
    }
    return new InterpolationTable(map);
  }

  toStorage(): [number, number][] {
    return [...this.values()];
  }
}
