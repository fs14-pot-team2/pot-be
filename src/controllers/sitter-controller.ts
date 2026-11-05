import type { NextFunction, Request, Response } from "express";
import * as sitterService from "../services/sitter-service.js";
import { validateSitterIdParam, validateSitterListQuery } from "../validators/sitter-validator.js";

export async function getSitterListController(req: Request, res: Response, next: NextFunction) {
  try {
    const query = validateSitterListQuery(req.query);
    const result = await sitterService.getSitterList(query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getSitterDetailController(req: Request, res: Response, next: NextFunction) {
  try {
    const sitterId = validateSitterIdParam(req.params.sitterId);
    const viewer = req.user ? { id: req.user.id, role: req.user.role } : undefined;
    const result = await sitterService.getSitterDetail(sitterId, viewer);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
