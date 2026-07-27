import { NextResponse } from "next/server";
import {
  getGlobalSplatRotation,
  setGlobalSplatRotation,
  type SplatRotation,
} from "@/lib/r2";
import { verifyUploadPin } from "@/lib/upload-auth";

export const runtime = "nodejs";

type SaveRotationBody = {
  manifestUrl?: string;
  pin?: string;
  rotation?: Partial<SplatRotation>;
};

function parseRotation(rotation: Partial<SplatRotation> | undefined): SplatRotation | null {
  if (!rotation) {
    return null;
  }

  const x = Number(rotation.x);
  const y = Number(rotation.y);
  const z = Number(rotation.z);

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

  const rotation = await getGlobalSplatRotation(manifestUrl);
  return NextResponse.json({ rotation });
}

export async function POST(request: Request) {
  let body: SaveRotationBody;

  try {
    body = (await request.json()) as SaveRotationBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const manifestUrl = body.manifestUrl?.trim();
  const pin = body.pin?.trim() || "";
  const rotation = parseRotation(body.rotation);

  if (!manifestUrl) {
    return NextResponse.json({ error: "manifestUrl is required." }, { status: 400 });
  }

  if (!rotation) {
    return NextResponse.json({ error: "rotation with x, y, z is required." }, { status: 400 });
  }

  if (!verifyUploadPin(pin)) {
    return NextResponse.json({ error: "Invalid admin PIN." }, { status: 401 });
  }

  try {
    await setGlobalSplatRotation(manifestUrl, rotation);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save rotation." },
      { status: 500 },
    );
  }
}