import { ERROR_DEFINITIONS, type ErrorCode } from "./error-definitions.js";

export default class AppError extends Error {
  statusCode: number;
  code: ErrorCode;

  constructor(code: ErrorCode) {
    const definition = ERROR_DEFINITIONS[code];

    super(definition.message);

    this.name = "AppError";
    this.statusCode = definition.statusCode;
    this.code = code;
  }
}
