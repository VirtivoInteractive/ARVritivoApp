/**
 * GaussianCloud
 *
 * Renders a collection of 3-D Gaussian splats using a Three.js Points object
 * with a custom ShaderMaterial (see shaders.js).
 *
 * Binary .splat layout (32 bytes per splat):
 *   Offset  Type        Field
 *   0       float32×3   position  (x, y, z)
 *   12      float32×3   scale     (sx, sy, sz)  — log-space in files from
 *                                  the original 3-DGS paper; raw floats in
 *                                  the antimatter15/splat format used here
 *   24      uint8×4     color     (R, G, B, A)
 *   28      uint8×4     rotation  (x, y, z, w)  normalised to uint8 range
 *
 * Progressive loading: call addSplats() repeatedly as chunks arrive.
 * Depth sorting:       call sortByDepth(camera) once per rendered frame for
 *                      correct back-to-front alpha compositing.
 */

import * as THREE from 'three';
import { splatVertexShader, splatFragmentShader } from './shaders.js';

const BYTES_PER_SPLAT = 32;

export class GaussianCloud {
  constructor() {
    /** @type {Float32Array} Flat position buffer [x0,y0,z0, x1,y1,z1, …] */
    this._positions = new Float32Array(0);
    /** @type {Float32Array} Per-splat scale (max of sx,sy,sz) */
    this._scales = new Float32Array(0);
    /** @type {Float32Array} Per-splat RGBA in [0,1] */
    this._colors = new Float32Array(0);

    this._splatCount = 0;
    this._sortFrameInterval = 6; // re-sort every N rendered frames
    // 6 frames (~100 ms at 60 fps) is a pragmatic balance: frequent enough
    // that depth-order artefacts are barely noticeable during camera movement,
    // while cheap enough not to stall the main thread on mid-range mobile GPUs.
    // Adjust lower (e.g. 1) for highest quality or higher for better performance.
    this._framesSinceSort = 0;

    this._geometry = new THREE.BufferGeometry();
    this._material = new THREE.ShaderMaterial({
      vertexShader: splatVertexShader,
      fragmentShader: splatFragmentShader,
      uniforms: {
        u_focal: { value: 500.0 },
        u_pixelRatio: { value: typeof window !== 'undefined' ? window.devicePixelRatio : 1 },
      },
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this._points = new THREE.Points(this._geometry, this._material);
    this._points.frustumCulled = false; // let the shader handle visibility
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** The Three.js Object3D to add to your scene. */
  get mesh() {
    return this._points;
  }

  /** Number of splats currently loaded. */
  get splatCount() {
    return this._splatCount;
  }

  /**
   * Ingest a binary chunk of splat data.
   * Partial trailing bytes (< 32) are silently ignored so that the caller can
   * pass raw network chunks without alignment bookkeeping.
   *
   * @param {ArrayBuffer} buffer
   */
  addSplats(buffer) {
    const count = Math.floor(buffer.byteLength / BYTES_PER_SPLAT);
    if (count === 0) return;

    const view = new DataView(buffer);

    const newPositions = new Float32Array(this._splatCount * 3 + count * 3);
    const newScales    = new Float32Array(this._splatCount + count);
    const newColors    = new Float32Array(this._splatCount * 4 + count * 4);

    // Copy existing data
    newPositions.set(this._positions);
    newScales.set(this._scales);
    newColors.set(this._colors);

    const base = this._splatCount;

    for (let i = 0; i < count; i++) {
      const src = i * BYTES_PER_SPLAT;

      // Position
      newPositions[(base + i) * 3]     = view.getFloat32(src,      true);
      newPositions[(base + i) * 3 + 1] = view.getFloat32(src + 4,  true);
      newPositions[(base + i) * 3 + 2] = view.getFloat32(src + 8,  true);

      // Scale — use max component so the splat is rendered at its largest extent
      const sx = view.getFloat32(src + 12, true);
      const sy = view.getFloat32(src + 16, true);
      const sz = view.getFloat32(src + 20, true);
      newScales[base + i] = Math.max(Math.abs(sx), Math.abs(sy), Math.abs(sz));

      // Color (uint8 → [0,1])
      newColors[(base + i) * 4]     = view.getUint8(src + 24) / 255;
      newColors[(base + i) * 4 + 1] = view.getUint8(src + 25) / 255;
      newColors[(base + i) * 4 + 2] = view.getUint8(src + 26) / 255;
      newColors[(base + i) * 4 + 3] = view.getUint8(src + 27) / 255;
    }

    this._positions = newPositions;
    this._scales    = newScales;
    this._colors    = newColors;
    this._splatCount += count;

    this._uploadGeometry(this._positions, this._scales, this._colors);
  }

  /** Remove all splats. */
  clear() {
    this._positions  = new Float32Array(0);
    this._scales     = new Float32Array(0);
    this._colors     = new Float32Array(0);
    this._splatCount = 0;
    this._uploadGeometry(this._positions, this._scales, this._colors);
  }

  /**
   * Update the focal-length uniform.
   * Call this whenever the camera FOV or the renderer height changes.
   *
   * @param {number} focal  pixels
   */
  setFocal(focal) {
    this._material.uniforms.u_focal.value = focal;
  }

  /**
   * Sort splats back-to-front relative to the given camera.
   * Should be called once per frame for correct alpha compositing.
   * Sorting is throttled to every `_sortFrameInterval` frames to keep the
   * CPU load manageable on mobile.
   *
   * @param {THREE.Camera} camera
   * @param {boolean} [force=false]  skip throttle and sort immediately
   */
  sortByDepth(camera, force = false) {
    if (this._splatCount < 2) return;

    this._framesSinceSort++;
    if (!force && this._framesSinceSort < this._sortFrameInterval) return;
    this._framesSinceSort = 0;

    // Build index array and compute depth for each splat in camera space
    const n      = this._splatCount;
    const pos    = this._positions;
    const m      = camera.matrixWorldInverse.elements;
    const depths = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      const x = pos[i * 3];
      const y = pos[i * 3 + 1];
      const z = pos[i * 3 + 2];
      // z-component of view-space position (no perspective divide needed for ordering)
      depths[i] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }

    // Sort indices descending by depth (most-negative z = furthest away)
    const indices = new Uint32Array(n);
    for (let i = 0; i < n; i++) indices[i] = i;
    // Use a typed-array-friendly sort
    Array.prototype.sort.call(indices, (a, b) => depths[a] - depths[b]);

    // Reorder buffers according to sorted indices
    const sortedPos    = new Float32Array(n * 3);
    const sortedScales = new Float32Array(n);
    const sortedColors = new Float32Array(n * 4);

    for (let i = 0; i < n; i++) {
      const j = indices[i];
      sortedPos[i * 3]     = pos[j * 3];
      sortedPos[i * 3 + 1] = pos[j * 3 + 1];
      sortedPos[i * 3 + 2] = pos[j * 3 + 2];
      sortedScales[i]      = this._scales[j];
      sortedColors[i * 4]     = this._colors[j * 4];
      sortedColors[i * 4 + 1] = this._colors[j * 4 + 1];
      sortedColors[i * 4 + 2] = this._colors[j * 4 + 2];
      sortedColors[i * 4 + 3] = this._colors[j * 4 + 3];
    }

    this._uploadGeometry(sortedPos, sortedScales, sortedColors);
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  /** Push typed-array data into the Three.js BufferGeometry. */
  _uploadGeometry(positions, scales, colors) {
    const geo = this._geometry;

    const setPosAttr = (arr) => {
      const attr = new THREE.Float32BufferAttribute(arr, 3);
      geo.setAttribute('position', attr);
    };
    const setScaleAttr = (arr) => {
      const attr = new THREE.Float32BufferAttribute(arr, 1);
      geo.setAttribute('splat_scale', attr);
    };
    const setColorAttr = (arr) => {
      const attr = new THREE.Float32BufferAttribute(arr, 4);
      geo.setAttribute('splat_color', attr);
    };

    // Avoid creating new BufferAttributes if the size hasn't changed
    if (
      geo.attributes.position &&
      geo.attributes.position.count === this._splatCount
    ) {
      geo.attributes.position.array.set(positions);
      geo.attributes.position.needsUpdate = true;
      geo.attributes.splat_scale.array.set(scales);
      geo.attributes.splat_scale.needsUpdate = true;
      geo.attributes.splat_color.array.set(colors);
      geo.attributes.splat_color.needsUpdate = true;
    } else {
      setPosAttr(positions);
      setScaleAttr(scales);
      setColorAttr(colors);
    }

    geo.computeBoundingSphere();
  }
}
