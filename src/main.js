/**
 * main.js — ARVritivoApp entry point
 *
 * Wires together:
 *   • Three.js WebGL renderer with WebXR enabled
 *   • GaussianCloud  — splat renderer (Three.js Points + custom shaders)
 *   • GaussianLoader — streaming / progressive .splat file loader
 *   • ARSession      — WebXR immersive-ar lifecycle + hit-testing
 *   • OrbitControls  — mouse/touch orbit for non-AR desktop preview
 *   • HTML UI        — progress bar, file picker, URL input, AR button
 *
 * Behaviour:
 *   1. On load, a procedural demo scene is generated.
 *   2. Users can open a local .splat file or type a remote URL.
 *   3. On AR-capable devices an "Enter AR" button is added automatically.
 *      Tapping a detected surface places the splat cloud in the real world.
 *   4. On devices without WebXR the app falls back to an interactive 3-D viewer.
 */

import * as THREE from 'three';
import { ARButton }      from 'three/addons/webxr/ARButton.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { GaussianCloud }     from './gaussian/GaussianCloud.js';
import { GaussianLoader }    from './gaussian/GaussianLoader.js';
import { ARSession }         from './ar/ARSession.js';
import { generateDemoSplat } from './demo/generateDemoSplat.js';

import './style.css';

// ── DOM refs ─────────────────────────────────────────────────────────────────
const canvas          = /** @type {HTMLCanvasElement} */ (document.getElementById('canvas'));
const overlay         = document.getElementById('overlay');
const statusLabel     = document.getElementById('status-label');
const progressFill    = document.getElementById('progress-fill');
const progressBar     = document.getElementById('progress-bar');
const splatCountEl    = document.getElementById('splat-count');
const arHint          = document.getElementById('ar-hint');
const arButtonContainer = document.getElementById('ar-button-container');
const fileInput       = /** @type {HTMLInputElement} */ (document.getElementById('file-input'));
const urlBtn          = document.getElementById('url-btn');
const demoBtn         = document.getElementById('demo-btn');
const urlDialog       = /** @type {HTMLDialogElement} */ (document.getElementById('url-dialog'));
const urlInput        = /** @type {HTMLInputElement} */ (document.getElementById('url-input'));
const urlOk           = document.getElementById('url-ok');
const urlCancel       = document.getElementById('url-cancel');

// ── Three.js core ─────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.setClearColor(0x000000, 0); // transparent background for AR overlay

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(0, 0, 2); // start 2 m back from origin for desktop preview

// ── Orbit controls (non-AR preview) ──────────────────────────────────────────
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.target.set(0, 0, 0);

// ── Gaussian splat cloud ──────────────────────────────────────────────────────
const cloud = new GaussianCloud();
cloud.mesh.position.set(0, 0, 0);
scene.add(cloud.mesh);

// ── AR reticle (ring shown on detected surfaces) ──────────────────────────────
const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.06, 0.08, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x00ff88, side: THREE.DoubleSide })
);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

// ── Active loader (kept so we can abort it if a new load starts) ──────────────
let activeLoader = null;

// ── AR session ────────────────────────────────────────────────────────────────
let splatPlaced = false;

const arSession = new ARSession(renderer, {
  domOverlay: overlay,
  onStart() {
    overlay.classList.add('ar-active');
    controls.enabled = false;
    cloud.mesh.visible = false; // hidden until placed on a surface
    reticle.visible = false;
    splatPlaced = false;
    setStatus('Point at a flat surface…');
  },
  onEnd() {
    overlay.classList.remove('ar-active');
    controls.enabled = true;
    cloud.mesh.visible = true;
    cloud.mesh.position.set(0, 0, 0);
    cloud.mesh.quaternion.identity();
    cloud.mesh.scale.setScalar(1);
    reticle.visible = false;
    splatPlaced = false;
    setStatus('Ready');
  },
  onHitTest(results) {
    if (results.length > 0) {
      const pose = results[0].getPose(renderer.xr.getReferenceSpace());
      reticle.visible = true;
      reticle.matrix.fromArray(pose.transform.matrix);
      if (!splatPlaced) arHint.hidden = false;
    } else {
      reticle.visible = false;
      arHint.hidden = true;
    }
  },
});

// ── AR button ─────────────────────────────────────────────────────────────────
ARSession.isSupported().then((supported) => {
  if (supported) {
    // Use Three.js's built-in ARButton which handles the session toggle UX.
    // We pass a custom onClick so that our ARSession manages the session state.
    const btn = ARButton.createButton(renderer, {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hit-test', 'dom-overlay'],
      domOverlay: { root: overlay },
    });
    // Override the button's built-in toggle to go through our ARSession
    btn.addEventListener('click', async (e) => {
      e.stopImmediatePropagation(); // prevent Three.js's built-in handler
      if (!arSession.isActive) {
        try {
          await arSession.start();
        } catch (err) {
          setStatus(`AR error: ${err.message}`);
        }
      } else {
        await arSession.end();
      }
    }, true /* capture — fires before Three.js listener */);
    arButtonContainer.appendChild(btn);
  } else {
    const hint = document.createElement('span');
    hint.style.cssText = 'font-size:0.75rem;color:var(--text-muted);padding:8px 0;';
    hint.textContent = 'AR not available on this device';
    arButtonContainer.appendChild(hint);
  }
});

// ── Tap to place / reset (AR mode) ───────────────────────────────────────────
// A single handler covers both "place" and "reset" actions to keep the event
// ordering predictable.
renderer.domElement.addEventListener('click', () => {
  if (!arSession.isActive) return;

  if (!splatPlaced) {
    // First tap: place the cloud on the detected surface
    if (!reticle.visible) return;

    const position   = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale      = new THREE.Vector3();
    reticle.matrix.decompose(position, quaternion, scale);

    cloud.mesh.position.copy(position);
    cloud.mesh.quaternion.copy(quaternion);
    // Scale so the ~1 m demo sphere feels natural inside a room
    cloud.mesh.scale.setScalar(0.5);
    cloud.mesh.visible = true;
    reticle.visible = false;
    arHint.hidden = true;
    splatPlaced = true;
    setStatus('Placed! Tap to reset.');
  } else {
    // Second tap: reset so the user can reposition
    splatPlaced = false;
    cloud.mesh.visible = false;
    reticle.visible = false;
    setStatus('Point at a flat surface…');
  }
});

// ── File input ────────────────────────────────────────────────────────────────
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  fileInput.value = ''; // reset so the same file can be re-opened
  loadFromFile(file);
});

// ── URL dialog ────────────────────────────────────────────────────────────────
urlBtn.addEventListener('click', () => urlDialog.showModal());
urlCancel.addEventListener('click', () => urlDialog.close());
urlDialog.addEventListener('close', () => {
  const url = urlInput.value.trim();
  if (url) loadFromURL(url);
  urlInput.value = '';
});
// Also support explicit "Load" button (form submit closes the dialog)
urlOk.addEventListener('click', () => {
  if (urlInput.value.trim()) urlDialog.close();
});

// ── Demo button ───────────────────────────────────────────────────────────────
demoBtn.addEventListener('click', () => loadDemo());

// ── URL query-string shortcut: ?splat=https://… ───────────────────────────────
const queryURL = new URLSearchParams(location.search).get('splat');
if (queryURL) {
  loadFromURL(queryURL);
} else {
  // Load demo scene on start
  loadDemo();
}

// ── Resize ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Render loop ───────────────────────────────────────────────────────────────
renderer.setAnimationLoop((_, frame) => {
  // Process AR hit-test results when in an active XR session
  if (frame && arSession.isActive) {
    arSession.processFrame(frame);
  }

  // Update orbit controls damping (disabled in AR)
  if (!arSession.isActive) {
    controls.update();
  }

  // Update focal-length uniform from current camera FOV
  const fovRad = (camera.fov * Math.PI) / 180;
  const focal  = (renderer.domElement.height / 2) / Math.tan(fovRad / 2);
  cloud.setFocal(focal);

  // Depth-sort splats relative to camera for correct alpha compositing
  cloud.sortByDepth(camera);

  renderer.render(scene, camera);
});

// ── Loader helpers ────────────────────────────────────────────────────────────

function loadDemo() {
  abortActive();
  cloud.clear();
  setStatus('Generating demo…');
  setProgress(0);

  // Run in a microtask so the UI can repaint first
  setTimeout(() => {
    const buffer = generateDemoSplat(20000, 0.6);
    cloud.addSplats(buffer);
    updateCount();
    setProgress(1);
    setStatus('Demo scene — 20 k splats');
  }, 0);
}

async function loadFromURL(url) {
  abortActive();
  cloud.clear();
  setStatus('Connecting…');
  setProgress(0);

  const loader = new GaussianLoader({
    onProgress: (p) => { setProgress(p); updateCount(); },
    onChunk:    (buf) => { cloud.addSplats(buf); updateCount(); },
    onDone:     () => { setStatus(`Loaded — ${fmt(cloud.splatCount)} splats`); setProgress(1); },
    onError:    (e) => { setStatus(`Error: ${e.message}`); setProgress(0); },
  });

  activeLoader = loader;
  await loader.load(url);
}

function loadFromFile(file) {
  setStatus(`Reading ${file.name}…`);
  setProgress(0);

  const reader = new FileReader();
  reader.onload = (e) => {
    cloud.clear();
    cloud.addSplats(e.target.result);
    updateCount();
    setProgress(1);
    setStatus(`${file.name} — ${fmt(cloud.splatCount)} splats`);
  };
  reader.onerror = () => setStatus('Error reading file');
  reader.readAsArrayBuffer(file);
}

function abortActive() {
  activeLoader?.abort();
  activeLoader = null;
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function setStatus(text) {
  statusLabel.textContent = text;
}

function setProgress(ratio) {
  const pct = Math.round(ratio * 100);
  progressFill.style.width = `${pct}%`;
  progressBar.setAttribute('aria-valuenow', String(pct));
}

function updateCount() {
  splatCountEl.textContent = `${fmt(cloud.splatCount)} splats`;
}

function fmt(n) {
  return n.toLocaleString();
}
