import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  createCamera,
  DEFAULT_CAMERA,
  fitCamera,
  type CameraSpec,
  type GameCamera,
} from "./Camera";
import type { GameUI } from "./ui";
import type { Level } from "../levels/Level";
import { InterpolationTable } from "./InterpolationTable";
import { SettingsModal } from "../ui/SettingsModal";
import { Achievements } from "../ui/Achievements";

/**
 * Runtime shared by every level: renderer, camera, lights, physics world and
 * the animation loop. A level only adds things to `stage` and `world`; when
 * the next level loads, the stage and world are thrown away and rebuilt.
 */
export class Game {
  static readonly STORAGE_KEY = 'frc_sim_storage_v1';

  private accumulator = 0;
  private readonly PHYSICS_TIMESTEP = 1 / 60;
  readonly scene = new THREE.Scene();
  readonly ui: GameUI;
  readonly settingsModal: SettingsModal;
  readonly achievements: Achievements;

  /**
   * The active camera. It is replaced on every level load (and by setCamera),
   * so read `game.camera` each time rather than caching it.
   */
  camera: GameCamera;
  /** Per-level scene content. Add meshes here, not directly to `scene`. */
  stage = new THREE.Group();
  /** Per-level physics world. Recreated on every loadLevel. */
  world!: RAPIER.World;

  readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private storage: Record<string, unknown> = this.loadStorage();
  private rpmTable?: InterpolationTable;
  private kp?: number;
  private level: Level | null = null;
  private last = performance.now();

  constructor(ui: GameUI) {
    this.ui = ui;
    this.ui.onSettings((achievements: boolean) => this.settingsModal.show(achievements));
    this.camera = createCamera(DEFAULT_CAMERA, this.aspect());
    this.settingsModal = new SettingsModal(this);
    this.achievements = new Achievements();

    this.scene.background = new THREE.Color(0xbfd7ea);

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    ui.viewport.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 2.0));
    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.set(-8, 8, 8);
    sun.castShadow = true;
    this.scene.add(sun);

    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  loadLevel(level: Level) {
    this.unloadLevel();

    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.stage = new THREE.Group();
    this.scene.add(this.stage);
    this.setCamera(level.camera ?? DEFAULT_CAMERA);

    this.level = level;
    this.ui.showLevel(level.info, level.controls);
    this.ui.onAction(() => level.onAction());
    level.setup(this);
    this.settingsModal.load(level);
  }

  getRpmTable(): InterpolationTable {
    if (!this.rpmTable) {
      this.rpmTable = InterpolationTable.fromStorage(this.getStorage('rpmTable'));
    }
    return this.rpmTable;
  }

  initializeRpmTableIfEmpty(defaults: [number, number][]): void {
    const table = this.getRpmTable();
    if (table.values().size === 0) {
      for (const [key, value] of defaults) {
        table.set(key, value);
      }
    }
    this.saveRpmTable();
  }

  saveRpmTable(): void {
    this.setStorage('rpmTable', this.getRpmTable().toStorage());
  }

  getKp() {
    if (this.kp === undefined) {
      const storageValue = this.getStorage('kp');
      if (typeof storageValue === 'number') {
        this.kp = storageValue;
      } else {
        this.setKp(0.6);
      }
    }
    return this.kp as number;
  }

  setKp(kp: number) {
    this.kp = kp;
    this.setStorage('kp', this.kp);
  }

  /** Replace the camera. Levels can call this from setup() or later (e.g. a cutscene). */
  setCamera(spec: CameraSpec) {
    this.camera = createCamera(spec, this.aspect());
  }

  start() {
    this.last = performance.now();
    requestAnimationFrame((now) => this.tick(now));
  }

  getStorage(key: string): unknown {
    return this.storage[key];
  }

  setStorage(key: string, value: unknown): void {
    this.storage[key] = value;
    this.saveStorage();
  }

  // Inside Game.ts (conceptual)
  private loadStorage() {
    try {
      const raw = localStorage.getItem(Game.STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.warn("Failed to load storage", e);
    }
    return {};
  }

  private saveStorage() {
    try {
      localStorage.setItem(Game.STORAGE_KEY, JSON.stringify(this.storage));
    } catch (e) {
      console.warn("Failed to save storage", e);
    }
  }

  clearStorage() {
    this.storage = {};
    localStorage.removeItem(Game.STORAGE_KEY);
  }

  private aspect(): number {
    const { clientWidth: w, clientHeight: h } = this.ui.viewport;
    return w && h ? w / h : 1;
  }

  reload() {
    const level = this.level;
    if (level) {
      this.loadLevel(level);
    }
  }

  private unloadLevel() {
    this.level?.dispose?.();
    this.level = null;
    this.ui.onAction(null);
    this.ui.clearLevelContainer();

    this.scene.remove(this.stage);
    disposeObject(this.stage);
    this.world?.free();
  }

  private resize() {
    const w = this.ui.viewport.clientWidth;
    const h = this.ui.viewport.clientHeight;
    if (!w || !h) return;
    fitCamera(this.camera, w / h);
    this.renderer.setSize(w, h, false);
  }

  private tick(now: number) {
    requestAnimationFrame((t) => this.tick(t));
    const dt = Math.min((now - this.last) / 1000, 0.033);
    this.last = now;

    this.level?.update?.(dt);
    this.renderer.render(this.scene, this.camera);
  }

  stepPhysics(dt: number) {
    // Accumulate frame time and step in fixed chunks
    this.accumulator += dt;
    this.world.timestep = this.PHYSICS_TIMESTEP;

    while (this.accumulator >= this.PHYSICS_TIMESTEP) {
      this.world.step();
      this.accumulator -= this.PHYSICS_TIMESTEP;
    }
  }
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.geometry.dispose();
    const materials = Array.isArray(obj.material)
      ? obj.material
      : [obj.material];
    for (const m of materials) m.dispose();
  });
}
