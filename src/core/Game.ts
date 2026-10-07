import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createCamera, DEFAULT_CAMERA, fitCamera, type CameraSpec, type GameCamera } from './Camera';
import type { GameUI } from './ui';
import type { Level } from '../levels/Level';

/**
 * Runtime shared by every level: renderer, camera, lights, physics world and
 * the animation loop. A level only adds things to `stage` and `world`; when
 * the next level loads, the stage and world are thrown away and rebuilt.
 */
export class Game {
  readonly scene = new THREE.Scene();
  readonly ui: GameUI;

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
  private readonly storage: unknown[] = [];
  private level: Level | null = null;
  private last = performance.now();

  constructor(ui: GameUI) {
    this.ui = ui;
    this.camera = createCamera(DEFAULT_CAMERA, this.aspect());

    this.scene.background = new THREE.Color(0xbfd7ea);

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    ui.viewport.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 2.0));
    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.set(-4, 8, 8);
    sun.castShadow = true;
    this.scene.add(sun);

    window.addEventListener('resize', () => this.resize());
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
  }

  /** Replace the camera. Levels can call this from setup() or later (e.g. a cutscene). */
  setCamera(spec: CameraSpec) {
    this.camera = createCamera(spec, this.aspect());
  }

  start() {
    this.last = performance.now();
    requestAnimationFrame((now) => this.tick(now));
  }

  /** Advance physics. Levels call this from update() when they want the sim running. */
  stepPhysics(dt: number) {
    this.world.timestep = dt;
    this.world.step();
  }

  getStorage(index: number) {
    return this.storage[index];
  }

  setStorage(index: number, value: any) {
    this.storage[index] = value;
  }

  private aspect(): number {
    const { clientWidth: w, clientHeight: h } = this.ui.viewport;
    return w && h ? w / h : 1;
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
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.geometry.dispose();
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of materials) m.dispose();
  });
}