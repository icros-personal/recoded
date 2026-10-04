# FRC Robot Game — prototype

A local browser prototype for a game-like introduction to FRC robot programming.

## Stack

- Vite + TypeScript
- Three.js for rendering
- Rapier 3D for physics/collisions

The project intentionally uses a real 3D physics world even though Level 1 presents a fixed side-on view. That should let later levels add robot movement and a more 3D camera without replacing the physics layer.

## Run locally

Install a recent Node.js LTS release, then from this directory:

```bash
npm install
npm run dev
```

Vite will print a local URL, normally something like `http://localhost:5173/`.

For a production build:

```bash
npm run build
npm run preview
```

## Current prototype

Level 1 contains:

- a cartoon robot
- a simplified Hub-like target
- a ball with a Rapier rigid body and sphere collider
- a floor collider
- a shot-power input
- a FIRE button
- a fixed side-view orthographic camera
- a simple score-volume check

The power-to-velocity relationship is intentionally crude. The next useful step is to make the shot visually satisfying and tune the geometry/power curve before adding any real programming interface.
