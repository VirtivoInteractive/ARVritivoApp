"use client";

import {
  Expand,
  LoaderCircle,
  Lock,
  RotateCcw,
  Settings2,
  TriangleAlert,
  Unlock,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import styles from "./splat-viewer.module.css";

type ViewerStatus = "loading-engine" | "loading-scene" | "ready" | "error";

type Rotation = {
  x: number;
  y: number;
  z: number;
};

type CameraPosition = {
  x: number;
  y: number;
  z: number;
};

const DEFAULT_ROTATION: Rotation = { x: -90, y: 0, z: 0 };
const DEFAULT_CAMERA: CameraPosition = { x: 0.18, y: -3.81, z: 13.5 };
const FOCUS_POINT = { x: 18, y: -1.3, z: 13.5 };

function clampRotationValue(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(-360, Math.min(360, value));
}

function clampCameraValue(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(-10_000, Math.min(10_000, value));
}

function orbitFromPosition(position: CameraPosition) {
  const dx = position.x - FOCUS_POINT.x;
  const dy = position.y - FOCUS_POINT.y;
  const dz = position.z - FOCUS_POINT.z;
  const distance = Math.max(0.5, Math.sqrt(dx * dx + dy * dy + dz * dz));
  const pitch = Math.asin(Math.max(-1, Math.min(1, dy / distance))) * 180 / Math.PI;
  const yaw = Math.atan2(dx, dz) * 180 / Math.PI;

  return {
    yaw,
    pitch,
    distance,
  };
}

type SplatViewerProps = {
  manifestUrl: string;
  initialRotation: Rotation | null;
  initialCamera: CameraPosition | null;
};

export function SplatViewer({ manifestUrl, initialRotation, initialCamera }: SplatViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<(() => void) | null>(null);
  const zoomRef = useRef<((factor: number) => void) | null>(null);
  const cameraPositionRef = useRef<((position: CameraPosition) => void) | null>(null);
  const splatRef = useRef<{ setLocalEulerAngles: (x: number, y: number, z: number) => void } | null>(null);
  const rotationRef = useRef<Rotation>(initialRotation ?? DEFAULT_ROTATION);

  const [status, setStatus] = useState<ViewerStatus>("loading-engine");
  const [error, setError] = useState("");
  const [showAdmin, setShowAdmin] = useState(false);
  const [rotation, setRotation] = useState<Rotation>(initialRotation ?? DEFAULT_ROTATION);
  const [camera, setCamera] = useState<CameraPosition>(initialCamera ?? DEFAULT_CAMERA);
  const [adminPin, setAdminPin] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [saveError, setSaveError] = useState("");

  const hasGlobalRotationPreset = initialRotation !== null;
  const hasGlobalCameraPreset = initialCamera !== null;

  useEffect(() => {
    rotationRef.current = rotation;
    splatRef.current?.setLocalEulerAngles(rotation.x, rotation.y, rotation.z);
  }, [rotation]);

  useEffect(() => {
    cameraPositionRef.current?.(camera);
  }, [camera]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;

    let disposed = false;
    let destroy: (() => void) | undefined;
    let initialSizeObserver: ResizeObserver | undefined;

    async function initialize() {
      try {
        await new Promise<void>((resolve) => {
          const applyInitialSize = () => {
            const { width, height } = canvas.getBoundingClientRect();
            if (width < 1 || height < 1) return;

            const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.max(1, Math.round(width * pixelRatio));
            canvas.height = Math.max(1, Math.round(height * pixelRatio));
            initialSizeObserver?.disconnect();
            initialSizeObserver = undefined;
            resolve();
          };

          initialSizeObserver = new ResizeObserver(applyInitialSize);
          initialSizeObserver.observe(canvas);
          requestAnimationFrame(applyInitialSize);
        });
        if (disposed) return;

        const pc = await import("playcanvas");
        if (disposed) return;

        const device = await pc.createGraphicsDevice(canvas, {
          antialias: false,
          deviceTypes: ["webgpu", "webgl2"],
        });
        if (disposed) {
          device.destroy();
          return;
        }

        const options = new pc.AppOptions();
        options.graphicsDevice = device;
        options.mouse = new pc.Mouse(canvas);
        options.touch = new pc.TouchDevice(canvas);
        options.componentSystems = [
          pc.RenderComponentSystem,
          pc.CameraComponentSystem,
          pc.LightComponentSystem,
          pc.ScriptComponentSystem,
          pc.GSplatComponentSystem,
        ];
        options.resourceHandlers = [
          pc.TextureHandler,
          pc.ContainerHandler,
          pc.ScriptHandler,
          pc.GSplatHandler,
        ];

        const app = new pc.AppBase(canvas);
        app.init(options);
        app.setCanvasFillMode(pc.FILLMODE_NONE);
        app.setCanvasResolution(pc.RESOLUTION_AUTO);
        app.scene.gsplat.lodUpdateAngle = 90;
        app.scene.gsplat.lodBehindPenalty = 3;
        app.scene.gsplat.radialSorting = true;
        app.scene.gsplat.lodUpdateDistance = 1;
        app.scene.gsplat.lodUnderfillLimit = 8;
        app.scene.gsplat.splatBudget = pc.platform.mobile ? 1_000_000 : 4_000_000;

        const cameraEntity = new pc.Entity("camera");
        cameraEntity.addComponent("camera", {
          clearColor: new pc.Color(0.055, 0.063, 0.058),
          fov: 65,
          nearClip: 0.05,
          farClip: 1000,
        });
        app.root.addChild(cameraEntity);

        const focus = new pc.Vec3(FOCUS_POINT.x, FOCUS_POINT.y, FOCUS_POINT.z);
        const startCamera = initialCamera ?? DEFAULT_CAMERA;
        const startOrbit = orbitFromPosition(startCamera);
        let yaw = startOrbit.yaw;
        let pitch = startOrbit.pitch;
        let distance = startOrbit.distance;

        const frameCamera = () => {
          const yawRad = yaw * Math.PI / 180;
          const pitchRad = pitch * Math.PI / 180;
          cameraEntity.setPosition(
            focus.x + distance * Math.cos(pitchRad) * Math.sin(yawRad),
            focus.y + distance * Math.sin(pitchRad),
            focus.z + distance * Math.cos(pitchRad) * Math.cos(yawRad),
          );
          cameraEntity.lookAt(focus);
        };

        const applyCameraPosition = (position: CameraPosition) => {
          const orbit = orbitFromPosition(position);
          yaw = orbit.yaw;
          pitch = orbit.pitch;
          distance = orbit.distance;
          frameCamera();
        };

        cameraPositionRef.current = applyCameraPosition;

        frameRef.current = () => {
          const resetOrbit = orbitFromPosition(initialCamera ?? DEFAULT_CAMERA);
          yaw = resetOrbit.yaw;
          pitch = resetOrbit.pitch;
          distance = resetOrbit.distance;
          frameCamera();
        };

        zoomRef.current = (factor: number) => {
          distance = Math.max(0.5, Math.min(150, distance * factor));
          frameCamera();
        };

        frameCamera();

        const pointers = new Map<number, { x: number; y: number }>();
        let dragging = false;
        let lastX = 0;
        let lastY = 0;
        let pinchDistance = 0;

        const pinchLength = () => {
          const values = Array.from(pointers.values());
          if (values.length < 2) {
            return 0;
          }

          const a = values[0];
          const b = values[1];
          return Math.hypot(a.x - b.x, a.y - b.y);
        };

        const pointerDown = (event: PointerEvent) => {
          pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
          dragging = pointers.size === 1;
          lastX = event.clientX;
          lastY = event.clientY;
          if (pointers.size === 2) {
            pinchDistance = pinchLength();
          }
          canvas.setPointerCapture(event.pointerId);
        };

        const pointerMove = (event: PointerEvent) => {
          if (!pointers.has(event.pointerId)) return;

          pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

          if (pointers.size >= 2) {
            const nextPinch = pinchLength();
            if (pinchDistance > 0 && nextPinch > 0) {
              const factor = pinchDistance / nextPinch;
              distance = Math.max(0.5, Math.min(150, distance * factor));
              frameCamera();
            }
            pinchDistance = nextPinch;
            return;
          }

          if (!dragging) return;
          yaw -= (event.clientX - lastX) * 0.25;
          pitch = Math.max(-85, Math.min(85, pitch + (event.clientY - lastY) * 0.2));
          lastX = event.clientX;
          lastY = event.clientY;
          frameCamera();
        };

        const pointerUp = (event: PointerEvent) => {
          pointers.delete(event.pointerId);

          if (pointers.size < 2) {
            pinchDistance = 0;
          }

          if (pointers.size === 1) {
            const [remaining] = Array.from(pointers.values());
            dragging = true;
            lastX = remaining.x;
            lastY = remaining.y;
          } else {
            dragging = false;
          }
        };

        const wheel = (event: WheelEvent) => {
          event.preventDefault();
          distance = Math.max(0.5, Math.min(150, distance * Math.exp(event.deltaY * 0.001)));
          frameCamera();
        };

        canvas.addEventListener("pointerdown", pointerDown);
        canvas.addEventListener("pointermove", pointerMove);
        canvas.addEventListener("pointerup", pointerUp);
        canvas.addEventListener("pointercancel", pointerUp);
        canvas.addEventListener("pointerleave", pointerUp);
        canvas.addEventListener("wheel", wheel, { passive: false });

        const resize = () => {
          const { width, height } = canvas.getBoundingClientRect();
          if (width < 1 || height < 1) return;
          app.resizeCanvas(Math.round(width), Math.round(height));
        };
        const observer = new ResizeObserver(resize);
        observer.observe(canvas);
        resize();

        app.start();
        setStatus("loading-scene");

        const asset = new pc.Asset("streamed-sog", "gsplat", { url: manifestUrl });
        app.assets.add(asset);
        await new Promise<void>((resolve, reject) => {
          asset.once("load", () => resolve());
          asset.once("error", (reason: unknown) => reject(new Error(String(reason))));
          app.assets.load(asset);
        });
        if (disposed) return;

        const splat = new pc.Entity("splat");
        splat.addComponent("gsplat", { asset });
        splat.setLocalEulerAngles(rotationRef.current.x, rotationRef.current.y, rotationRef.current.z);
        splatRef.current = splat;
        app.root.addChild(splat);

        const component = splat.gsplat;
        const streamedResource = component?.resource as
          | { octree?: { lodLevels?: number } }
          | undefined;
        const lodLevels = streamedResource?.octree?.lodLevels;
        if (component && lodLevels) {
          component.lodRangeMin = pc.platform.mobile ? Math.min(2, lodLevels - 1) : 0;
          component.lodRangeMax = lodLevels - 1;
          component.lodBaseDistance = pc.platform.mobile ? 2 : 5;
          component.lodMultiplier = pc.platform.mobile ? 2 : 4;
        }

        setStatus("ready");

        destroy = () => {
          observer.disconnect();
          canvas.removeEventListener("pointerdown", pointerDown);
          canvas.removeEventListener("pointermove", pointerMove);
          canvas.removeEventListener("pointerup", pointerUp);
          canvas.removeEventListener("pointercancel", pointerUp);
          canvas.removeEventListener("pointerleave", pointerUp);
          canvas.removeEventListener("wheel", wheel);
          frameRef.current = null;
          zoomRef.current = null;
          cameraPositionRef.current = null;
          splatRef.current = null;
          app.destroy();
        };
      } catch (reason) {
        if (!disposed) {
          setError(reason instanceof Error ? reason.message : "The scene could not be loaded.");
          setStatus("error");
        }
      }
    }

    initialize();
    return () => {
      disposed = true;
      initialSizeObserver?.disconnect();
      destroy?.();
    };
  }, [manifestUrl, initialCamera]);

  async function enterFullscreen() {
    await canvasRef.current?.parentElement?.requestFullscreen();
  }

  function updateRotation(axis: keyof Rotation, value: string) {
    const numeric = Number(value);
    setRotation((current) => ({
      ...current,
      [axis]: clampRotationValue(numeric),
    }));
  }

  function resetRotation() {
    setRotation(DEFAULT_ROTATION);
  }

  function updateCamera(axis: keyof CameraPosition, value: string) {
    const numeric = Number(value);
    setCamera((current) => ({
      ...current,
      [axis]: clampCameraValue(numeric),
    }));
  }

  function resetCamera() {
    setCamera(initialCamera ?? DEFAULT_CAMERA);
  }

  async function saveAllGlobally() {
    setSaveBusy(true);
    setSaveStatus("");
    setSaveError("");

    try {
      const rotationResponse = await fetch("/api/viewer-rotation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          manifestUrl,
          pin: adminPin,
          rotation,
        }),
      });

      if (!rotationResponse.ok) {
        const payload = (await rotationResponse.json()) as { error?: string };
        throw new Error(payload.error || "Could not save global rotation.");
      }

      const cameraResponse = await fetch("/api/viewer-camera", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          manifestUrl,
          pin: adminPin,
          camera,
        }),
      });

      if (!cameraResponse.ok) {
        const payload = (await cameraResponse.json()) as { error?: string };
        throw new Error(payload.error || "Could not save global camera.");
      }

      setSaveStatus("Rotation and camera saved for all users.");
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : "Could not save global preset.");
    } finally {
      setSaveBusy(false);
    }
  }

  async function saveRotationGlobally() {
    setSaveBusy(true);
    setSaveStatus("");
    setSaveError("");

    try {
      const response = await fetch("/api/viewer-rotation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          manifestUrl,
          pin: adminPin,
          rotation,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Could not save global rotation.");
      }

      setSaveStatus("Rotation saved for all users.");
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : "Could not save global rotation.");
    } finally {
      setSaveBusy(false);
    }
  }

  async function saveCameraGlobally() {
    setSaveBusy(true);
    setSaveStatus("");
    setSaveError("");

    try {
      const response = await fetch("/api/viewer-camera", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          manifestUrl,
          pin: adminPin,
          camera,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Could not save global camera.");
      }

      setSaveStatus("Camera saved for all users.");
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : "Could not save global camera.");
    } finally {
      setSaveBusy(false);
    }
  }

  return (
    <section className={styles.viewer}>
      <canvas ref={canvasRef} className={styles.canvas} aria-label="Interactive Gaussian splat viewer" />
      {status !== "ready" && (
        <div className={styles.status}>
          {status === "error" ? <TriangleAlert size={24} /> : <LoaderCircle className={styles.spinner} size={24} />}
          <strong>{status === "error" ? "Scene unavailable" : status === "loading-engine" ? "Starting renderer" : "Loading coarse detail"}</strong>
          <span>{status === "error" ? error : "PlayCanvas is preparing the streamed scene."}</span>
        </div>
      )}
      <div className={styles.hud}>
        <span><i className={status === "ready" ? styles.online : ""} /> {status === "ready" ? "Streaming" : "Connecting"}</span>
        <span>Drag to orbit · Pinch or zoom buttons</span>
      </div>
      <div className={styles.tools}>
        <button type="button" onClick={() => setShowAdmin((open) => !open)} title="Viewer admin" aria-label="Viewer admin"><Settings2 size={19} /></button>
        <button type="button" onClick={() => zoomRef.current?.(0.85)} title="Zoom in" aria-label="Zoom in"><ZoomIn size={19} /></button>
        <button type="button" onClick={() => zoomRef.current?.(1.15)} title="Zoom out" aria-label="Zoom out"><ZoomOut size={19} /></button>
        <button type="button" onClick={() => frameRef.current?.()} title="Reset camera" aria-label="Reset camera"><RotateCcw size={19} /></button>
        <button type="button" onClick={enterFullscreen} title="Enter fullscreen" aria-label="Enter fullscreen"><Expand size={19} /></button>
      </div>
      {showAdmin && (
        <aside className={styles.adminPanel}>
          <div className={styles.adminHeader}>
            <strong>Rotation</strong>
            <span>Use your admin PIN to save globally</span>
            <span className={styles.adminSource}>
              {hasGlobalRotationPreset ? <Lock size={12} /> : <Unlock size={12} />} {hasGlobalRotationPreset ? "Global preset" : "Default rotation"}
            </span>
          </div>
          <label>
            X
            <input type="number" value={rotation.x} onChange={(event) => updateRotation("x", event.target.value)} step="1" />
          </label>
          <label>
            Y
            <input type="number" value={rotation.y} onChange={(event) => updateRotation("y", event.target.value)} step="1" />
          </label>
          <label>
            Z
            <input type="number" value={rotation.z} onChange={(event) => updateRotation("z", event.target.value)} step="1" />
          </label>
          <button type="button" className={styles.adminButton} onClick={saveRotationGlobally} disabled={saveBusy}>
            {saveBusy ? "Saving..." : "Save global rotation"}
          </button>
          <button type="button" className={styles.adminButton} onClick={resetRotation}>Reset rotation</button>

          <div className={styles.adminHeader}>
            <strong>Initial camera</strong>
            <span>Set startup camera position for all users</span>
            <span className={styles.adminSource}>
              {hasGlobalCameraPreset ? <Lock size={12} /> : <Unlock size={12} />} {hasGlobalCameraPreset ? "Global preset" : "Default camera"}
            </span>
          </div>
          <label>
            Cam X
            <input type="number" value={camera.x} onChange={(event) => updateCamera("x", event.target.value)} step="0.1" />
          </label>
          <label>
            Cam Y
            <input type="number" value={camera.y} onChange={(event) => updateCamera("y", event.target.value)} step="0.1" />
          </label>
          <label>
            Cam Z
            <input type="number" value={camera.z} onChange={(event) => updateCamera("z", event.target.value)} step="0.1" />
          </label>

          <label>
            Admin PIN
            <input type="password" value={adminPin} onChange={(event) => setAdminPin(event.target.value)} placeholder="Enter PIN" />
          </label>
          <button type="button" className={styles.adminButton} onClick={saveAllGlobally} disabled={saveBusy}>
            {saveBusy ? "Saving..." : "Save all (rotation + camera)"}
          </button>
          <button type="button" className={styles.adminButton} onClick={saveCameraGlobally} disabled={saveBusy}>
            {saveBusy ? "Saving..." : "Save global camera"}
          </button>
          <button type="button" className={styles.adminButton} onClick={resetCamera}>Reset camera preset</button>

          {saveStatus && <p className={styles.adminSuccess}>{saveStatus}</p>}
          {saveError && <p className={styles.adminError}>{saveError}</p>}
        </aside>
      )}
    </section>
  );
}
