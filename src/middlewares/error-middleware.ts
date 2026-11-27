import type { ErrorRequestHandler } from "express";
import AppError from "../errors/app-error.js";
import { ERROR_DEFINITIONS } from "../errors/error-definitions.js";

export const errorMiddleware: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  if (error instanceof AppError) {
    response.status(error.statusCode).json({
      code: error.code,
      message: error.message,
    });
    return;
  }

  if (
    error instanceof SyntaxError &&
    "type" in error &&
    error.type === "entity.parse.failed" &&
    "status" in error &&
    error.status === 400
  ) {
    const definition = ERROR_DEFINITIONS.INVALID_REQUEST;

    response.status(definition.statusCode).json({
      code: definition.code,
      message: definition.message,
    });
    return;
  }

  console.error(error);

  const definition = ERROR_DEFINITIONS.INTERNAL_SERVER_ERROR;

  response.status(definition.statusCode).json({
    code: definition.code,
    message: definition.message,
  });
};
