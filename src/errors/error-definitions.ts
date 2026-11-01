export const ERROR_DEFINITIONS = {
  // 공통
  INVALID_REQUEST: {
    code: "INVALID_REQUEST",
    message: "요청 데이터가 올바르지 않습니다.",
    statusCode: 400,
  },
  INVALID_ID: {
    code: "INVALID_ID",
    message: "올바르지 않은 ID입니다.",
    statusCode: 400,
  },
  INVALID_PAGE_PARAMETER: {
    code: "INVALID_PAGE_PARAMETER",
    message: "페이지네이션 요청 값이 올바르지 않습니다.",
    statusCode: 400,
  },
  UNAUTHORIZED: {
    code: "UNAUTHORIZED",
    message: "로그인이 필요합니다.",
    statusCode: 401,
  },
  TOKEN_EXPIRED: {
    code: "TOKEN_EXPIRED",
    message: "액세스 토큰이 만료되었습니다.",
    statusCode: 401,
  },
  FORBIDDEN: {
    code: "FORBIDDEN",
    message: "접근 권한이 없습니다.",
    statusCode: 403,
  },
  RESOURCE_NOT_FOUND: {
    code: "RESOURCE_NOT_FOUND",
    message: "요청한 정보를 찾을 수 없습니다.",
    statusCode: 404,
  },
  INTERNAL_SERVER_ERROR: {
    code: "INTERNAL_SERVER_ERROR",
    message: "서버 내부 오류가 발생했습니다.",
    statusCode: 500,
  },

  // 인증 / 회원
  INVALID_USER_ROLE: {
    code: "INVALID_USER_ROLE",
    message: "올바르지 않은 사용자 역할입니다.",
    statusCode: 400,
  },
  INVALID_EMAIL_FORMAT: {
    code: "INVALID_EMAIL_FORMAT",
    message: "이메일 형식이 올바르지 않습니다.",
    statusCode: 400,
  },
  INVALID_PASSWORD_FORMAT: {
    code: "INVALID_PASSWORD_FORMAT",
    message: "비밀번호 형식이 올바르지 않습니다.",
    statusCode: 400,
  },
  INVALID_NICKNAME_FORMAT: {
    code: "INVALID_NICKNAME_FORMAT",
    message: "닉네임 형식이 올바르지 않습니다.",
    statusCode: 400,
  },
  EMAIL_ALREADY_EXISTS: {
    code: "EMAIL_ALREADY_EXISTS",
    message: "이미 사용 중인 이메일입니다.",
    statusCode: 409,
  },
  NICKNAME_ALREADY_EXISTS: {
    code: "NICKNAME_ALREADY_EXISTS",
    message: "이미 사용 중인 닉네임입니다.",
    statusCode: 409,
  },
  INVALID_CREDENTIALS: {
    code: "INVALID_CREDENTIALS",
    message: "이메일 또는 비밀번호가 올바르지 않습니다.",
    statusCode: 401,
  },
  // 개인정보 및 프로필 수정 페이지 진입시
  PASSWORD_MISMATCH: {
    code: "PASSWORD_MISMATCH",
    message: "비밀번호가 일치하지 않습니다.",
    statusCode: 401,
  },
  // 토큰 만료
  REFRESH_TOKEN_INVALID: {
    code: "REFRESH_TOKEN_INVALID",
    message: "유효하지 않은 리프레시 토큰입니다.",
    statusCode: 401,
  },

  // 프로필
  PROFILE_NOT_FOUND: {
    code: "PROFILE_NOT_FOUND",
    message: "프로필을 찾을 수 없습니다.",
    statusCode: 404,
  },
  SITTER_PROFILE_ALREADY_EXISTS: {
    code: "SITTER_PROFILE_ALREADY_EXISTS",
    message: "이미 등록된 프로필이 있습니다.",
    statusCode: 409,
  },
  INVALID_PROFILE_IMAGE: {
    code: "INVALID_PROFILE_IMAGE",
    message: "프로필 이미지가 올바르지 않습니다.",
    statusCode: 400,
  },
  INVALID_PROFILE_INTRODUCTION: {
    code: "INVALID_PROFILE_INTRODUCTION",
    message: "한 줄 소개가 올바르지 않습니다.",
    statusCode: 400,
  },
  INVALID_GENDER: {
    code: "INVALID_GENDER",
    message: "올바르지 않은 성별입니다.",
    statusCode: 400,
  },
  INVALID_PROFILE_DESCRIPTION: {
    code: "INVALID_PROFILE_DESCRIPTION",
    message: "상세 소개가 올바르지 않습니다.",
    statusCode: 400,
  },
  INVALID_SERVICE_TYPE: {
    code: "INVALID_SERVICE_TYPE",
    message: "올바르지 않은 서비스 유형입니다.",
    statusCode: 400,
  },
  SERVICE_TYPE_ALREADY_EXISTS: {
    code: "SERVICE_TYPE_ALREADY_EXISTS",
    message: "이미 등록된 서비스 유형입니다.",
    statusCode: 409,
  },
  TOO_MANY_SERVICE_TYPES: {
    code: "TOO_MANY_SERVICE_TYPES",
    message: "서비스 유형은 최대 2개까지 선택할 수 있습니다.",
    statusCode: 400,
  },
  INVALID_REGION: {
    code: "INVALID_REGION",
    message: "올바르지 않은 지역입니다.",
    statusCode: 400,
  },
  TOO_MANY_SERVICE_REGIONS: {
    code: "TOO_MANY_SERVICE_REGIONS",
    message: "서비스 지역은 최대 17개까지 선택할 수 있습니다.",
    statusCode: 400,
  },
  SERVICE_REGION_ALREADY_EXISTS: {
    code: "SERVICE_REGION_ALREADY_EXISTS",
    message: "이미 등록된 서비스 지역입니다.",
    statusCode: 409,
  },

  // 팟트너 조회
  SITTER_NOT_FOUND: {
    code: "SITTER_NOT_FOUND",
    message: "팟트너를 찾을 수 없습니다.",
    statusCode: 404,
  },
  // 팟트너가 팟트너를 조회할 수 없음
  SITTER_PROFILE_ACCESS_FORBIDDEN: {
    code: "SITTER_PROFILE_ACCESS_FORBIDDEN",
    message: "해당 팟트너 정보를 조회할 권한이 없습니다.",
    statusCode: 403,
  },

  // 돌봄 요청
  ACTIVE_CARE_REQUEST_ALREADY_EXISTS: {
    code: "ACTIVE_CARE_REQUEST_ALREADY_EXISTS",
    message: "이미 진행 중인 돌봄 요청이 있습니다.",
    statusCode: 409,
  },
  CARE_REQUEST_NOT_FOUND: {
    code: "CARE_REQUEST_NOT_FOUND",
    message: "돌봄 요청을 찾을 수 없습니다.",
    statusCode: 404,
  },
  INVALID_CARE_DATE: {
    code: "INVALID_CARE_DATE",
    message: "돌봄 일정이 올바르지 않습니다.",
    statusCode: 400,
  },
  CARE_REQUEST_EDIT_NOT_ALLOWED: {
    code: "CARE_REQUEST_EDIT_NOT_ALLOWED",
    message: "견적을 받은 돌봄 요청은 수정할 수 없습니다.",
    statusCode: 409,
  },
  CARE_REQUEST_STATUS_NOT_EDITABLE: {
    code: "CARE_REQUEST_STATUS_NOT_EDITABLE",
    message: "진행 중인 돌봄 요청만 수정할 수 있습니다.",
    statusCode: 409,
  },
  CARE_REQUEST_ALREADY_CANCELED: {
    code: "CARE_REQUEST_ALREADY_CANCELED",
    message: "이미 취소된 돌봄 요청입니다.",
    statusCode: 409,
  },
  REQUEST_ALREADY_IGNORED: {
    code: "REQUEST_ALREADY_IGNORED",
    message: "이미 숨김 처리한 요청입니다.",
    statusCode: 409,
  },
  REQUEST_IGNORE_NOT_ALLOWED: {
    code: "REQUEST_IGNORE_NOT_ALLOWED",
    message: "지정 요청은 숨김 처리할 수 없습니다.",
    statusCode: 409,
  },

  // 지정 요청
  DESIGNATED_REQUEST_NOT_FOUND: {
    code: "DESIGNATED_REQUEST_NOT_FOUND",
    message: "지정 요청을 찾을 수 없습니다.",
    statusCode: 404,
  },
  REJECTED_REQUEST_NOT_FOUND: {
    code: "REJECTED_REQUEST_NOT_FOUND",
    message: "반려 요청을 찾을 수 없습니다.",
    statusCode: 404,
  },
  DESIGNATED_REQUEST_ALREADY_EXISTS: {
    code: "DESIGNATED_REQUEST_ALREADY_EXISTS",
    message: "이미 해당 팟트너에게 지정 요청을 보냈습니다.",
    statusCode: 409,
  },
  DESIGNATED_REQUEST_LIMIT_EXCEEDED: {
    code: "DESIGNATED_REQUEST_LIMIT_EXCEEDED",
    message: "지정 요청은 최대 3명에게 보낼 수 있습니다.",
    statusCode: 409,
  },
  SITTER_ALREADY_SENT_QUOTE: {
    code: "SITTER_ALREADY_SENT_QUOTE",
    message: "이미 견적을 보낸 팟트너에게는 지정 요청을 보낼 수 없습니다.",
    statusCode: 409,
  },
  ACTIVE_CARE_REQUEST_NOT_FOUND: {
    code: "ACTIVE_CARE_REQUEST_NOT_FOUND",
    message: "활성 돌봄 요청이 없어 지정 요청을 보낼 수 없습니다.",
    statusCode: 409,
  },
  DESIGNATED_REQUEST_ALREADY_REJECTED: {
    code: "DESIGNATED_REQUEST_ALREADY_REJECTED",
    message: "이미 반려된 지정 요청입니다.",
    statusCode: 409,
  },
  INVALID_REJECTION_REASON: {
    code: "INVALID_REJECTION_REASON",
    message: "반려 사유는 공백을 제외하고 10자 이상 100자 이하로 입력해주세요.",
    statusCode: 400,
  },

  // 견적
  QUOTE_ACCESS_FORBIDDEN: {
    code: "QUOTE_ACCESS_FORBIDDEN",
    message: "해당 견적을 조회할 권한이 없습니다.",
    statusCode: 403,
  },
  QUOTE_NOT_FOUND: {
    code: "QUOTE_NOT_FOUND",
    message: "견적을 찾을 수 없습니다.",
    statusCode: 404,
  },
  QUOTE_ALREADY_EXISTS: {
    code: "QUOTE_ALREADY_EXISTS",
    message: "이미 해당 요청에 견적을 보냈습니다.",
    statusCode: 409,
  },
  GENERAL_QUOTE_LIMIT_EXCEEDED: {
    code: "GENERAL_QUOTE_LIMIT_EXCEEDED",
    message: "일반 견적은 최대 5건까지 받을 수 있습니다.",
    statusCode: 409,
  },
  INVALID_QUOTE_PRICE: {
    code: "INVALID_QUOTE_PRICE",
    message: "견적가는 1,000이상 100,000,000원 미만의 정수로 입력해주세요.",
    statusCode: 400,
  },
  INVALID_QUOTE_COMMENT: {
    code: "INVALID_QUOTE_COMMENT",
    message: "견적 내용은 공백을 제외하고 10자 이상 1000자 이하로 입력해주세요.",
    statusCode: 400,
  },
  QUOTE_ALREADY_CONFIRMED: {
    code: "QUOTE_ALREADY_CONFIRMED",
    message: "이미 확정된 견적입니다.",
    statusCode: 409,
  },
  QUOTE_EDIT_NOT_ALLOWED: {
    code: "QUOTE_EDIT_NOT_ALLOWED",
    message: "현재 상태 돌봄 요청에서는 견적을 보내거나 수정할 수 없습니다.",
    statusCode: 409,
  },
  CARE_REQUEST_ALREADY_MATCHED: {
    code: "CARE_REQUEST_ALREADY_MATCHED",
    message: "이미 다른 견적이 확정된 돌봄 요청입니다.",
    statusCode: 409,
  },

  // 리뷰
  REVIEW_NOT_FOUND: {
    code: "REVIEW_NOT_FOUND",
    message: "리뷰를 찾을 수 없습니다.",
    statusCode: 404,
  },
  REVIEW_ALREADY_EXISTS: {
    code: "REVIEW_ALREADY_EXISTS",
    message: "이미 작성한 리뷰가 있습니다.",
    statusCode: 409,
  },
  REVIEW_ACCESS_FORBIDDEN: {
    code: "REVIEW_ACCESS_FORBIDDEN",
    message: "해당 리뷰를 수정하거나 삭제할 권한이 없습니다.",
    statusCode: 403,
  },
  INVALID_REVIEW_RATING: {
    code: "INVALID_REVIEW_RATING",
    message: "별점은 1점 이상 5점 이하의 정수로 입력해주세요.",
    statusCode: 400,
  },
  INVALID_REVIEW_CONTENT: {
    code: "INVALID_REVIEW_CONTENT",
    message: "리뷰 내용은 공백을 제외하고 1자 이상 150자 이하로 입력해주세요.",
    statusCode: 400,
  },
  REVIEW_NOT_WRITABLE: {
    code: "REVIEW_NOT_WRITABLE",
    message: "아직 리뷰를 작성할 수 없습니다.",
    statusCode: 409,
  },
} as const;

export type ErrorCode = keyof typeof ERROR_DEFINITIONS;
