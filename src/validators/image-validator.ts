import AppError from "../errors/app-error.js";

export const ALLOWED_IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type ImageContentType = keyof typeof ALLOWED_IMAGE_TYPES;

export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

export interface PresignedUrlInput {
  contentType: ImageContentType;
  fileSize: number;
}

function isImageContentType(value: unknown): value is ImageContentType {
  return typeof value === "string" && Object.keys(ALLOWED_IMAGE_TYPES).includes(value);
}

export function validatePresignedUrlRequest(body: unknown): PresignedUrlInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError("INVALID_REQUEST");
  }

  const { contentType, fileSize } = body as Record<string, unknown>;

  if (!isImageContentType(contentType)) {
    throw new AppError("INVALID_PROFILE_IMAGE");
  }
  if (
    typeof fileSize !== "number" ||
    !Number.isInteger(fileSize) ||
    fileSize <= 0 ||
    fileSize > MAX_IMAGE_SIZE
  ) {
    throw new AppError("INVALID_PROFILE_IMAGE");
  }

  return { contentType, fileSize };
}
