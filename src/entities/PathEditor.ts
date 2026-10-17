import * as THREE from "three";
import { lerpAngle, wrapAngle, type PathSample } from "../core/PathFollower";

/**
 * Interactive waypoint editor drawn on the field (y = 0 plane).
 *
 *  - tap/click empty floor      -> add a waypoint (inherits previous heading)
 *  - drag a waypoint            -> move it
 *  - tap a waypoint             -> select it, revealing a heading handle
 *  - drag the heading handle    -> rotate the robot heading at that waypoint
 *  - Delete / Backspace         -> remove selected waypoint
 *
 * Works with mouse and touch via Pointer Events. All picking is done by
 * raycasting onto the floor plane, so it is independent of how the camera
 * is oriented.
 *
 * The path always starts at a fixed start pose (the robot's start) and passes
 * through the waypoints in order using a centripetal Catmull-Rom spline.
 * The editor deliberately knows nothing about obstacles.
 */

export interface StartPose {
  x: number;
  z: number;
  heading: number;
}

interface Waypoint {
  x: number;
  z: number;
  heading: number;
  group: THREE.Group;
  ring: THREE.Mesh;
  handle: THREE.Mesh;
  arrow: THREE.Group;
}

type Drag =
  | { kind: "move"; wp: Waypoint; offX: number; offZ: number }
  | { kind: "heading"; wp: Waypoint };

const Y = 0.03; // draw slightly above the floor
const HANDLE_DIST = 0.85; // m from waypoint center to heading handle
const RIBBON_WIDTH = 0.07; // m
const SAMPLE_SPACING = 0.05; // m (approximate)
const COLOR_PATH = 0xffd400;
const COLOR_WP = 0xffffff;
const COLOR_SELECTED = 0x00e5ff;

export class PathEditor {
  readonly group = new THREE.Group();
  enabled = true;
  onChange: (() => void) | null = null;

  private waypoints: Waypoint[] = [];
  private selected: Waypoint | null = null;
  private drag: Drag | null = null;
  private pending: { id: number; cx: number; cy: number } | null = null;

  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private tmp = new THREE.Vector3();

  private ribbon: THREE.Mesh;
  private ribbonMat = this.mat(COLOR_PATH);
  private bodyMat = this.mat(COLOR_WP);
  private selMat = this.mat(COLOR_SELECTED);
  private geos: THREE.BufferGeometry[] = [];

  private discGeo = this.track(
    new THREE.CircleGeometry(0.18, 24).rotateX(-Math.PI / 2),
  );
  private ringGeo = this.track(
    new THREE.RingGeometry(0.24, 0.3, 32).rotateX(-Math.PI / 2),
  );
  private handleGeo = this.track(
    new THREE.CircleGeometry(0.14, 20).rotateX(-Math.PI / 2),
  );
  private shaftGeo = this.track(
    new THREE.BoxGeometry(0.4, 0.002, 0.05).translate(0.25, 0, 0),
  );
  private tipGeo = this.track(this.makeTip());

  private readonly prevTouchAction: string;

  constructor(
    private readonly dom: HTMLElement,
    private readonly getCamera: () => THREE.Camera,
    private readonly start: StartPose,
    private readonly bounds: { halfLength: number; halfWidth: number },
  ) {
    this.prevTouchAction = dom.style.touchAction;
    dom.style.touchAction = "none"; // let us own touch gestures on the canvas

    // Start marker (not editable)
    const startRing = new THREE.Mesh(
      this.track(new THREE.RingGeometry(0.2, 0.28, 32).rotateX(-Math.PI / 2)),
      this.ribbonMat,
    );
    startRing.position.set(start.x, Y, start.z);
    startRing.renderOrder = 9;
    this.group.add(startRing);

    this.ribbon = new THREE.Mesh(new THREE.BufferGeometry(), this.ribbonMat);
    this.ribbon.renderOrder = 9;
    this.ribbon.frustumCulled = false;
    this.ribbon.visible = false;
    this.group.add(this.ribbon);

    dom.addEventListener("pointerdown", this.onDown);
    dom.addEventListener("pointermove", this.onMove);
    dom.addEventListener("pointerup", this.onUp);
    dom.addEventListener("pointercancel", this.onCancel);
    window.addEventListener("keydown", this.onKey);
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  get count() {
    return this.waypoints.length;
  }

  get hasSelection() {
    return this.selected !== null;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      this.select(null);
      this.drag = null;
      this.pending = null;
    }
    // In run mode, hide the editing UI but keep the curve visible.
    for (const w of this.waypoints) w.group.visible = enabled;
    this.dom.style.touchAction = enabled ? "none" : this.prevTouchAction;
  }

  deleteSelected() {
    const wp = this.selected;
    if (!wp) return;
    this.select(null);
    this.waypoints = this.waypoints.filter((w) => w !== wp);
    this.group.remove(wp.group);
    this.rebuildCurve();
    this.onChange?.();
  }

  clear() {
    this.select(null);
    for (const w of this.waypoints) this.group.remove(w.group);
    this.waypoints = [];
    this.rebuildCurve();
    this.onChange?.();
  }

  /**
   * Dense, evenly-ish spaced samples of the smooth path, including
   * cumulative arc length and an interpolated heading.
   */
  getSamples(): PathSample[] {
    const pts = [this.start, ...this.waypoints];
    if (pts.length < 2) return [];

    const curve = new THREE.CatmullRomCurve3(
      pts.map((p) => new THREE.Vector3(p.x, 0, p.z)),
      false,
      "centripetal",
    );
    const segs = pts.length - 1;
    const out: PathSample[] = [];
    let s = 0;

    for (let seg = 0; seg < segs; seg++) {
      const chord = Math.hypot(
        pts[seg + 1]!.x - pts[seg]!.x,
        pts[seg + 1]!.z - pts[seg]!.z,
      );
      const n = Math.min(400, Math.max(8, Math.ceil(chord / SAMPLE_SPACING)));
      for (let k = seg === 0 ? 0 : 1; k <= n; k++) {
        const f = k / n;
        const p = curve.getPoint((seg + f) / segs, this.tmp);
        const prev = out[out.length - 1];
        if (prev) s += Math.hypot(p.x - prev.x, p.z - prev.z);
        const smooth = f * f * (3 - 2 * f);
        out.push({
          x: p.x,
          z: p.z,
          s,
          heading: lerpAngle(pts[seg]!.heading, pts[seg + 1]!.heading, smooth),
        });
      }
    }
    return out;
  }

  dispose() {
    this.dom.removeEventListener("pointerdown", this.onDown);
    this.dom.removeEventListener("pointermove", this.onMove);
    this.dom.removeEventListener("pointerup", this.onUp);
    this.dom.removeEventListener("pointercancel", this.onCancel);
    window.removeEventListener("keydown", this.onKey);
    this.dom.style.touchAction = this.prevTouchAction;

    this.ribbon.geometry.dispose();
    for (const g of this.geos) g.dispose();
    this.ribbonMat.dispose();
    this.bodyMat.dispose();
    this.selMat.dispose();
    this.group.removeFromParent();
  }

  // ------------------------------------------------------------------
  // Pointer handling
  // ------------------------------------------------------------------

  private onDown = (e: PointerEvent) => {
    if (!this.enabled) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const w = this.toWorld(e.clientX, e.clientY);
    if (!w) return;
    const hitR = this.hitRadius(e);

    // 1. Heading handle of the selected waypoint
    const sel = this.selected;
    if (sel) {
      const hx = sel.x + Math.cos(sel.heading) * HANDLE_DIST;
      const hz = sel.z - Math.sin(sel.heading) * HANDLE_DIST;
      if (Math.hypot(w.x - hx, w.z - hz) < hitR) {
        this.drag = { kind: "heading", wp: sel };
        this.capture(e);
        return;
      }
    }

    // 2. A waypoint body (latest-added wins on overlap)
    for (let i = this.waypoints.length - 1; i >= 0; i--) {
      const wp = this.waypoints[i]!;
      if (Math.hypot(w.x - wp.x, w.z - wp.z) < hitR) {
        this.select(wp);
        this.drag = {
          kind: "move",
          wp,
          offX: wp.x - w.x,
          offZ: wp.z - w.z,
        };
        this.capture(e);
        return;
      }
    }

    // 3. Empty floor: add a waypoint on release (unless it turns into a drag)
    this.pending = { id: e.pointerId, cx: e.clientX, cy: e.clientY };
    this.capture(e);
  };

  private onMove = (e: PointerEvent) => {
    if (!this.enabled) return;

    if (this.pending && e.pointerId === this.pending.id) {
      if (
        Math.hypot(e.clientX - this.pending.cx, e.clientY - this.pending.cy) > 8
      ) {
        this.pending = null; // it's a gesture, not a tap
      }
    }

    if (!this.drag) return;
    const w = this.toWorld(e.clientX, e.clientY);
    if (!w) return;
    const wp = this.drag.wp;

    if (this.drag.kind === "move") {
      this.place(wp, w.x + this.drag.offX, w.z + this.drag.offZ);
    } else {
      const dx = w.x - wp.x;
      const dz = w.z - wp.z;
      if (Math.hypot(dx, dz) > 0.05) {
        this.setHeading(wp, Math.atan2(-dz, dx));
      }
    }
    this.rebuildCurve();
    this.onChange?.();
  };

  private onUp = (e: PointerEvent) => {
    if (this.pending && e.pointerId === this.pending.id) {
      const w = this.toWorld(e.clientX, e.clientY);
      if (w) this.addWaypoint(w.x, w.z);
    }
    this.pending = null;
    this.drag = null;
    this.release(e);
  };

  private onCancel = (e: PointerEvent) => {
    this.pending = null;
    this.drag = null;
    this.release(e);
  };

  private onKey = (e: KeyboardEvent) => {
    if (!this.enabled) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      this.deleteSelected();
    } else if (e.key === "Escape") {
      this.select(null);
      this.onChange?.();
    }
  };

  private capture(e: PointerEvent) {
    e.preventDefault();
    try {
      this.dom.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  private release(e: PointerEvent) {
    try {
      this.dom.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  // ------------------------------------------------------------------
  // Waypoint management
  // ------------------------------------------------------------------

  private addWaypoint(x: number, z: number) {
    const prev = this.waypoints[this.waypoints.length - 1];
    const heading = prev ? prev.heading : this.start.heading;
    const wp = this.makeWaypoint(heading);
    this.place(wp, x, z);
    this.waypoints.push(wp);
    this.group.add(wp.group);
    this.select(wp);
    this.rebuildCurve();
    this.onChange?.();
  }

  private place(wp: Waypoint, x: number, z: number) {
    wp.x = THREE.MathUtils.clamp(x, -this.bounds.halfLength, this.bounds.halfLength);
    wp.z = THREE.MathUtils.clamp(z, -this.bounds.halfWidth, this.bounds.halfWidth);
    wp.group.position.set(wp.x, Y, wp.z);
  }

  private setHeading(wp: Waypoint, h: number) {
    wp.heading = wrapAngle(h);
    wp.arrow.rotation.y = wp.heading;
  }

  private select(wp: Waypoint | null) {
    if (this.selected) {
      this.selected.ring.visible = false;
      this.selected.handle.visible = false;
    }
    this.selected = wp;
    if (wp) {
      wp.ring.visible = true;
      wp.handle.visible = true;
    }
    this.onChange?.();
  }

  // ------------------------------------------------------------------
  // Visuals
  // ------------------------------------------------------------------

  private makeWaypoint(heading: number): Waypoint {
    const group = new THREE.Group();
    const disc = this.mesh(this.discGeo, this.bodyMat, 11);
    const ring = this.mesh(this.ringGeo, this.selMat, 11);
    ring.visible = false;

    const arrow = new THREE.Group();
    arrow.add(
      this.mesh(this.shaftGeo, this.bodyMat, 11),
      this.mesh(this.tipGeo, this.bodyMat, 11),
    );
    const handle = this.mesh(this.handleGeo, this.selMat, 12);
    handle.position.x = HANDLE_DIST;
    handle.visible = false;
    arrow.add(handle);
    arrow.rotation.y = heading;

    group.add(disc, ring, arrow);
    return { x: 0, z: 0, heading, group, ring, handle, arrow };
  }

  private rebuildCurve() {
    const s = this.getSamples();
    this.ribbon.geometry.dispose();
    if (s.length < 2) {
      this.ribbon.visible = false;
      return;
    }
    const pos = new Float32Array(s.length * 2 * 3);
    const idx: number[] = [];
    const hw = RIBBON_WIDTH / 2;
    for (let i = 0; i < s.length; i++) {
      const a = s[Math.max(i - 1, 0)]!;
      const b = s[Math.min(i + 1, s.length - 1)]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = (-dz / len) * hw;
      const nz = (dx / len) * hw;
      pos.set([s[i]!.x + nx, Y, s[i]!.z + nz], i * 6);
      pos.set([s[i]!.x - nx, Y, s[i]!.z - nz], i * 6 + 3);
      if (i < s.length - 1) {
        const k = i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    this.ribbon.geometry = g;
    this.ribbon.visible = true;
  }

  private makeTip() {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array([0.65, 0, 0, 0.42, 0, 0.12, 0.42, 0, -0.12]),
        3,
      ),
    );
    return g;
  }

  private mat(color: number) {
    return new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      depthTest: false, // always visible above obstacles
      transparent: true,
    });
  }

  private track<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }

  private mesh(g: THREE.BufferGeometry, m: THREE.Material, order: number) {
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = order;
    return mesh;
  }

  // ------------------------------------------------------------------
  // Picking helpers
  // ------------------------------------------------------------------

  private toWorld(clientX: number, clientY: number): THREE.Vector3 | null {
    const r = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.getCamera());
    return this.raycaster.ray.intersectPlane(this.plane, new THREE.Vector3());
  }

  /** Hit radius in meters: ~20px for mouse, ~32px for touch. */
  private hitRadius(e: PointerEvent) {
    const px = e.pointerType === "touch" ? 32 : 20;
    const a = this.toWorld(e.clientX, e.clientY);
    const b = this.toWorld(e.clientX + px, e.clientY);
    const r = a && b ? a.distanceTo(b) : 0.3;
    return Math.max(r, 0.25);
  }
}