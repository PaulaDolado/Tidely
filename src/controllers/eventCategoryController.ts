import { Response, NextFunction } from "express";
import { AuthRequest } from "../middlewares/authMiddleware";
import * as eventCategoryService from "../services/eventCategoryService";

export async function listCategories(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const result = await eventCategoryService.listCategories(userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function createCategory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const category = await eventCategoryService.createCategory(userId, req.body.label, req.body.color);
    res.status(201).json(category);
  } catch (error) {
    next(error);
  }
}

export async function updateCategory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const id = parseInt(req.params.id, 10);
    const category = await eventCategoryService.updateCategory(userId, id, req.body);
    res.json(category);
  } catch (error) {
    next(error);
  }
}

export async function deleteCategory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const id = parseInt(req.params.id, 10);
    await eventCategoryService.deleteCategory(userId, id);
    res.json({ message: "Categoría eliminada" });
  } catch (error) {
    next(error);
  }
}
