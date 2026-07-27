import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  createUploadAuthCookieValue,
  isUploadAuthCookieValid,
  UPLOAD_AUTH_COOKIE,
  uploadPinIsConfigured,
  verifyUploadPin,
} from "@/lib/upload-auth";

export const runtime = "nodejs";

type AuthBody = {
  pin?: string;
};

export async function GET() {
  const cookieStore = await cookies();
  const value = cookieStore.get(UPLOAD_AUTH_COOKIE)?.value;

  return NextResponse.json({
    configured: uploadPinIsConfigured(),
    authorized: isUploadAuthCookieValid(value),
  });
}

export async function POST(request: Request) {
  if (!uploadPinIsConfigured()) {
    return NextResponse.json(
      { error: "UPLOAD_PORTAL_PIN is not configured on the server." },
      { status: 503 },
    );
  }

  let body: AuthBody;
  try {
    body = (await request.json()) as AuthBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const pin = body.pin?.trim() || "";
  if (!verifyUploadPin(pin)) {
    return NextResponse.json({ error: "Invalid PIN." }, { status: 401 });
  }

  const response = NextResponse.json({ authorized: true });
  response.cookies.set({
    name: UPLOAD_AUTH_COOKIE,
    value: createUploadAuthCookieValue(),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ authorized: false });
  response.cookies.delete(UPLOAD_AUTH_COOKIE);
  return response;
}