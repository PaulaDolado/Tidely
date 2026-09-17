import { Response, NextFunction } from "express";
import { AuthRequest } from "../middlewares/authMiddleware";
import * as scheduleService from "../services/scheduleService";

export async function listSchedules(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const result = await scheduleService.listSchedules(userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function createSchedule(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const schedule = await scheduleService.createSchedule(userId, req.body.name);
    res.status(201).json(schedule);
  } catch (error) {
    next(error);
  }
}

export async function updateSchedule(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const id = parseInt(req.params.id, 10);
    const schedule = await scheduleService.updateSchedule(userId, id, req.body);
    res.json(schedule);
  } catch (error) {
    next(error);
  }
}

export async function deleteSchedule(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const id = parseInt(req.params.id, 10);
    await scheduleService.deleteSchedule(userId, id);
    res.json({ message: "Horario eliminado" });
  } catch (error) {
    next(error);
  }
}

export async function moveSchedule(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const id = parseInt(req.params.id, 10);
    await scheduleService.moveSchedule(userId, id, req.body.direction);
    res.json({ message: "Horario movido" });
  } catch (error) {
    next(error);
  }
}

export async function listRows(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const id = parseInt(req.params.id, 10);
    const result = await scheduleService.listRows(userId, id);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function addRow(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const id = parseInt(req.params.id, 10);
    const row = await scheduleService.addRow(userId, id, req.body.timeLabel);
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
}

export async function updateRow(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const id = parseInt(req.params.id, 10);
    const rowId = parseInt(req.params.rowId, 10);
    const row = await scheduleService.updateRow(userId, id, rowId, req.body);
    res.json(row);
  } catch (error) {
    next(error);
  }
}

export async function deleteRow(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const id = parseInt(req.params.id, 10);
    const rowId = parseInt(req.params.rowId, 10);
    await scheduleService.deleteRow(userId, id, rowId);
    res.json({ message: "Fila eliminada" });
  } catch (error) {
    next(error);
  }
}

export async function moveRow(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const id = parseInt(req.params.id, 10);
    const rowId = parseInt(req.params.rowId, 10);
    await scheduleService.moveRow(userId, id, rowId, req.body.direction);
    res.json({ message: "Fila movida" });
  } catch (error) {
    next(error);
  }
}
