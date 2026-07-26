"use client";

import { Expand, LoaderCircle, RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import styles from "./splat-viewer.module.css";

type ViewerStatus = "loading-engine" | "loading-scene" | "ready" | "error";

export function SplatViewer({ manifestUrl }: { manifestUrl: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState<ViewerStatus>("loading-engine");
  const [error, setError] = useState("");

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

        const camera = new pc.Entity("camera");
        camera.addComponent("camera", {
          clearColor: new pc.Color(0.055, 0.063, 0.058),
          fov: 65,
          nearClip: 0.05,
          farClip: 1000,
        });
        app.root.addChild(camera);

        const focus = new pc.Vec3(18, -1.3, 13.5);
        let yaw = -90;
        let pitch = -8;
        let distance = 18;

        const frameCamera = () => {
          const yawRad = yaw * Math.PI / 180;
          const pitchRad = pitch * Math.PI / 180;
          camera.setPosition(
            focus.x + distance * Math.cos(pitchRad) * Math.sin(yawRad),
            focus.y + distance * Math.sin(pitchRad),
            focus.z + distance * Math.cos(pitchRad) * Math.cos(yawRad),
          );
          camera.lookAt(focus);
        };
        frameRef.current = () => {
          yaw = -90;
          pitch = -8;
          distance = 18;
          frameCamera();
        };
        frameCamera();

        let dragging = false;
        let lastX = 0;
        let lastY = 0;
        const pointerDown = (event: PointerEvent) => {
          dragging = true;
          lastX = event.clientX;
          lastY = event.clientY;
          canvas.setPointerCapture(event.pointerId);
        };
        const pointerMove = (event: PointerEvent) => {
          if (!dragging) return;
          yaw -= (event.clientX - lastX) * 0.25;
          pitch = Math.max(-85, Math.min(85, pitch + (event.clientY - lastY) * 0.2));
          lastX = event.clientX;
          lastY = event.clientY;
          frameCamera();
        };
        const pointerUp = () => { dragging = false; };
        const wheel = (event: WheelEvent) => {
          event.preventDefault();
          distance = Math.max(0.5, Math.min(150, distance * Math.exp(event.deltaY * 0.001)));
          frameCamera();
        };
        canvas.addEventListener("pointerdown", pointerDown);
        canvas.addEventListener("pointermove", pointerMove);
        canvas.addEventListener("pointerup", pointerUp);
        canvas.addEventListener("pointercancel", pointerUp);
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
        splat.setLocalEulerAngles(-90, 0, 0);
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
          canvas.removeEventListener("wheel", wheel);
          frameRef.current = null;
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
  }, [manifestUrl]);

  async function enterFullscreen() {
    await canvasRef.current?.parentElement?.requestFullscreen();
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
        <span>Drag to orbit · Wheel to zoom</span>
      </div>
      <div className={styles.tools}>
        <button type="button" onClick={() => frameRef.current?.()} title="Reset camera" aria-label="Reset camera"><RotateCcw size={19} /></button>
        <button type="button" onClick={enterFullscreen} title="Enter fullscreen" aria-label="Enter fullscreen"><Expand size={19} /></button>
      </div>
    </section>
  );
}