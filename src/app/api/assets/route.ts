import { NextResponse } from "next/server";
import { demoAsset } from "@/lib/assets";
import { listR2SplatAssets } from "@/lib/r2";

export const runtime = "nodejs";

export async function GET() {
  const { assets: r2Assets, connected, message } = await listR2SplatAssets();

  const source = r2Assets.length > 0 ? "r2" : "demo";
  const assets = r2Assets.length > 0 ? r2Assets : [demoAsset];

  return NextResponse.json({
    assets,
    storage: {
      connected,
      source,
      message,
    },
  });
}