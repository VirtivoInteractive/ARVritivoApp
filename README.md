# ARVritivoApp

A mobile-first web portal for uploading, processing, streaming, and viewing
3D Gaussian splats, with a path toward placement on tracked surfaces in AR.

## Project Status

This repository is a fresh start. The sections below define the target
architecture and initial MVP; they do not describe completed features yet.

## Core Decisions

| Area | Choice | Reason |
|---|---|---|
| Splat renderer | PlayCanvas Engine | Open-source MIT engine with Gaussian splat and WebXR support |
| Delivery format | Streamed SOG | Spatial chunks and multiple LODs allow camera-driven progressive loading |
| Source format | PLY | Preserved as the full-quality master asset |
| Web application | Next.js on Vercel | Portal, authentication, asset pages, and API endpoints |
| Asset storage | S3-compatible object storage | Direct large-file uploads and CDN delivery |
| Conversion | External background worker | Converts PLY to Streamed SOG outside Vercel function limits |
| Metadata | PostgreSQL | Tracks ownership, processing state, transforms, and asset URLs |

PlayCanvas Engine will be installed from npm and embedded directly in the app.
The hosted PlayCanvas Editor is not required. The engine is MIT licensed and can
be used in private and commercial applications while retaining its license
notice.

## Why Streamed SOG

Downloading a `.splat`, `.ply`, or other monolithic file progressively only
reveals records in file order. It does not provide spatial, view-dependent
loading.

Streamed SOG organizes the scene into spatial chunks with multiple levels of
detail. The viewer can show a coarse scene quickly, then request visible detail
according to the camera position. This reduces startup time, bandwidth, memory
use, and mobile GPU load.

## Target Workflow

```text
Browser
    |-- requests a signed upload URL
    |-- uploads PLY directly to object storage
    v
Database: uploaded -> processing -> ready | failed
    v
Background worker
    |-- validates the source
    |-- converts PLY to Streamed SOG
    |-- writes chunks and manifest to object storage
    v
CDN -> PlayCanvas viewer -> visible LOD chunks
```

Large files must not pass through a Vercel serverless function. The browser
uploads directly to object storage using a short-lived signed URL.

## MVP

1. Sign in and open the asset portal.
2. Upload a Gaussian splat source file.
3. See upload and conversion status.
4. Open the processed asset in a simple PlayCanvas viewer.
5. Orbit, pan, zoom, reset the camera, and use fullscreen mode.
6. Share a stable viewer URL.
7. Stream coarse-to-detailed SOG chunks as they become relevant.

Complex scene editing is intentionally out of scope. This is an upload-and-view
portal, not a replacement for the PlayCanvas Editor or SuperSplat.

## AR Direction

The rendering and tracking layers remain separate. A future WebXR or native
tracking system will attach the PlayCanvas splat root entity to an AR anchor.

```text
Tracked surface, image, or marker
                            |
                    AR anchor
                            |
            Splat root transform
                            |
         Streamed SOG content
```

Each processed asset should retain:

- Real-world scale in meters
- Origin and pivot
- Coordinate system
- Initial position, rotation, and scale
- Bounding box
- Recommended mobile LOD limits

WebXR hit testing is the initial Android browser path. iOS Safari does not offer
equivalent general-purpose WebXR AR support, so reliable cross-platform AR may
later require a native ARKit/ARCore wrapper. The same stored assets and
transforms can be reused.

## Proposed Structure

```text
app/
    api/
        assets/
        uploads/
    assets/
    viewer/
components/
    portal/
    viewer/
lib/
    auth/
    db/
    storage/
    playcanvas/
workers/
    splat-converter/
```

The exact structure will be established when the Next.js project and conversion
worker are initialized.

## Performance Principles

- Stream spatial LOD chunks instead of entire raw splat files.
- Keep source uploads and runtime assets separate.
- Set mobile budgets for visible splats, GPU memory, and pixel density.
- Load only camera-relevant chunks and evict distant detail.
- Serve immutable processed assets through a CDN.
- Measure time to first render, frame rate, memory, and downloaded bytes on real
    mobile devices.

## Expected Costs

PlayCanvas Engine has no runtime or per-view fee. Operational costs come from
Vercel, object storage and CDN bandwidth, the database, and conversion workers.
