# ARVritivoApp

A mobile-first web portal for publishing, streaming, and viewing
3D Gaussian splats, with a path toward placement on tracked surfaces in AR.

## Project Status

The first MVP slice is implemented:

- Next.js App Router portal with a local demo catalog
- Registration of a remote Streamed SOG `lod-meta.json` URL
- Stable, shareable viewer URLs
- PlayCanvas Engine viewer with streamed LOD loading
- Orbit, zoom, camera reset, fullscreen, and mobile splat budgets

Authentication, PostgreSQL metadata, and object-storage uploads are the next
backend milestones. The current catalog is intentionally local and contains an
official PlayCanvas sample scene.

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Use the included demo or register a public
`lod-meta.json` URL whose server permits cross-origin requests.

Validate a production build with:

```bash
npm run lint
npm run build
```

## Cloudflare R2 Integration

The app can now read published Streamed SOG manifests from Cloudflare R2 and
generate signed upload URLs from server-side API routes.

Create a local environment file:

```bash
cp .env.example .env.local
```

Set these values:

- `R2_ACCOUNT_ID`: Cloudflare account ID
- `R2_ACCESS_KEY_ID`: R2 API token access key
- `R2_SECRET_ACCESS_KEY`: R2 API token secret
- `R2_BUCKET`: bucket that stores processed SOG files
- `R2_PUBLIC_BASE_URL`: public CDN/custom-domain base URL for the bucket
- `UPLOAD_PORTAL_PIN`: PIN required to unlock direct uploads in the portal

Example `R2_PUBLIC_BASE_URL` values:

- `https://assets.example.com`
- `https://pub-<hash>.r2.dev`

When R2 is configured, the home portal tries to list `lod-meta.json` files in
the bucket. If R2 is not configured, the app falls back to the local demo asset.

### API Endpoints

- `GET /api/assets`
    - Returns asset rows sourced from R2 when available
    - Returns the local demo asset in fallback mode
    - Includes storage connection metadata

- `POST /api/uploads/sign`
    - Creates a signed `PUT` URL for direct browser/client upload to R2
    - Requires upload portal PIN auth cookie (set by `/api/uploads/auth`)
    - JSON body:
        - `objectKey`: required bucket key, for example `scene-a/lod-meta.json`
        - `contentType`: optional MIME type

Example request:

```bash
curl -X POST http://localhost:3000/api/uploads/sign \
    -H "content-type: application/json" \
    -d '{"objectKey":"scene-a/lod-meta.json","contentType":"application/json"}'
```

- `GET /api/uploads/auth`
    - Returns PIN portal status (`configured`, `authorized`)

- `POST /api/uploads/auth`
    - Accepts `{ "pin": "..." }`
    - Sets a secure httpOnly cookie used by upload signing

Allowed upload format (brief): upload one processed SOG export folder that
contains `lod-meta.json` and its generated chunk files. Do not zip it; the
browser sends the files in the folder directly.

## Core Decisions

| Area | Choice | Reason |
|---|---|---|
| Splat renderer | PlayCanvas Engine | Open-source MIT engine with Gaussian splat and WebXR support |
| Delivery format | Streamed SOG | Spatial chunks and multiple LODs allow camera-driven progressive loading |
| Source format | PLY | Preserved locally as the full-quality master asset |
| Web application | Next.js on Vercel | Portal, authentication, asset pages, and API endpoints |
| Asset storage | S3-compatible object storage | Direct processed-asset uploads and CDN delivery |
| Conversion | Local tooling | Converts PLY to Streamed SOG before upload, with no cloud compute required |
| Metadata | PostgreSQL | Tracks ownership, publishing state, transforms, and asset URLs |

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
Local workstation
    |-- keeps the original PLY as the master asset
    |-- converts PLY to Streamed SOG
    |-- verifies the generated manifest and chunks
    v
Portal or storage client
    |-- uploads the processed SOG package to object storage
    |-- creates the asset metadata record
    v
CDN -> PlayCanvas viewer -> visible LOD chunks
```

The application does not need to receive or convert PLY files. Processed files
must not pass through a Vercel serverless function; they upload directly to
object storage using signed URLs or an administrator storage client.

## MVP

1. Sign in and open the asset portal.
2. Convert a PLY master asset to Streamed SOG on the local workstation.
3. Upload the processed SOG manifest and chunks.
3.1 Confirm that the processed SOG manifest and chunks are correct format.
4. Open the published asset in a simple PlayCanvas viewer.
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
```

The exact structure will be established when the Next.js project is initialized.

## Future Automation - do not automatically implement.

An external conversion worker is optional, not required for the MVP. It should
only be added if users other than the administrator need to upload raw PLY files
or if publishing must become fully automatic. That worker would validate the
source, convert it to Streamed SOG, publish the output, and update asset status.

## Performance Principles

- Stream spatial LOD chunks instead of entire raw splat files.
- Keep local PLY masters and uploaded runtime assets separate.
- Set mobile budgets for visible splats, GPU memory, and pixel density.
- Load only camera-relevant chunks and evict distant detail.
- Serve immutable processed assets through a CDN.
- Measure time to first render, frame rate, memory, and downloaded bytes on real
    mobile devices.

## Expected Costs

PlayCanvas Engine has no runtime or per-view fee. Operational costs come from
Vercel, object storage and CDN bandwidth, and the database. Local conversion
avoids cloud conversion-worker costs for the MVP.
