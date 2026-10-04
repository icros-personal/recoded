import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <main class="game">
    <header>
      <div><h1>FRC Robot Game</h1><div class="subtitle">Prototype — Level 1: Make the shot</div></div>
      <div class="hint">Three.js + Rapier</div>
    </header>
    <div id="viewport" class="viewport" aria-label="Robot simulation"><div class="target-label">SCORE HERE</div></div>
    <section class="controls">
      <div class="control">
        <label for="power">Shot power</label>
        <input id="power" type="number" min="1" max="100" step="1" value="50" />
      </div>
      <button id="fire" type="button">FIRE!</button>
      <div id="status" class="status" aria-live="polite">Get the ball through the yellow hexagonal opening on top of the Hub.</div>
    </section>
  </main>`;

await RAPIER.init();

const viewport = document.querySelector<HTMLDivElement>('#viewport')!;
const powerInput = document.querySelector<HTMLInputElement>('#power')!;
const fireButton = document.querySelector<HTMLButtonElement>('#fire')!;
const status = document.querySelector<HTMLDivElement>('#status')!;

// --- Three.js scene -------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfd7ea);

// Orthographic camera gives us a deliberately game-like side view for Level 1.
const camera = new THREE.OrthographicCamera(-6.5, 6.5, 4.2, -4.2, 0.1, 100);
// Slightly elevated side view: still reads as a 2D game, but the player can
// clearly see the Hub's top opening.
camera.position.set(0, 4.4, 12);
camera.lookAt(0, 1.25, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
viewport.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 2.0));
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(-4, 8, 8);
sun.castShadow = true;
scene.add(sun);

// --- Visual world ---------------------------------------------------------
const floor = new THREE.Mesh(
  new THREE.BoxGeometry(13, 0.2, 5),
  new THREE.MeshStandardMaterial({ color: 0x8fa3b5 })
);
floor.position.set(0, -0.1, 0);
floor.receiveShadow = true;
scene.add(floor);

// Cartoon robot: intentionally simple for now. The important thing is that the
// shooter and the ball make the relationship between power and trajectory clear.
const robot = new THREE.Group();
const robotBody = new THREE.Mesh(
  new THREE.BoxGeometry(2.0, 1.0, 1.2),
  new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.75 })
);
robotBody.position.y = 0.55;
robotBody.castShadow = true;
robot.add(robotBody);

const shooter = new THREE.Mesh(
  new THREE.CylinderGeometry(0.13, 0.13, 1.15, 16),
  new THREE.MeshStandardMaterial({ color: 0x1e293b })
);
shooter.rotation.x = Math.PI / 2;
shooter.position.set(-0.4, 1, 0);
robot.add(shooter);

for (const x of [-0.65, 0.65]) {
  const wheel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.32, 0.22, 16),
    new THREE.MeshStandardMaterial({ color: 0x111827 })
  );
  wheel.rotation.x = Math.PI / 2;
  wheel.position.set(x, 0.32, 0.62);
  wheel.castShadow = true;
  robot.add(wheel);
}
robot.position.set(-4.0, 0, 0);
scene.add(robot);

// REBUILT-inspired cartoon Hub. The real Hub is a 47" x 47" box with a
// 41.7" hexagonal opening in the top, whose front edge is 72" above carpet.
// We model the opening explicitly so the player has an unmistakable target.
const hub = new THREE.Group();
const hubBodyMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.72 });
const hubTopMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.65 });
const hubInsideMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 });

const hubWidth = 2.0;
const hubHeight = 1.83;
const hubDepth = 2.0;
const openingRadius = 0.88; // visual approximation of the 41.7" hex opening

const hubBody = new THREE.Mesh(
  new THREE.BoxGeometry(hubWidth, hubHeight, hubDepth),
  hubBodyMat
);
hubBody.position.y = hubHeight / 2;
hubBody.castShadow = true;
hubBody.receiveShadow = true;
hub.add(hubBody);

// Cover the top visually, then put a dark hexagonal hole on top of it. The
// dark face is deliberately slightly above the red top so it reads clearly
// even with the fixed camera.
const top = new THREE.Mesh(
  new THREE.BoxGeometry(hubWidth + 0.04, 0.08, hubDepth + 0.04),
  hubTopMat
);
top.position.y = hubHeight + 0.04;
top.castShadow = true;
hub.add(top);

const hole = new THREE.Mesh(
  new THREE.CircleGeometry(openingRadius, 6),
  hubInsideMat
);
hole.rotation.x = -Math.PI / 2;
hole.position.y = hubHeight + 0.085;
hole.position.z = 0;
hub.add(hole);

// Floating target marker: this is intentionally instructional for Level 1.
const targetMarker = new THREE.Mesh(
  new THREE.RingGeometry(openingRadius * 0.82, openingRadius * 1.02, 6),
  new THREE.MeshBasicMaterial({ color: 0xfbbf24, side: THREE.DoubleSide })
);
targetMarker.rotation.x = -Math.PI / 2;
targetMarker.position.set(0, hubHeight + 0.11, 0);
hub.add(targetMarker);

hub.position.set(2.7, 0, 0);
scene.add(hub);

const ballMesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.16, 24, 16),
  new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.7 })
);
const start = new THREE.Vector3();
shooter.getWorldPosition(start);
ballMesh.position.set(start.x-0.3, start.y, start.z);
ballMesh.castShadow = true;
ballMesh.visible = true;
scene.add(ballMesh);

// --- Rapier physics -------------------------------------------------------
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

// Static floor collider.
const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.2, 0));
world.createCollider(RAPIER.ColliderDesc.cuboid(6.5, 0.1, 2.5), floorBody);

createHubColliders();

let ballBody: RAPIER.RigidBody | null = null;
let shooting = false;
let scored = false;
let previousBallY = 0;

function createHubColliders() {
  const hubX = 2.7;
  const hubZ = 0;
  const hubWidth = 2.0;
  const hubDepth = 2.0;
  const hubHeight = 1.83;

  // Four vertical sides.
  const wallThickness = 0.12;

  const walls = [
    // Front/back
    {
      x: hubX,
      y: hubHeight / 2,
      z: hubZ - hubDepth / 2,
      sx: hubWidth / 2,
      sy: hubHeight / 2,
      sz: wallThickness / 2,
    },
    {
      x: hubX,
      y: hubHeight / 2,
      z: hubZ + hubDepth / 2,
      sx: hubWidth / 2,
      sy: hubHeight / 2,
      sz: wallThickness / 2,
    },

    // Left/right
    {
      x: hubX - hubWidth / 2,
      y: hubHeight / 2,
      z: hubZ,
      sx: wallThickness / 2,
      sy: hubHeight / 2,
      sz: hubDepth / 2,
    },
    {
      x: hubX + hubWidth / 2,
      y: hubHeight / 2,
      z: hubZ,
      sx: wallThickness / 2,
      sy: hubHeight / 2,
      sz: hubDepth / 2,
    },
  ];

  for (const wall of walls) {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(
        wall.x,
        wall.y,
        wall.z
      )
    );

    world.createCollider(
      RAPIER.ColliderDesc.cuboid(
        wall.sx,
        wall.sy,
        wall.sz
      ),
      body
    );
  }
}

function createBall(power: number) {
  if (ballBody) world.removeRigidBody(ballBody);

  const start = new THREE.Vector3();
  shooter.getWorldPosition(start);
  ballBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(start.x-0.3, start.y, start.z)
      .setLinearDamping(0.05)
      .setAngularDamping(0.1)
  );
  world.createCollider(RAPIER.ColliderDesc.ball(0.16).setRestitution(0.35), ballBody);

  // Level 1 deliberately uses a simple mapping from the player's "power"
  // to initial velocity. Later levels can replace this with a motor/shooter model.
  const speed = 5.0 + Math.max(0, Math.min(100, power)) * 0.065;
  const angle = THREE.MathUtils.degToRad(39);
  ballBody.setLinvel({
    x: Math.cos(angle) * speed,
    y: Math.sin(angle) * speed,
    z: 0
  }, true);
  ballBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  shooting = true;
  scored = false;
  previousBallY = start.y;
  status.textContent = 'Watch the shot...';
  status.className = 'status';
  fireButton.textContent = 'RESET';
}

function resetShot() {
  shooting = false;
  fireButton.textContent = 'FIRE!';
  if (status.textContent === 'Watch the shot...') {
    status.textContent = 'Get the ball through the yellow hexagonal opening on top of the Hub.';
  }
  if (ballBody) {
    world.removeRigidBody(ballBody);
    ballBody = null;
  }
  shooter.getWorldPosition(start);
  ballMesh.position.set(start.x-0.3, start.y, start.z);
}

function checkScore() {
  if (!ballBody || scored) return;
  const p = ballBody.translation();

  // Level 1 treats the opening as a simple scoring plane. The real Hub has a
  // hexagonal opening; this test uses a conservative hex-like footprint.
  const hubX = 2.7;
  const dx = Math.abs(p.x - hubX);
  const dz = Math.abs(p.z);
  const r = 0.82;
  const insideHex = dx < r && dz < r * Math.sqrt(3) / 2 &&
    (Math.sqrt(3) * dx + dz) < Math.sqrt(3) * r;
  const openingY = 1.83;
  const crossedOpening = previousBallY > openingY && p.y <= openingY;

  if (crossedOpening && insideHex) {
    scored = true;
    status.textContent = '✓ Nice shot! You found the opening. Level complete.';
    status.className = 'status success';
    shooting = false;
    fireButton.disabled = false;
  }
  previousBallY = p.y;
}

function syncVisuals() {
  if (!ballBody) return;
  const p = ballBody.translation();
  ballMesh.position.set(p.x, p.y, p.z);
}

function resize() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  const aspect = w / h;
  const halfH = 4.2;
  const halfW = halfH * aspect;
  camera.left = -halfW;
  camera.right = halfW;
  camera.top = halfH;
  camera.bottom = -halfH;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
window.addEventListener('resize', resize);
resize();

fireButton.addEventListener('click', () => {
  if (fireButton.textContent === 'RESET') {
    resetShot();
  } else {
    const power = Number(powerInput.value);
    if (!Number.isFinite(power)) return;
    createBall(Math.max(1, Math.min(100, power)));
  }
});

// Physics runs at a fixed-ish timestep; rendering can run as fast as needed.
let last = performance.now();
function animate(now: number) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - last) / 1000, 0.033);
  last = now;

  if (shooting) {
    world.timestep = dt;
    world.step();
    syncVisuals();
    checkScore();
    if (ballBody) {
      const p = ballBody.translation();
      if (p.y < -1 || p.x > 8 || p.x < -7) {
        status.textContent = 'Missed. Try a different shot power.';
        status.className = 'status miss';
        resetShot();
      }
    }
  }

  renderer.render(scene, camera);
}
requestAnimationFrame(animate);
