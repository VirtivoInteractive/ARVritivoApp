import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export const UPLOAD_AUTH_COOKIE = "upload_portal_auth";

function getUploadPin() {
  return process.env.UPLOAD_PORTAL_PIN?.trim() || null;
}

function createTokenFromPin(pin: string) {
  return createHmac("sha256", pin).update("arvritivo-upload-portal").digest("hex");
}

export function uploadPinIsConfigured() {
  return getUploadPin() !== null;
}

export function createUploadAuthCookieValue() {
  const pin = getUploadPin();
  if (!pin) {
    throw new Error("UPLOAD_PORTAL_PIN is not configured.");
  }

  return `v1.${createTokenFromPin(pin)}`;
}

export function verifyUploadPin(pin: string) {
  const configuredPin = getUploadPin();
  if (!configuredPin) {
    return false;
  }

  return pin === configuredPin;
}

export function isUploadAuthCookieValid(cookieValue: string | undefined) {
  const configuredPin = getUploadPin();
  if (!configuredPin || !cookieValue) {
    return false;
  }

  const expected = `v1.${createTokenFromPin(configuredPin)}`;
  const valueBuffer = Buffer.from(cookieValue);
  const expectedBuffer = Buffer.from(expected);

  if (valueBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(valueBuffer, expectedBuffer);
}