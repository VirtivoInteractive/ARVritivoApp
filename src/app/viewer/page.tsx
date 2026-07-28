import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SplatViewer } from "@/components/splat-viewer";
import { demoAsset } from "@/lib/assets";
import { getGlobalCameraPosition, getGlobalSplatRotation } from "@/lib/r2";
import styles from "./viewer.module.css";

type ViewerPageProps = {
  searchParams: Promise<{ name?: string; url?: string }>;
};

export default async function ViewerPage({ searchParams }: ViewerPageProps) {
  const params = await searchParams;
  const name = params.name || demoAsset.name;
  const manifestUrl = params.url || demoAsset.manifestUrl;
  const [initialRotation, initialCamera] = await Promise.all([
    getGlobalSplatRotation(manifestUrl),
    getGlobalCameraPosition(manifestUrl),
  ]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}><ArrowLeft size={18} /> Library</Link>
        <div><span>Streamed SOG</span><h1>{name}</h1></div>
        <span className={styles.live}><i /> Live viewer</span>
      </header>
      <SplatViewer
        key={manifestUrl}
        manifestUrl={manifestUrl}
        initialRotation={initialRotation}
        initialCamera={initialCamera}
      />
    </main>
  );
}