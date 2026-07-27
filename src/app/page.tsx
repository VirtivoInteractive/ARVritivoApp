import { AssetPortal } from "@/components/asset-portal";
import { demoAsset } from "@/lib/assets";
import { listR2SplatAssets } from "@/lib/r2";

export default async function Home() {
  const { assets: r2Assets, connected, message } = await listR2SplatAssets();

  return (
    <AssetPortal
      assets={r2Assets.length > 0 ? r2Assets : [demoAsset]}
      storageConnected={connected}
      storageSource={r2Assets.length > 0 ? "r2" : "demo"}
      storageMessage={message}
    />
  );
}
