/**
 * GLSL shaders for Gaussian splat rendering.
 *
 * Each splat is rendered as a GPU point (gl_PointSize) with a Gaussian
 * falloff in the fragment shader.  This gives a smooth, soft appearance
 * that approximates the 2-D projection of a 3-D Gaussian.
 *
 * Limitations of this simplified approach:
 *  - Splats are treated as spherical (isotropic) Gaussians; the full
 *    anisotropic 2-D covariance projection is not computed.
 *  - Correct alpha compositing requires back-to-front depth sorting which
 *    is performed on the CPU in GaussianCloud.js.
 */

export const splatVertexShader = /* glsl */ `
  precision mediump float;

  // Per-splat attributes (set by GaussianCloud)
  attribute float splat_scale; // world-space radius of the Gaussian
  attribute vec4  splat_color; // pre-multiplied RGBA

  // Uniforms updated every frame
  uniform float u_focal;      // focal length in pixels (height / (2 * tan(fov/2)))
  uniform float u_pixelRatio; // devicePixelRatio

  varying vec4 v_color;
  varying float v_pointSize; // forwarded to fragment for soft-edge clipping

  void main() {
    v_color = splat_color;

    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    float dist  = max(-mvPos.z, 0.001); // avoid division by zero

    // Project the world-space radius to screen-space pixels
    float screenRadius = u_focal * splat_scale / dist;
    // Multiply by 2 because gl_PointSize is the full diameter
    gl_PointSize  = max(1.0, screenRadius * 2.0) * u_pixelRatio;
    v_pointSize   = gl_PointSize;

    gl_Position = projectionMatrix * mvPos;
  }
`;

export const splatFragmentShader = /* glsl */ `
  precision mediump float;

  varying vec4  v_color;
  varying float v_pointSize;

  void main() {
    // gl_PointCoord is in [0,1]^2; map to [-1,1]^2
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(uv, uv);

    // Discard fragments outside the unit circle (makes points look round)
    if (r2 > 1.0) discard;

    // Gaussian falloff: exp(-2 * r^2) gives a smooth, natural blob
    float alpha = exp(-2.0 * r2) * v_color.a;
    if (alpha < 0.01) discard;

    gl_FragColor = vec4(v_color.rgb, alpha);
  }
`;
