import * as THREE from 'three';

export type Vec3Tuple = [x: number, y: number, z: number];

export interface OrthographicCameraSpec {
  type: 'orthographic';
  position: Vec3Tuple;
  /** World-space point the camera looks at (and that ends up centered). */
  target: Vec3Tuple;
  /** Half of the visible height, in meters. Width follows the viewport aspect. */
  halfHeight: number;
}

export interface PerspectiveCameraSpec {
  type: 'perspective';
  position: Vec3Tuple;
  /** World-space point the camera looks at (and that ends up centered). */
  target: Vec3Tuple;
  /** Vertical field of view, in degrees. */
  fov: number;
}

export type CameraSpec = OrthographicCameraSpec | PerspectiveCameraSpec;
export type GameCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

/** Used by any level that doesn't declare its own camera. */
export const DEFAULT_CAMERA: CameraSpec = {
  type: 'orthographic',
  position: [0, 4.4, 12],
  target: [0, 1.25, 0],
  halfHeight: 4.2,
};

export function createCamera(spec: CameraSpec, aspect: number): GameCamera {
  let camera: GameCamera;
  if (spec.type === 'orthographic') {
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    camera.userData.halfHeight = spec.halfHeight;
  } else {
    camera = new THREE.PerspectiveCamera(spec.fov, aspect, 0.1, 100);
  }
  camera.position.set(...spec.position);
  camera.lookAt(...spec.target); // set position first, then aim
  fitCamera(camera, aspect);
  return camera;
}

/** Update the projection after the viewport size/aspect changes. */
export function fitCamera(camera: GameCamera, aspect: number) {
  if (camera instanceof THREE.OrthographicCamera) {
    const halfH = camera.userData.halfHeight as number;
    const halfW = halfH * aspect;
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
  } else {
    camera.aspect = aspect;
  }
  camera.updateProjectionMatrix();
}