/**
 * ARSession
 *
 * Manages the lifecycle of a WebXR immersive-ar session and optional
 * hit-test source for surface detection / splat placement.
 *
 * Browser requirements:
 *  - HTTPS (enforced via Vite's basicSsl plugin in dev)
 *  - Android Chrome 81+ or another WebXR-capable UA
 *  - iOS: WebXR is not supported in Safari; users should view the page in a
 *    WebXR Viewer or use the 3-D (non-AR) fallback mode automatically.
 */

export class ARSession {
  /**
   * @param {THREE.WebGLRenderer} renderer  Must have xr.enabled = true
   * @param {object}              [options]
   * @param {HTMLElement}         [options.domOverlay]  root element for DOM overlay
   * @param {function}            [options.onStart]     called when AR session begins
   * @param {function}            [options.onEnd]       called when AR session ends
   * @param {function}            [options.onHitTest]   called each frame with hit-test results array
   */
  constructor(renderer, { domOverlay, onStart, onEnd, onHitTest } = {}) {
    this._renderer   = renderer;
    this._domOverlay = domOverlay ?? null;
    this._onStart    = onStart ?? (() => {});
    this._onEnd      = onEnd   ?? (() => {});
    this._onHitTest  = onHitTest ?? (() => {});

    this._session            = null;
    this._hitTestSource      = null;
    this._hitTestRequested   = false;
    this._referenceSpace     = null;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Returns true if the browser supports immersive-ar WebXR sessions.
   * @returns {Promise<boolean>}
   */
  static async isSupported() {
    return Boolean(navigator.xr) &&
      navigator.xr.isSessionSupported('immersive-ar');
  }

  /** Is an AR session currently active? */
  get isActive() {
    return this._session !== null;
  }

  /**
   * Start an immersive-ar session.
   * Requests hit-test and DOM-overlay features when available.
   *
   * @returns {Promise<XRSession>}
   */
  async start() {
    if (this._session) return this._session;

    const sessionInit = {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hit-test'],
    };

    if (this._domOverlay) {
      sessionInit.optionalFeatures.push('dom-overlay');
      sessionInit.domOverlay = { root: this._domOverlay };
    }

    const session = await navigator.xr.requestSession('immersive-ar', sessionInit);
    this._session = session;

    await this._renderer.xr.setSession(session);

    session.addEventListener('end', this._handleSessionEnd.bind(this));
    this._onStart(session);

    return session;
  }

  /** End the active AR session. */
  async end() {
    if (this._session) {
      await this._session.end();
      // _handleSessionEnd will fire via the 'end' event
    }
  }

  /**
   * Process per-frame XR data.  Call this inside the render loop whenever
   * a valid XRFrame is available (i.e. when in an immersive session).
   *
   * @param {XRFrame} frame
   */
  async processFrame(frame) {
    const session = frame.session;

    // Request hit-test source once the session is established
    if (!this._hitTestRequested) {
      this._hitTestRequested = true;
      try {
        const viewerSpace = await session.requestReferenceSpace('viewer');
        this._hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
      } catch {
        // hit-test not supported on this device — silently ignore
      }
    }

    // Deliver hit-test results to the caller
    if (this._hitTestSource) {
      const results = frame.getHitTestResults(this._hitTestSource);
      this._onHitTest(results);
    }
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  _handleSessionEnd() {
    // Clean up hit-test source if present
    this._hitTestSource?.cancel();
    this._hitTestSource    = null;
    this._hitTestRequested = false;
    this._session          = null;
    this._onEnd();
  }
}
