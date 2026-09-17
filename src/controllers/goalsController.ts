import { Response, NextFunction } from "express";
import { AuthRequest } from "../middlewares/authMiddleware";
import * as goalsService from "../services/goalsService";

export async function listGoals(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const { status, page, limit } = req.query as unknown as {
      status?: "active" | "completed" | "expired" | "all";
      page: number;
      limit: number;
    };
    const result = await goalsService.listGoals(userId, status ?? "active", page, limit);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function getGoal(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const id = parseInt(req.params.id, 10);
    const goal = await goalsService.getGoalDetail(userId, id);
    res.json(goal);
  } catch (error) {
    next(error);
  }
}

export async function createGoal(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const goal = await goalsService.createGoal(userId, req.body);
    res.status(201).json(goal);
  } catch (error) {
    next(error);
  }
}

export async function updateGoal(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const id = parseInt(req.params.id, 10);
    const goal = await goalsService.updateGoal(userId, id, req.body);
    res.json(goal);
  } catch (error) {
    next(error);
  }
}

export async function deleteGoal(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const id = parseInt(req.params.id, 10);
    await goalsService.deleteGoal(userId, id);
    res.json({ message: "Meta eliminada" });
  } catch (error) {
    next(error);
  }
}

export async function registerProgress(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const id = parseInt(req.params.id, 10);
    const result = await goalsService.registerProgress(userId, id, req.body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function updateProgress(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const goalId = parseInt(req.params.id, 10);
    const progressId = parseInt(req.params.progressId, 10);
    const result = await goalsService.updateProgress(userId, goalId, progressId, req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function deleteProgress(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const goalId = parseInt(req.params.id, 10);
    const progressId = parseInt(req.params.progressId, 10);
    await goalsService.deleteProgress(userId, goalId, progressId);
    res.json({ message: "Registro de progreso eliminado" });
  } catch (error) {
    next(error);
  }
}

export async function getAnalytics(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const id = parseInt(req.params.id, 10);
    const analytics = await goalsService.getGoalAnalytics(userId, id);
    res.json(analytics);
  } catch (error) {
    next(error);
  }
}
