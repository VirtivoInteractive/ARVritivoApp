import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createR2UploadUrl } from "@/lib/r2";
import { isUploadAuthCookieValid, UPLOAD_AUTH_COOKIE } from "@/lib/upload-auth";

export const runtime = "nodejs";

type SignUploadBody = {
  objectKey?: string;
  contentType?: string;
};

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const authCookie = cookieStore.get(UPLOAD_AUTH_COOKIE)?.value;

  if (!isUploadAuthCookieValid(authCookie)) {
    return NextResponse.json({ error: "Upload portal is locked. Enter PIN first." }, { status: 401 });
  }

  let body: SignUploadBody;

  try {
    body = (await request.json()) as SignUploadBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const objectKey = body.objectKey?.trim();
  const contentType = body.contentType?.trim() || "application/octet-stream";

  if (!objectKey) {
    return NextResponse.json({ error: "objectKey is required." }, { status: 400 });
  }

  try {
    const signed = await createR2UploadUrl(objectKey, contentType);
    return NextResponse.json(signed);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sign upload URL." },
      { status: 500 },
    );
  }
}