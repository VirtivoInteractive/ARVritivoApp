"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  Box,
  Database,
  FolderUp,
  Lock,
  Plus,
  Radio,
  Search,
  Unlock,
  Upload,
} from "lucide-react";
import { FormEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { SplatAsset } from "@/lib/assets";
import styles from "./asset-portal.module.css";

type AssetPortalProps = {
  assets: SplatAsset[];
  storageConnected: boolean;
  storageSource: "r2" | "demo";
  storageMessage?: string;
};

export function AssetPortal({
  assets,
  storageConnected,
  storageSource,
  storageMessage,
}: AssetPortalProps) {
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [manifestUrl, setManifestUrl] = useState("");
  const [pin, setPin] = useState("");
  const [projectName, setProjectName] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [formError, setFormError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploadStatus, setUploadStatus] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [pinConfigured, setPinConfigured] = useState(true);
  const [uploadAuthorized, setUploadAuthorized] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(query);

  const filteredAssets = assets.filter((asset) =>
    asset.name.toLowerCase().includes(deferredQuery.toLowerCase()),
  );

  const hasManifest = useMemo(
    () => selectedFiles.some((file) => file.name.toLowerCase() === "lod-meta.json"),
    [selectedFiles],
  );

  useEffect(() => {
    const element = folderInputRef.current;
    if (!element) {
      return;
    }

    element.setAttribute("webkitdirectory", "");
    element.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAuthState() {
      try {
        const response = await fetch("/api/uploads/auth", { method: "GET", cache: "no-store" });
        const payload = (await response.json()) as { configured?: boolean; authorized?: boolean };
        if (cancelled) {
          return;
        }

        setPinConfigured(Boolean(payload.configured));
        setUploadAuthorized(Boolean(payload.authorized));
      } catch {
        if (!cancelled) {
          setPinConfigured(false);
          setUploadAuthorized(false);
        }
      } finally {
        if (!cancelled) {
          setAuthReady(true);
        }
      }
    }

    void loadAuthState();
    return () => {
      cancelled = true;
    };
  }, []);

  function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");

    try {
      const parsed = new URL(manifestUrl);
      if (!parsed.pathname.endsWith("lod-meta.json")) {
        throw new Error("Use the Streamed SOG lod-meta.json URL.");
      }

      window.location.assign(
        `/viewer?name=${encodeURIComponent(name || "Untitled scene")}&url=${encodeURIComponent(parsed.toString())}`,
      );
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Enter a valid manifest URL.");
    }
  }

  async function unlockUploadPortal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthBusy(true);
    setUploadError("");

    try {
      const response = await fetch("/api/uploads/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "PIN check failed.");
      }

      setUploadAuthorized(true);
      setPin("");
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "PIN check failed.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function lockUploadPortal() {
    setAuthBusy(true);
    setUploadError("");

    try {
      await fetch("/api/uploads/auth", { method: "DELETE" });
      setUploadAuthorized(false);
    } finally {
      setAuthBusy(false);
    }
  }

  async function uploadProjectFiles(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadError("");
    setUploadStatus("");

    if (!projectName.trim()) {
      setUploadError("Project name is required.");
      return;
    }

    if (selectedFiles.length === 0) {
      setUploadError("Select your processed SOG files first.");
      return;
    }

    if (!hasManifest) {
      setUploadError("The upload must include lod-meta.json.");
      return;
    }

    const slug = projectName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    if (!slug) {
      setUploadError("Use letters and numbers in the project name.");
      return;
    }

    setUploadBusy(true);

    try {
      let uploaded = 0;
      let manifestPublicUrl = "";

      for (const file of selectedFiles) {
        const relativePath = (file.webkitRelativePath || file.name).replace(/^[^/]+\//, "");
        const objectKey = `${slug}/${relativePath}`;

        setUploadStatus(`Uploading ${uploaded + 1}/${selectedFiles.length}: ${relativePath}`);

        const signResponse = await fetch("/api/uploads/sign", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            objectKey,
            contentType: file.type || "application/octet-stream",
          }),
        });

        if (!signResponse.ok) {
          const payload = (await signResponse.json()) as { error?: string };
          throw new Error(payload.error || "Could not sign upload URL.");
        }

        const signed = (await signResponse.json()) as {
          uploadUrl: string;
          publicUrl?: string | null;
        };

        const uploadResponse = await fetch(signed.uploadUrl, {
          method: "PUT",
          headers: {
            "content-type": file.type || "application/octet-stream",
          },
          body: file,
        });

        if (!uploadResponse.ok) {
          throw new Error(`Upload failed for ${relativePath}.`);
        }

        if (relativePath.toLowerCase() === "lod-meta.json" && signed.publicUrl) {
          manifestPublicUrl = signed.publicUrl;
        }

        uploaded += 1;
      }

      setUploadStatus(`Uploaded ${uploaded} files.`);

      if (manifestPublicUrl) {
        window.location.assign(
          `/viewer?name=${encodeURIComponent(projectName.trim())}&url=${encodeURIComponent(manifestPublicUrl)}`,
        );
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploadBusy(false);
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand} aria-label="ARVritivo home">
          <span className={styles.mark}><Box size={18} strokeWidth={2.4} /></span>
          <span>ARVritivo</span>
        </Link>
        <div className={styles.environment}><Radio size={14} /> MVP workspace</div>
        <button className={styles.avatar} type="button" title="Administrator profile">AV</button>
      </header>

      <section className={styles.headingRow}>
        <div>
          <p className={styles.eyebrow}>Asset operations</p>
          <h1>Gaussian splat library</h1>
          <p className={styles.subtitle}>Upload a processed SOG folder or paste an existing lod-meta.json URL.</p>
        </div>
        <div className={styles.headingActions}>
          <button className={styles.primaryButton} type="button" onClick={() => folderInputRef.current?.click()}>
            <FolderUp size={18} /> Upload folder
          </button>
          <button className={styles.secondaryButton} type="button" onClick={() => setProjectName("Untitled scene")}>
            <Plus size={18} /> Paste URL
          </button>
        </div>
      </section>

      <section className={styles.publisherStack}>
        <section className={styles.uploadPortal} aria-label="SOG Upload Portal">
          <div className={styles.uploadHeading}>
            <div>
              <h3>Upload your own project</h3>
              <p>Allowed format: one folder containing lod-meta.json + generated chunk files.</p>
            </div>
            {uploadAuthorized ? (
              <button className={styles.lockButton} type="button" onClick={lockUploadPortal} disabled={authBusy}>
                <Unlock size={16} /> Lock
              </button>
            ) : (
              <span className={styles.lockBadge}><Lock size={15} /> PIN required</span>
            )}
          </div>

          {!authReady ? (
            <p className={styles.uploadInfo}>Checking portal access...</p>
          ) : !pinConfigured ? (
            <p className={styles.uploadError}>Set UPLOAD_PORTAL_PIN in .env.local to enable uploads.</p>
          ) : !uploadAuthorized ? (
            <form className={styles.pinForm} onSubmit={unlockUploadPortal}>
              <label>
                Upload PIN
                <input
                  value={pin}
                  onChange={(event) => setPin(event.target.value)}
                  placeholder="Enter PIN"
                  type="password"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                />
              </label>
              <button className={styles.publishButton} type="submit" disabled={authBusy}>
                {authBusy ? "Checking..." : "Unlock uploads"}
              </button>
            </form>
          ) : (
            <form className={styles.uploadForm} onSubmit={uploadProjectFiles}>
              <label>
                Project name
                <input
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  placeholder="My warehouse scan"
                  required
                />
              </label>
              <label>
                Project folder
                <input
                  ref={folderInputRef}
                  type="file"
                  multiple
                  onChange={(event) => setSelectedFiles(Array.from(event.target.files ?? []))}
                  required
                />
              </label>
              <p className={styles.uploadInfo}>Tip: choose the full export folder so relative paths stay intact.</p>
              <p className={styles.uploadInfo}>
                {selectedFiles.length} files selected{selectedFiles.length > 0 && !hasManifest ? " (missing lod-meta.json)" : ""}
              </p>
              <button className={styles.publishButton} type="submit" disabled={uploadBusy}>
                <FolderUp size={17} /> {uploadBusy ? "Uploading..." : "Upload to R2"}
              </button>
            </form>
          )}

          {uploadStatus && <p className={styles.uploadInfo}>{uploadStatus}</p>}
          {uploadError && <p className={styles.uploadError} role="alert">{uploadError}</p>}
        </section>

        <form className={styles.publisher} onSubmit={publish}>
          <div className={styles.publisherIntro}>
            <Upload size={22} />
            <div><strong>Open an existing SOG URL</strong><span>Use this only if the scene is already hosted somewhere.</span></div>
          </div>
          <label>
            Scene name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Courtyard scan" required />
          </label>
          <label className={styles.urlField}>
            Manifest URL
            <input value={manifestUrl} onChange={(event) => setManifestUrl(event.target.value)} placeholder="https://cdn.example.com/scene/lod-meta.json" inputMode="url" required />
          </label>
          <button className={styles.publishButton} type="submit">Open viewer <ArrowUpRight size={17} /></button>
          {formError && <p className={styles.formError} role="alert">{formError}</p>}
        </form>
      </section>

      <section className={styles.metrics} aria-label="Library summary">
        <div><span>Published scenes</span><strong>{assets.length.toString().padStart(2, "0")}</strong></div>
        <div><span>Runtime format</span><strong>SOG <small>LOD</small></strong></div>
        <div>
          <span>Storage status</span>
          <strong className={storageConnected ? styles.ready : styles.pending}>
            {storageSource === "r2" ? "Connected (R2)" : "Demo mode"}
          </strong>
        </div>
      </section>

      {storageMessage && <p className={styles.formError}>{storageMessage}</p>}

      <section className={styles.library}>
        <div className={styles.libraryHeader}>
          <div><h2>Scenes</h2><span>{filteredAssets.length} available</span></div>
          <label className={styles.search}><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search scenes" aria-label="Search scenes" /></label>
        </div>

        <div className={styles.tableHeader}><span>Scene</span><span>Source</span><span>Updated</span><span>Status</span><span aria-hidden="true" /></div>
        {filteredAssets.map((asset) => (
          <Link className={styles.assetRow} href={`/viewer?name=${encodeURIComponent(asset.name)}&url=${encodeURIComponent(asset.manifestUrl)}`} key={asset.id}>
            <span className={styles.assetName}><span className={styles.thumbnail}><Database size={22} /></span><span><strong>{asset.name}</strong><small>{asset.id}</small></span></span>
            <span>{asset.detail}</span>
            <span>{asset.updatedAt}</span>
            <span className={styles.ready}><i /> {asset.status}</span>
            <ArrowUpRight size={18} />
          </Link>
        ))}
      </section>
    </main>
  );
}