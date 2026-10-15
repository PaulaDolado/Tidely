import { Response, NextFunction } from "express";
import { AuthRequest } from "../middlewares/authMiddleware";
import * as syncService from "../services/syncService";

export async function pull(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const since = req.query.since ? new Date(req.query.since as string) : undefined;
    const result = await syncService.pull(userId, since);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function push(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const result = await syncService.push(userId, req.body, res.locals.syncRejected ?? []);
    res.json(result);
  } catch (error) {
    next(error);
  }
}
