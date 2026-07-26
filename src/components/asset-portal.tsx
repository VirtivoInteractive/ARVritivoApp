"use client";

import Link from "next/link";
import { ArrowUpRight, Box, Database, Plus, Radio, Search, Upload } from "lucide-react";
import { FormEvent, useDeferredValue, useState } from "react";
import { assets } from "@/lib/assets";
import styles from "./asset-portal.module.css";

export function AssetPortal() {
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [manifestUrl, setManifestUrl] = useState("");
  const [showPublisher, setShowPublisher] = useState(false);
  const [formError, setFormError] = useState("");
  const deferredQuery = useDeferredValue(query);

  const filteredAssets = assets.filter((asset) =>
    asset.name.toLowerCase().includes(deferredQuery.toLowerCase()),
  );

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
          <p className={styles.subtitle}>Publish processed scenes and inspect their streamed output.</p>
        </div>
        <button className={styles.primaryButton} type="button" onClick={() => setShowPublisher((open) => !open)}>
          <Plus size={18} /> Publish scene
        </button>
      </section>

      {showPublisher && (
        <form className={styles.publisher} onSubmit={publish}>
          <div className={styles.publisherIntro}>
            <Upload size={22} />
            <div><strong>Register processed SOG</strong><span>Files remain in your object storage.</span></div>
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
      )}

      <section className={styles.metrics} aria-label="Library summary">
        <div><span>Published scenes</span><strong>01</strong></div>
        <div><span>Runtime format</span><strong>SOG <small>LOD</small></strong></div>
        <div><span>Storage status</span><strong className={styles.pending}>Not connected</strong></div>
      </section>

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