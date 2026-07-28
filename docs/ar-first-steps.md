# AR First Steps — Implementation Guide

This document evaluates the current state of ARVritivoApp and defines the
concrete first steps required to add true AR — placing a Gaussian splat on a
real-world surface detected by the device camera.

---

## Current State

| Area | Status |
|---|---|
| Renderer | PlayCanvas Engine 2.21.1, running on WebGPU/WebGL2 |
| Splat format | Streamed SOG via `GSplatComponent` / `GSplatHandler` |
| Camera | Orbit camera driven by pointer and touch events, no XR session |
| Transport | Cloudflare R2, signed upload URLs, CDN delivery |
| AR code | **None.** No WebXR session, no hit-testing, no anchor, no AR button |
| iOS | No ARKit/WebXR support in iOS Safari for general AR |

The app is a pure web viewer today. PlayCanvas Engine ships with a built-in
`XrManager` (`app.xr`), so the renderer is already AR-capable — it is only a
matter of wiring up the XR session and connecting the splat entity to it.

---

## Platform Reality Check

### Android Chrome (and Samsung Internet)
WebXR Device API with `hit-test` and `anchors` optional features is fully
supported. This is the primary target for web-based AR.

### iOS Safari
Does not support immersive WebXR sessions. The options are:
- **Quick Look** — Apple's ARKit viewer for USDZ files (no live splat streaming).
- **React Native / Capacitor wrapper** — embed the PlayCanvas canvas inside a
  native shell that provides ARKit tracking via a bridge.
- **Wait** — Apple has shipped partial WebXR (viewer mode only) and may
  eventually enable `immersive-ar`.

**Recommendation:** Ship Android WebXR first. Document the iOS gap to users.
Reserve the native wrapper for a later milestone.

---

## Step 1 — HTTPS and Permissions Policy

WebXR requires a secure context. The dev server already uses HTTPS
(`npm run dev`). For production (Vercel), HTTPS is automatic.

Add the `Permissions-Policy` header so browsers don't block XR access. In
`next.config.ts`:

```ts
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Permissions-Policy",
            value: "xr-spatial-tracking=*, camera=*",
          },
        ],
      },
    ];
  },
  turbopack: { root: path.resolve(__dirname) },
};
```

---

## Step 2 — Detect WebXR Support at Runtime

Before showing an AR button, check that the device and browser support
`immersive-ar`. Add a helper to `src/lib/webxr.ts`:

```ts
export async function isArSupported(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.xr) return false;
  return navigator.xr.isSessionSupported("immersive-ar");
}
```

Call this inside a `useEffect` in `SplatViewer` (or a dedicated AR hook) and
conditionally render the AR entry button only when the result is `true`.

---

## Step 3 — Add an AR Entry Button to `SplatViewer`

`SplatViewer` already holds the PlayCanvas `app` instance. The AR session must
be started from within the same component that owns the PlayCanvas app because
`app.xr` needs to reference the active `Application`.

The button should:
1. Appear only when `isArSupported()` resolves to `true`.
2. Trigger `app.xr.start("immersive-ar", pc.XRTYPE_AR, pc.XRSPACE_LOCALFLOOR, { ... })`.
3. Change label to "Exit AR" while a session is active and call `app.xr.end()`
   on tap.

Place the button in the existing controls row (the `<footer>` toolbar already
in `splat-viewer.tsx`) so it follows the established UI pattern.

---

## Step 4 — Start the WebXR Session via PlayCanvas XrManager

Inside the PlayCanvas initialization block (currently around line 131 of
`splat-viewer.tsx`, after `app.start()`), configure the XR manager and
expose session control refs to the button handler.

```ts
// After app.start():
app.xr.on("start", () => {
  // Switch camera to XR — PlayCanvas handles the pose automatically
  // once the camera entity is the active XR camera.
  cameraEntity.camera!.clearColor = new pc.Color(0, 0, 0, 0); // transparent
});

app.xr.on("end", () => {
  cameraEntity.camera!.clearColor = new pc.Color(0.055, 0.063, 0.058);
});
```

To start the session from the button ref:

```ts
const startAr = () =>
  app.xr.start(cameraEntity, "immersive-ar", pc.XRSPACE_LOCALFLOOR, {
    optionalFeatures: ["hit-test", "anchors"],
  });
```

PlayCanvas automatically assigns the WebXR camera pose to `cameraEntity` once
the session is running, so the orbit camera and pointer listeners should be
suspended during an active AR session (gate them on `!app.xr.active`).

---

## Step 5 — Hit Testing for Surface Placement

When `hit-test` is available, PlayCanvas exposes `app.xr.hitTest`. Use it to
cast a ray from screen centre and find real-world surfaces.

```ts
let hitTestSource: pc.XrHitTestSource | null = null;

app.xr.hitTest.on("add", (source: pc.XrHitTestSource) => {
  hitTestSource = source;
});

// In the per-frame update (app.on("update", ...)):
if (hitTestSource) {
  const results = hitTestSource.getHitTestResults();
  if (results.length > 0) {
    const pose = results[0];
    reticleMesh.setPosition(pose.getPosition());
    reticleMesh.setRotation(pose.getRotation());
    reticleMesh.enabled = true;
  }
}
```

The reticle is a thin ring mesh that indicates where the splat will be placed.
It gives the user visual feedback before confirming placement.

---

## Step 6 — Place the Splat on a Surface (Tap to Place)

When the user taps the screen during AR, move the splat root entity to the last
hit-test position and lock it there.

```ts
let splatPlaced = false;

canvas.addEventListener("click", () => {
  if (!app.xr.active || !hitTestSource || splatPlaced) return;
  const results = hitTestSource.getHitTestResults();
  if (results.length === 0) return;

  const pose = results[0];
  splat.setPosition(pose.getPosition());
  splat.setRotation(pose.getRotation());
  // Apply the stored Euler offset so the asset keeps its orientation preset
  splat.setLocalEulerAngles(rotationRef.current.x, rotationRef.current.y, rotationRef.current.z);
  splatPlaced = true;
  reticleMesh.enabled = false;
});
```

A second tap could allow repositioning, or a dedicated "Move" button can reset
`splatPlaced = false`.

---

## Step 7 — Preserve Asset Metadata for AR Scale

Each asset currently stores only the `lod-meta.json` URL. To render at the
correct real-world size, each asset needs:

| Field | Description |
|---|---|
| `metersPerUnit` | Scale factor from splat coordinate space to metres |
| `pivot` | World-space origin of the splat (the point that lands on the AR anchor) |
| `initialEuler` | Default orientation Euler angles already saved per-asset in R2 |
| `boundingRadius` | Radius in metres, used to cap mobile LOD budget |

The `SplatAsset` type in `src/lib/assets.ts` should gain optional `arMeta`
fields. These can be stored as a sidecar JSON key inside the existing R2
metadata or in the future PostgreSQL row.

For the MVP, the global rotation preset already stored in R2
(`viewer-rotation` and `viewer-camera` endpoints) serves as the orientation
override and is already applied to the splat entity today. No schema change is
required for the first AR prototype.

---

## Step 8 — iOS Fallback UX

While iOS Safari cannot run `immersive-ar`, you can still let iOS users
experience the asset spatially:

- **USDZ export**: Convert the Gaussian splat to a USDZ point cloud or mesh
  approximation and offer a "View in AR" Quick Look link.
- **Detect iOS**: `navigator.userAgent` check, or feature-detect absence of
  `navigator.xr`. Show the Quick Look link instead of the WebXR button.
- **Defer**: Show a "AR not supported on this browser" message with a link to
  open on Android Chrome.

---

## Step 9 — Cleanup and Lifecycle

When the XR session ends (user presses the hardware back button or the browser
terminates the session), `app.xr` emits `"end"`. The viewer must:
- Re-enable the orbit camera controls.
- Restore the clear colour.
- Reset `splatPlaced` and `hitTestSource`.
- Optionally, restore `splat.setPosition(0, 0, 0)` so the asset is centred in
  the non-AR orbit view again.

---

## Implementation Sequence (Prioritised)

| # | Task | Files affected |
|---|---|---|
| 1 | Add `Permissions-Policy` header | `next.config.ts` |
| 2 | `isArSupported()` utility | `src/lib/webxr.ts` (new) |
| 3 | AR button in viewer toolbar | `src/components/splat-viewer.tsx` |
| 4 | XrManager session start/end | `src/components/splat-viewer.tsx` |
| 5 | Reticle mesh + hit-test loop | `src/components/splat-viewer.tsx` |
| 6 | Tap-to-place logic | `src/components/splat-viewer.tsx` |
| 7 | iOS fallback message | `src/components/splat-viewer.tsx` |
| 8 | `arMeta` fields on `SplatAsset` | `src/lib/assets.ts`, R2 metadata |

Steps 1–4 can be implemented in a single PR and tested on Android Chrome with
no backend changes. Steps 5–6 require device testing — the hit-test API only
functions inside a real WebXR session on hardware. Steps 7–8 are polish and can
follow.

---

## Key PlayCanvas APIs

| API | Purpose |
|---|---|
| `app.xr` | `XrManager` — session lifecycle and feature access |
| `app.xr.start(camera, type, space, opts)` | Begin an immersive session |
| `app.xr.end()` | End the active session |
| `app.xr.active` | Boolean — true while a session is running |
| `app.xr.hitTest` | `XrHitTest` manager — request and read hit-test results |
| `app.xr.anchors` | `XrAnchors` manager — create persistent world anchors |
| `pc.XRTYPE_AR` | Session type constant for `immersive-ar` |
| `pc.XRSPACE_LOCALFLOOR` | Reference space with floor origin |

PlayCanvas handles WebXR pose injection automatically when `app.xr.start` is
called with the active camera entity. No manual WebXR session setup is needed.

---

## References

- [PlayCanvas XrManager API](https://api.playcanvas.com/classes/Engine.XrManager.html)
- [PlayCanvas WebXR tutorial](https://developer.playcanvas.com/tutorials/webxr-ar-hit-test/)
- [WebXR Device API spec](https://www.w3.org/TR/webxr/)
- [WebXR hit-test spec](https://www.w3.org/TR/webxr-hit-test-1/)
- [MDN WebXR guide](https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API)
