# Flythrough, Hotspots & Walkthrough — Implementation Guide

This document is grounded in the current codebase. Every design decision maps
directly to the existing patterns in `src/components/splat-viewer.tsx`,
`src/lib/r2.ts`, and the `__arvritivo/` R2 metadata convention.

---

## Current State

| Area | Current behaviour |
|---|---|
| Camera | Orbit (yaw / pitch / distance around a fixed `FOCUS_POINT`) |
| Camera storage | One `{ x, y, z }` position per asset in R2 under `__arvritivo/cameras/` |
| Admin | PIN-protected POST routes save rotation and camera globally |
| Pointer input | `pointerdown/move/up`, `wheel` on the canvas — all synchronous, no `app.on("update")` loop |
| PlayCanvas systems | `Render`, `Camera`, `Light`, `Script`, `GSplat` — **no physics system** |

None of the three features (flythrough, hotspots, walkthrough) require a new
renderer dependency. All three build on what is already wired up.

---

## Feature 1 — Flythrough (Animated Camera Tour)

### Concept

A flythrough is an ordered sequence of **keyframes**. Each keyframe captures:
- A camera world position `{ x, y, z }`
- A look-at target `{ x, y, z }` (can match the current `FOCUS_POINT`, or any other point)
- A travel duration in seconds to reach this keyframe from the previous one
- An optional label shown on screen during the transition

The viewer smoothly interpolates between keyframes. A playback toolbar lets
users start, pause, and scrub the tour.

### Data Model

```ts
type FlythroughKeyframe = {
  id: string;            // stable UUID, used for reordering
  label: string;         // displayed during transition: "Entry hall"
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  durationSeconds: number; // travel time FROM previous keyframe to this one
  easingIn: "linear" | "ease-in" | "ease-out" | "ease-in-out";
};

type FlythroughDocument = {
  manifestUrl: string;
  keyframes: FlythroughKeyframe[];
  updatedAt: string;
};
```

Store per asset in R2 under the existing `__arvritivo/` namespace:
```
__arvritivo/flythrough/<sha256-of-manifestUrl>.json
```

### How the Camera Model Changes

The orbit camera (`yaw`, `pitch`, `distance`, `focus`) is fine for viewing but
is unnatural for smooth flythrough because the focus point is fixed. For
flythrough, position and look-at target are set directly each frame using linear
interpolation.

Two modes coexist:
- **Orbit mode** — existing behaviour, pointer-driven.
- **Flythrough mode** — camera position and look-at are driven by the
  `app.on("update", dt => ...)` loop. Pointer events are ignored during playback.

The `app.on("update")` handler must be added once after `app.start()` (it is
not used today). During flythrough playback it advances elapsed time, computes
the lerp factor, and calls `cameraEntity.setPosition(...)` +
`cameraEntity.lookAt(...)` directly instead of going through `frameCamera()`.

### Easing

A simple cubic ease-in-out function in pure JS (no dependency):
```ts
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}
```

Use it to map raw elapsed time `t ∈ [0, 1]` to a smooth `α`, then:
```ts
const α = easeInOut(t);
cameraEntity.setPosition(
  pc.math.lerp(fromPos.x, toPos.x, α),
  pc.math.lerp(fromPos.y, toPos.y, α),
  pc.math.lerp(fromPos.z, toPos.z, α),
);
```

### Playback UI

Add a second viewer mode that the toolbar can toggle. When in flythrough mode:
- The existing orbit toolbar buttons are hidden.
- A bottom bar shows: `⏮ Previous` · `⏸ / ▶ Pause/Play` · `⏭ Next` · `✕ Exit tour`.
- The current keyframe label is shown as an overlay (top-left, matching the
  existing `.hud` style).

### Authoring (Admin)

Inside the existing admin panel (`showAdmin`), add a **Flythrough** section:
1. **Add keyframe** — captures the current camera position and `FOCUS_POINT` as
   a new entry at the end of the list.
2. **Keyframe list** — drag-to-reorder; each row shows the label input and
   duration input.
3. **Preview** — plays back the current sequence in the viewer.
4. **Save globally** — POST to `/api/flythrough` (PIN-protected, same pattern
   as `/api/viewer-camera`).

### New API Route

`src/app/api/flythrough/route.ts` — mirrors the pattern of `viewer-camera`:
- `GET ?manifestUrl=` → returns the stored `FlythroughDocument` or `null`.
- `POST { manifestUrl, pin, keyframes }` → validates and stores.

---

## Feature 2 — Hotspots

### Concept

A hotspot is a labelled point of interest anchored to a 3D world position.
When the user clicks or taps it, a panel opens with a title, rich text, and an
optional image. This is the same pattern used in Matterport and SuperSplat.

### Data Model

```ts
type Hotspot = {
  id: string;
  label: string;          // short pin label: "2" or "Entrance"
  title: string;          // panel heading
  body: string;           // markdown or plain text
  imageUrl?: string;      // optional image shown in panel
  position: { x: number; y: number; z: number }; // world space
  linkedKeyframeId?: string; // optional: fly to this keyframe on open
};

type HotspotDocument = {
  manifestUrl: string;
  hotspots: Hotspot[];
  updatedAt: string;
};
```

Stored under `__arvritivo/hotspots/<sha256-of-manifestUrl>.json`.

### Rendering Strategy

Do **not** use PlayCanvas UI or sprites. Use a **CSS overlay** instead — a
`<div>` positioned on top of the canvas that contains one child `<div>` per
hotspot. Each frame (inside `app.on("update")`), project each hotspot's 3D
world position to 2D screen space and update the `left` / `top` CSS properties.

Projection:
```ts
// Run every frame for each hotspot
function worldToScreen(
  worldPos: pc.Vec3,
  camera: pc.CameraComponent,
  canvas: HTMLCanvasElement,
): { x: number; y: number; visible: boolean } {
  const screenPos = new pc.Vec3();
  camera.worldToScreen(worldPos, screenPos);
  return {
    x: (screenPos.x / canvas.width) * 100,   // percentage
    y: (1 - screenPos.y / canvas.height) * 100,
    visible: screenPos.z > 0,
  };
}
```

React state holds the projected 2D positions; `app.on("update")` writes to
refs and a `requestAnimationFrame` loop (or the same update callback) calls a
setter to re-render the overlay.

### Hotspot Pin Element

```tsx
// Absolutely positioned inside the overlay div
<button
  style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
  className={styles.hotspotPin}
  onClick={() => setActiveHotspot(pin.id)}
>
  {pin.label}
</button>
```

Use `pointer-events: none` on the overlay container and `pointer-events: all`
on each pin so orbit gestures pass through the transparent overlay.

### Detail Panel

A slide-up panel (mobile) or side panel (desktop) renders the active hotspot's
`title`, `body`, and `imageUrl`. Closing it sets `activeHotspot` to `null`.
If `linkedKeyframeId` is set, trigger flythrough playback to jump to that
keyframe on open.

### Authoring (Admin)

In the admin panel, add a **Hotspots** section:
1. **Place hotspot** — enters placement mode. The next pointer-down on the
   canvas raycasts against the splat scene to find the 3D hit position.
   A new hotspot is created at that position with a default label.
2. **Hotspot list** — shows each hotspot with an edit icon. Clicking opens an
   inline form for `label`, `title`, `body`, `imageUrl`, and optionally a
   flythrough keyframe link.
3. **Save globally** — POST to `/api/hotspots` (PIN-protected).

#### Raycasting Without Physics

Gaussian splats have no triangle mesh. Use the camera ray + a configurable
`floor depth` instead: when the user clicks in placement mode, cast a ray from
the camera through the click point and intersect it with the imaginary floor
plane `y = floorY` (a configurable value stored with the hotspot document).
This gives a reasonable placement for architectural walkthroughs. Record the
resulting `{ x, floorY, z }` as the hotspot world position.

### New API Route

`src/app/api/hotspots/route.ts` — same GET/POST pattern as above.

---

## Feature 3 — Walkthrough (First-Person Navigation with Colliders)

### Concept

Replace orbit navigation with first-person walking when the user activates
**Walkthrough mode**. The camera glides over the floor at a fixed eye height,
and invisible collision boxes prevent passing through walls or falling off
ledges.

SuperSplat does not implement true first-person; this would be a differentiating
feature of ARVritivoApp.

### Why Not Use PlayCanvas Physics (Ammo.js)

PlayCanvas ships a `RigidBodyComponentSystem` and `CollisionComponentSystem`,
but they require the Ammo.js WASM physics engine (~2.3 MB). For a walkthrough
confined to a finite scene, handwritten AABB intersection tests are sufficient,
faster to load, and simpler to maintain.

### Data Model — Collision Volumes

```ts
type CollisionBox = {
  id: string;
  label: string;    // authoring only, e.g. "North wall"
  // AABB in world space (after splat rotation is applied)
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
};

type NavigationDocument = {
  manifestUrl: string;
  floorY: number;           // world Y of the walkable floor
  eyeHeight: number;        // camera Y above floorY (default: 1.7 m)
  collisionBoxes: CollisionBox[];
  updatedAt: string;
};
```

Stored under `__arvritivo/navigation/<sha256-of-manifestUrl>.json`.

### First-Person Camera

When walkthrough mode is active, the orbit variables (`yaw`, `pitch`,
`distance`) are repurposed:
- `yaw` — horizontal look direction (same meaning, now drives forward vector).
- `pitch` — vertical look direction, clamped to `[-60°, 60°]`.
- `distance` — **unused** in first-person; camera sits at `(x, floorY + eyeHeight, z)`.
- Two new mutable values `camX` and `camZ` hold the floor-plane position.

This reuse means the existing `yaw`/`pitch` variables inside the `useEffect`
closure can be extended without a full refactor.

### Controls

| Input | Action |
|---|---|
| `W` / `ArrowUp` | Move forward |
| `S` / `ArrowDown` | Move backward |
| `A` / `ArrowLeft` | Strafe left |
| `D` / `ArrowRight` | Strafe right |
| Pointer drag (single touch/mouse) | Look left/right/up/down |
| Double-tap floor | Move to tapped point (mobile alternative to WASD) |

On mobile, add an on-screen D-pad overlay (four arrow buttons as `<button>`
elements) that set movement direction flags, checked each frame in the update
loop.

### Collision Response

Each frame, before applying the intended movement delta:
1. Compute the candidate new position `(nextX, floorY, nextZ)`.
2. Represent the player as a vertical capsule: a small cylinder of radius `0.3 m`.
3. For each `CollisionBox` in the navigation document, test AABB vs. cylinder:
   - Find the closest point on the box to `(nextX, nextZ)` in the XZ plane.
   - If the distance is less than `0.3`, push the candidate position out by the
     penetration vector.
4. Apply the corrected position.

This is ~30 lines of maths, no library needed.

```ts
function resolveCollision(
  px: number,
  pz: number,
  radius: number,
  box: CollisionBox,
): { x: number; z: number } {
  const closestX = Math.max(box.min.x, Math.min(px, box.max.x));
  const closestZ = Math.max(box.min.z, Math.min(pz, box.max.z));
  const dx = px - closestX;
  const dz = pz - closestZ;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist === 0 || dist >= radius) return { x: px, z: pz };
  const penetration = radius - dist;
  return {
    x: px + (dx / dist) * penetration,
    z: pz + (dz / dist) * penetration,
  };
}
```

### Mode Toggle

Add a **Walk** button to the viewer toolbar (a footsteps or person icon from
`lucide-react` — `PersonStanding` or `Footprints`). Activating it:
1. Sets a `walkMode` state variable.
2. Stops propagating pointer drag events to the orbit handler.
3. Loads the navigation document from R2 (cached after first load).
4. Positions the camera at the stored `floorY + eyeHeight` above the current
   orbit focus, facing the same yaw direction.

Deactivating walkthrough mode returns to orbit view. Camera position is
converted back to orbit parameters via the existing `orbitFromPosition()`
function.

### Authoring (Admin) — Collision Box Editor

In the admin panel, add a **Navigation** section:
1. **Set floor Y** — a number input, previewed as a horizontal line overlay.
2. **Add collision box** — enters placement mode. The user clicks two points on
   the canvas to define min/max corners. Height (Y extent) defaults to 3 m.
3. **Collision box list** — each row shows the label, a visibility toggle
   (wireframe overlay rendered in PlayCanvas), and a delete button.
4. **Save globally** — POST to `/api/navigation` (PIN-protected).

Visualising boxes: create thin `pc.Entity` + `pc.RenderComponent` meshes
(unit cube scaled to box dimensions) that are visible only in admin mode. Use a
semi-transparent additive material so they are distinguishable from the splat.

### New API Route

`src/app/api/navigation/route.ts` — GET + PIN-protected POST.

---

## Storage Summary

All three features follow the existing `__arvritivo/` R2 pattern already used
for rotation and camera presets.

| Feature | R2 key prefix | API route |
|---|---|---|
| Flythrough | `__arvritivo/flythrough/` | `/api/flythrough` |
| Hotspots | `__arvritivo/hotspots/` | `/api/hotspots` |
| Navigation / Walkthrough | `__arvritivo/navigation/` | `/api/navigation` |

Each JSON file is keyed by `sha256(manifestUrl)` — same hashing function as
`rotationObjectKey()` and `cameraObjectKey()` in `src/lib/r2.ts`.

---

## Implementation Sequence

The three features are independent and can be developed in parallel or in any
order. Recommended sequence for fastest visible impact:

| # | Task | Files |
|---|---|---|
| 1 | Add `app.on("update", dt => ...)` loop skeleton | `splat-viewer.tsx` |
| 2 | Flythrough data model + R2 helpers | `src/lib/r2.ts`, `src/app/api/flythrough/` |
| 3 | Flythrough playback engine + toolbar | `splat-viewer.tsx` |
| 4 | Flythrough admin (add/reorder/save keyframes) | `splat-viewer.tsx` |
| 5 | Hotspot data model + R2 helpers | `src/lib/r2.ts`, `src/app/api/hotspots/` |
| 6 | Hotspot CSS overlay + 2D projection loop | `splat-viewer.tsx`, new CSS module |
| 7 | Hotspot detail panel | `splat-viewer.tsx` |
| 8 | Hotspot admin (placement + edit form) | `splat-viewer.tsx` |
| 9 | Navigation data model + R2 helpers | `src/lib/r2.ts`, `src/app/api/navigation/` |
| 10 | First-person controls + AABB collision | `splat-viewer.tsx` |
| 11 | Walkthrough admin (floor Y + collision boxes) | `splat-viewer.tsx` |

Step 1 is shared by all three features and should be done first.

---

## Component Structure Recommendation

`SplatViewer` is already long (~590 lines). As each feature adds state and
handlers, extract:

```
src/components/
  splat-viewer/
    index.tsx          ← thin shell, composes the parts
    engine.ts          ← PlayCanvas init, update loop (currently inline)
    flythrough.ts      ← keyframe interpolation logic
    hotspots.tsx       ← overlay component + projection
    walkthrough.ts     ← first-person controls + collision
    admin-panel.tsx    ← all admin UI (rotation, camera, flythrough, hotspots, nav)
    viewer.module.css  ← merged CSS
```

This split keeps each concern testable in isolation and prevents the single
component from growing past ~200 lines.

---

## References

- PlayCanvas `app.on("update")` — per-frame callback, receives `dt` in seconds
- PlayCanvas `camera.worldToScreen(worldPos, screenPos)` — 3D→2D projection
- PlayCanvas `pc.math.lerp(a, b, t)` — linear interpolation
- [SuperSplat source](https://github.com/playcanvas/supersplat) — reference for
  hotspot and camera path patterns built on the same engine
- [PlayCanvas Script API](https://api.playcanvas.com/classes/Engine.Script.html)
  — alternative to inline update callbacks for larger behaviours
