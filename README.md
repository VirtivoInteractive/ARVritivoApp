# ARVritivoApp

A mobile-first **augmented reality web app** for real-time visualisation of
3-D Gaussian splattings, with support for both **instant** and **progressive**
(streaming) loading of `.splat` files.

## Features

| Feature | Details |
|---|---|
| **Gaussian Splatting Renderer** | Custom WebGL shader renders each splat as a depth-sorted Gaussian blob |
| **Progressive Loading** | Streams `.splat` files over HTTP; new splats appear incrementally as the download progresses |
| **Instant Loading** | Open a local `.splat` file directly from device storage — no upload required |
| **WebXR AR** | On Android Chrome 81+ the splat cloud can be placed on a real-world surface detected via hit-testing |
| **3-D Fallback** | On devices without WebXR support the app falls back to an interactive orbit viewer |
| **Demo Scene** | A procedurally generated colourful sphere of 20 000 splats loads automatically on start |
| **URL Param** | Pass `?splat=<url>` to auto-load a specific splat on page load |

## Quick Start

```bash
# Install dependencies
npm install

# Start the dev server with HTTPS (required for WebXR)
npm run dev
```

> **Why HTTPS?**  WebXR and camera access require a secure origin.  The dev
> server uses a self-signed certificate (`@vitejs/plugin-basic-ssl`).  Accept
> the browser's certificate warning once, then access the app from your mobile
> device using the LAN IP shown in the terminal (e.g. `https://192.168.x.x:5173`).

## Loading Splats

### Local file
Click **📂 Open .splat** and pick any `.splat` binary from your device.

### Remote URL
Click **🌐 Load URL** and paste a publicly accessible `.splat` URL.
CORS headers must allow the request from your origin.

### URL query parameter
```
https://<host>:5173/?splat=https://example.com/my_scene.splat
```

## Building for Production

```bash
npm run build    # output in dist/
npm run preview  # preview the production build locally
```

## Project Structure

```
├── index.html                   App shell (mobile-optimised)
├── vite.config.js               Vite + HTTPS config
├── package.json
└── src/
    ├── main.js                  Entry point — wires all modules together
    ├── style.css                Dark, mobile-first UI styles
    ├── gaussian/
    │   ├── shaders.js           GLSL vertex + fragment shaders
    │   ├── GaussianCloud.js     Three.js Points-based splat renderer
    │   └── GaussianLoader.js    Streaming fetch-based progressive loader
    ├── ar/
    │   └── ARSession.js         WebXR AR session lifecycle + hit-testing
    └── demo/
        └── generateDemoSplat.js Procedural demo scene generator
```

## Splat Format

The app loads the standard **antimatter15/splat** binary format:

| Offset | Type | Field |
|---|---|---|
| 0 | `float32 × 3` | position (x, y, z) |
| 12 | `float32 × 3` | scale (sx, sy, sz) |
| 24 | `uint8 × 4` | colour (R, G, B, A) |
| 28 | `uint8 × 4` | rotation quaternion (x, y, z, w) |

**32 bytes per splat** — any `.splat` file created by tools such as
[antimatter15/splat](https://github.com/antimatter15/splat) or
[mkkellogg/GaussianSplats3D](https://github.com/mkkellogg/GaussianSplats3D)
is compatible.

## Device Support

| Platform | Status |
|---|---|
| Android Chrome 81+ | ✅ Full AR via WebXR |
| iOS Safari | ⚠️ 3-D viewer only (WebXR AR not supported in Safari) |
| Desktop Chrome / Firefox | ✅ 3-D viewer with orbit controls |

## Tech Stack

- [Three.js](https://threejs.org/) r166 — WebGL renderer, WebXR integration, OrbitControls
- [Vite](https://vitejs.dev/) 5 — build tool and dev server
- Custom GLSL shaders — Gaussian point rendering with depth sort
- Fetch Streams API — progressive file loading
