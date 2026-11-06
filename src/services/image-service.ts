import { randomUUID } from "node:crypto";

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "../config/env.js";
import { s3Client } from "../config/s3.js";
import { ALLOWED_IMAGE_TYPES, type PresignedUrlInput } from "../validators/image-validator.js";
import { profileImageKeyPrefix, type ProfileImageRole } from "../utils/profile-image.js";

const PRESIGNED_URL_EXPIRES_IN = 300;

export async function createProfileImagePresignedUrl(
  user: { id: bigint; role: ProfileImageRole },
  { contentType, fileSize }: PresignedUrlInput,
) {
  const extension = ALLOWED_IMAGE_TYPES[contentType];
  const objectKey = `${profileImageKeyPrefix(user.role, user.id)}${randomUUID()}.${extension}`;

  const command = new PutObjectCommand({
    Bucket: env.profileImageS3Bucket,
    Key: objectKey,
    ContentType: contentType,
    ContentLength: fileSize,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, {
    expiresIn: PRESIGNED_URL_EXPIRES_IN,
    signableHeaders: new Set(["content-type", "content-length"]),
  });

  const baseUrl = env.profileImageCloudfrontUrl.replace(/\/+$/, "");

  return {
    uploadUrl,
    imageUrl: `${baseUrl}/${objectKey}`,
    expiresIn: PRESIGNED_URL_EXPIRES_IN,
  };
}
