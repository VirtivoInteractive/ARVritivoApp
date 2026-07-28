import { NextResponse } from "next/server";
import {
  getGlobalCameraPosition,
  setGlobalCameraPosition,
  type ViewerCameraPosition,
} from "@/lib/r2";
import { verifyUploadPin } from "@/lib/upload-auth";

export const runtime = "nodejs";

type SaveCameraBody = {
  manifestUrl?: string;
  pin?: string;
  camera?: Partial<ViewerCameraPosition>;
};

function parseCamera(camera: Partial<ViewerCameraPosition> | undefined): ViewerCameraPosition | null {
  if (!camera) {
    return null;
  }

  const x = Number(camera.x);
  const y = Number(camera.y);
  const z = Number(camera.z);

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null;
  }

  return { x, y, z };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const manifestUrl = searchParams.get("manifestUrl")?.trim();

  if (!manifestUrl) {
    return NextResponse.json({ error: "manifestUrl is required." }, { status: 400 });
  }

  const camera = await getGlobalCameraPosition(manifestUrl);
  return NextResponse.json({ camera });
}

export async function POST(request: Request) {
  let body: SaveCameraBody;

  try {
    body = (await request.json()) as SaveCameraBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const manifestUrl = body.manifestUrl?.trim();
  const pin = body.pin?.trim() || "";
  const camera = parseCamera(body.camera);

  if (!manifestUrl) {
    return NextResponse.json({ error: "manifestUrl is required." }, { status: 400 });
  }

  if (!camera) {
    return NextResponse.json({ error: "camera with x, y, z is required." }, { status: 400 });
  }

  if (!verifyUploadPin(pin)) {
    return NextResponse.json({ error: "Invalid admin PIN." }, { status: 401 });
  }

  try {
    await setGlobalCameraPosition(manifestUrl, camera);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save camera." },
      { status: 500 },
    );
  }
}