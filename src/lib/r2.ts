import "server-only";

import { createHash } from "node:crypto";

import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { SplatAsset } from "@/lib/assets";

type ListedR2Assets = {
  assets: SplatAsset[];
  connected: boolean;
  message?: string;
};

export type SplatRotation = {
  x: number;
  y: number;
  z: number;
};

export type ViewerCameraPosition = {
  x: number;
  y: number;
  z: number;
};

type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl?: string;
};

function getOptionalConfig(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return null;
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicBaseUrl: normalizePublicBaseUrl(process.env.R2_PUBLIC_BASE_URL),
  };
}

function getRequiredConfig(): R2Config {
  const config = getOptionalConfig();
  if (!config) {
    throw new Error(
      "R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET.",
    );
  }

  return config;
}

function createR2Client(config: R2Config) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

function normalizePublicBaseUrl(baseUrl: string | undefined) {
  if (!baseUrl) {
    return undefined;
  }

  return baseUrl.replace(/\/$/, "");
}

function encodeObjectKeyForUrl(key: string) {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildPublicObjectUrl(baseUrl: string | undefined, key: string) {
  if (!baseUrl) {
    return null;
  }

  return `${baseUrl}/${encodeObjectKeyForUrl(key)}`;
}

function keyToAssetId(key: string) {
  return key.replace(/\//g, "-").replace(/[^a-zA-Z0-9-_]/g, "");
}

function rotationObjectKey(manifestUrl: string) {
  const hash = createHash("sha256").update(manifestUrl).digest("hex");
  return `__arvritivo/rotations/${hash}.json`;
}

function cameraObjectKey(manifestUrl: string) {
  const hash = createHash("sha256").update(manifestUrl).digest("hex");
  return `__arvritivo/cameras/${hash}.json`;
}

function sanitizeRotation(rotation: SplatRotation): SplatRotation {
  const clamp = (value: number) => Math.max(-360, Math.min(360, Number(value) || 0));
  return {
    x: clamp(rotation.x),
    y: clamp(rotation.y),
    z: clamp(rotation.z),
  };
}

function sanitizeCameraPosition(camera: ViewerCameraPosition): ViewerCameraPosition {
  const clamp = (value: number) => Math.max(-10_000, Math.min(10_000, Number(value) || 0));
  return {
    x: clamp(camera.x),
    y: clamp(camera.y),
    z: clamp(camera.z),
  };
}

export async function listR2SplatAssets(): Promise<ListedR2Assets> {
  const config = getOptionalConfig();
  if (!config) {
    return {
      assets: [],
      connected: false,
      message: "R2 environment variables are missing.",
    };
  }

  try {
    const client = createR2Client(config);
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
      }),
    );

    const manifestObjects = (response.Contents ?? []).filter((item) =>
      item.Key?.endsWith("lod-meta.json"),
    );

    const assets = manifestObjects
      .map<SplatAsset | null>((item) => {
        const key = item.Key;
        if (!key) {
          return null;
        }

        const manifestUrl = buildPublicObjectUrl(config.publicBaseUrl, key);
        if (!manifestUrl) {
          return null;
        }

        return {
          id: keyToAssetId(key),
          name: key.split("/").slice(-2, -1)[0] || key,
          manifestUrl,
          status: "ready" as const,
          detail: `R2 object ${key}`,
          updatedAt: item.LastModified?.toISOString().slice(0, 10) ?? "Unknown",
        };
      })
      .filter((asset): asset is SplatAsset => asset !== null);

    return {
      assets,
      connected: true,
      message: config.publicBaseUrl
        ? undefined
        : "Set R2_PUBLIC_BASE_URL to expose manifest and chunk URLs to the browser.",
    };
  } catch (error) {
    return {
      assets: [],
      connected: false,
      message: error instanceof Error ? error.message : "Failed to connect to R2.",
    };
  }
}

export function r2IsConfigured() {
  return getOptionalConfig() !== null;
}

export function getR2PublicObjectUrl(key: string) {
  const config = getOptionalConfig();
  return buildPublicObjectUrl(config?.publicBaseUrl, key);
}

function assertSafeObjectKey(key: string) {
  if (!key || key.startsWith("/") || key.includes("..")) {
    throw new Error("Invalid object key.");
  }
}

export async function createR2UploadUrl(key: string, contentType: string) {
  assertSafeObjectKey(key);

  const config = getRequiredConfig();
  const client = createR2Client(config);
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(client, command, { expiresIn: 60 * 5 });

  return {
    method: "PUT" as const,
    key,
    uploadUrl,
    publicUrl: buildPublicObjectUrl(config.publicBaseUrl, key),
  };
}

export async function createR2ReadUrl(key: string) {
  assertSafeObjectKey(key);

  const config = getRequiredConfig();
  const client = createR2Client(config);
  const command = new GetObjectCommand({
    Bucket: config.bucket,
    Key: key,
  });

  return getSignedUrl(client, command, { expiresIn: 60 * 10 });
}

type RotationDocument = {
  manifestUrl: string;
  rotation: SplatRotation;
  updatedAt: string;
};

type CameraDocument = {
  manifestUrl: string;
  camera: ViewerCameraPosition;
  updatedAt: string;
};

async function bodyToText(body: unknown) {
  if (!body) {
    return "";
  }

  const typed = body as { transformToString?: () => Promise<string> };
  if (typed.transformToString) {
    return typed.transformToString();
  }

  return "";
}

export async function getGlobalSplatRotation(manifestUrl: string): Promise<SplatRotation | null> {
  const config = getOptionalConfig();
  if (!config) {
    return null;
  }

  const client = createR2Client(config);

  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: rotationObjectKey(manifestUrl),
      }),
    );

    const raw = await bodyToText(response.Body);
    const parsed = JSON.parse(raw) as Partial<RotationDocument>;
    if (!parsed.rotation) {
      return null;
    }

    return sanitizeRotation(parsed.rotation);
  } catch {
    return null;
  }
}

export async function setGlobalSplatRotation(manifestUrl: string, rotation: SplatRotation) {
  const config = getRequiredConfig();
  const client = createR2Client(config);

  const payload: RotationDocument = {
    manifestUrl,
    rotation: sanitizeRotation(rotation),
    updatedAt: new Date().toISOString(),
  };

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: rotationObjectKey(manifestUrl),
      ContentType: "application/json",
      Body: JSON.stringify(payload),
    }),
  );
}

export async function getGlobalCameraPosition(manifestUrl: string): Promise<ViewerCameraPosition | null> {
  const config = getOptionalConfig();
  if (!config) {
    return null;
  }

  const client = createR2Client(config);

  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: cameraObjectKey(manifestUrl),
      }),
    );

    const raw = await bodyToText(response.Body);
    const parsed = JSON.parse(raw) as Partial<CameraDocument>;
    if (!parsed.camera) {
      return null;
    }

    return sanitizeCameraPosition(parsed.camera);
  } catch {
    return null;
  }
}

export async function setGlobalCameraPosition(manifestUrl: string, camera: ViewerCameraPosition) {
  const config = getRequiredConfig();
  const client = createR2Client(config);

  const payload: CameraDocument = {
    manifestUrl,
    camera: sanitizeCameraPosition(camera),
    updatedAt: new Date().toISOString(),
  };

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: cameraObjectKey(manifestUrl),
      ContentType: "application/json",
      Body: JSON.stringify(payload),
    }),
  );
}