/**
 * generateDemoSplat
 *
 * Procedurally creates a binary .splat buffer containing a colourful 3-D
 * Gaussian splat cloud for demo / offline use.  The default scene produces
 * a hollow sphere of splats coloured by angular position.
 *
 * The returned ArrayBuffer matches the 32-byte-per-splat layout expected by
 * GaussianCloud.addSplats():
 *
 *   Offset  Type        Field
 *   0       float32×3   position (x, y, z)
 *   12      float32×3   scale    (sx, sy, sz)
 *   24      uint8×4     color    (R, G, B, A)
 *   28      uint8×4     rotation (x, y, z, w) — identity; unused by the shader
 *
 * @param {number} [count=20000]  Number of splats to generate
 * @param {number} [radius=0.6]  Sphere radius in world units (metres for AR)
 * @returns {ArrayBuffer}
 */
export function generateDemoSplat(count = 20000, radius = 0.6) {
  const buffer = new ArrayBuffer(count * 32);
  const view   = new DataView(buffer);

  for (let i = 0; i < count; i++) {
    const off = i * 32;

    // --- Position: uniformly distributed on the surface of a sphere ---
    // Use the Marsaglia method: rejection-sample from a cube
    let x, y, z, len;
    do {
      x = Math.random() * 2 - 1;
      y = Math.random() * 2 - 1;
      z = Math.random() * 2 - 1;
      len = x * x + y * y + z * z;
    } while (len > 1 || len === 0);

    const inv = radius / Math.sqrt(len);
    // Add a tiny amount of noise inward/outward so the sphere has thickness
    const r = radius + (Math.random() - 0.5) * 0.05;
    const px = x * inv * (r / radius);
    const py = y * inv * (r / radius);
    const pz = z * inv * (r / radius);

    view.setFloat32(off,      px, true);
    view.setFloat32(off + 4,  py, true);
    view.setFloat32(off + 8,  pz, true);

    // --- Scale: small isotropic blob ---
    const scale = 0.006 + Math.random() * 0.006;
    view.setFloat32(off + 12, scale, true);
    view.setFloat32(off + 16, scale, true);
    view.setFloat32(off + 20, scale, true);

    // --- Colour: hue from horizontal angle, lightness from vertical ---
    // Hue from the horizontal angle around the Y-axis.
    // atan2(pz, px) is safe here: the rejection-sampling loop above guarantees
    // that at least one of {px, py, pz} is non-zero, and we only use px and pz
    // — if both happen to be zero the splat sits on the Y-axis and atan2(0,0)
    // returns 0 (implementation-defined but consistent), giving a valid hue.
    const hue        = (Math.atan2(pz, px) / Math.PI + 1) * 0.5; // [0, 1]
    const lightness  = 0.45 + (py / radius) * 0.25;               // [0.2, 0.7]
    const [cr, cg, cb] = hslToRgb(hue, 0.85, lightness);

    view.setUint8(off + 24, Math.round(cr * 255));
    view.setUint8(off + 25, Math.round(cg * 255));
    view.setUint8(off + 26, Math.round(cb * 255));
    view.setUint8(off + 27, 220); // opacity

    // --- Rotation: identity quaternion (0, 0, 0, 1) encoded as uint8 ---
    view.setUint8(off + 28, 128); // x ≈ 0
    view.setUint8(off + 29, 128); // y ≈ 0
    view.setUint8(off + 30, 128); // z ≈ 0
    view.setUint8(off + 31, 255); // w ≈ 1
  }

  return buffer;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert HSL (all in [0,1]) to linear RGB (all in [0,1]).
 * @param {number} h
 * @param {number} s
 * @param {number} l
 * @returns {[number, number, number]}
 */
function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l];

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}

function hue2rgb(p, q, t) {
  const tt = ((t % 1) + 1) % 1; // normalise to [0,1]
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}
