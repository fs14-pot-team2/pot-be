import type { NextFunction, Request, Response } from "express";
import * as sitterService from "../services/sitter-service.js";
import { validateSitterListQuery } from "../validators/sitter-validator.js";

export async function getSitterListController(req: Request, res: Response, next: NextFunction) {
  try {
    const query = validateSitterListQuery(req.query);
    const result = await sitterService.getSitterList(query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
