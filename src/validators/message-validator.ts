import AppError from "../errors/app-error.js";
import { parseBigId } from "../utils/bigint.js";

export interface SendMessageInput {
  otherUserId: bigint;
  content: string;
}

export function validateConversationIdParam(value: unknown): bigint {
  const id = parseBigId(value);
  if (id === null) throw new AppError("INVALID_ID");
  return id;
}

export function validateOtherUserIdParam(value: unknown): bigint {
  const id = parseBigId(value);
  if (id === null) throw new AppError("INVALID_ID");
  return id;
}

// 글자 수는 공백 제외 기준(리뷰·견적 검증과 동일하게 length 사용), 저장은 원문 유지(trim 미적용)
function validateContent(content: unknown): string {
  if (typeof content !== "string") {
    throw new AppError("INVALID_MESSAGE_CONTENT");
  }

  const contentLength = content.replace(/\s/g, "").length;
  if (contentLength < 10 || contentLength > 1000) {
    throw new AppError("INVALID_MESSAGE_CONTENT");
  }

  return content;
}

export function validateSendMessageBody(body: unknown): SendMessageInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError("INVALID_REQUEST");
  }

  const { otherUserId, content } = body as Record<string, unknown>;

  if (otherUserId === undefined || content === undefined) {
    throw new AppError("INVALID_REQUEST");
  }

  const parsedOtherUserId = parseBigId(otherUserId);
  if (parsedOtherUserId === null) {
    throw new AppError("INVALID_ID");
  }

  return { otherUserId: parsedOtherUserId, content: validateContent(content) };
}
