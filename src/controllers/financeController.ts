import { Response, NextFunction } from "express";
import { AuthRequest } from "../middlewares/authMiddleware";
import * as financeService from "../services/financeService";
import * as budgetService from "../services/budgetService";

export async function getMonthlyBalance(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const month = parseInt(req.params.month, 10);
    const year = parseInt(req.params.year, 10);
    const result = await financeService.getMonthlyBalance(userId, month, year);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function getTotalBalance(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await financeService.getTotalBalance(req.userId as number);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function getAvailableSurplus(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const month = parseInt(req.params.month, 10);
    const year = parseInt(req.params.year, 10);
    const result = await financeService.getAvailableSurplus(userId, month, year);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function getAnnualBalance(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const year = parseInt(req.params.year, 10);
    const result = await financeService.getAnnualBalance(userId, year);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function listTransactions(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const { type, category, from, to, page, limit } = req.query as unknown as {
      type?: string;
      category?: string;
      from?: string;
      to?: string;
      page: number;
      limit: number;
    };
    const result = await financeService.listTransactions(userId, { type, category, from, to, page, limit });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function exportTransactions(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const { from, to } = req.query as unknown as { from: string; to: string };
    const transactions = await financeService.exportTransactions(userId, from, to);
    res.json({ transactions });
  } catch (error) {
    next(error);
  }
}

export async function createTransaction(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const transaction = await financeService.createTransaction(userId, req.body);
    res.status(201).json(transaction);
  } catch (error) {
    next(error);
  }
}

export async function updateTransaction(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const id = parseInt(req.params.id, 10);
    const transaction = await financeService.updateTransaction(userId, id, req.body);
    res.json(transaction);
  } catch (error) {
    next(error);
  }
}

export async function deleteTransaction(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const id = parseInt(req.params.id, 10);
    await financeService.deleteTransaction(userId, id);
    res.json({ message: "Transacción eliminada" });
  } catch (error) {
    next(error);
  }
}

export async function listSavingsGoals(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const { type } = req.query as unknown as { type?: string };
    const goals = await financeService.listSavingsGoals(userId, { type });
    res.json({ savingsGoals: goals });
  } catch (error) {
    next(error);
  }
}

export async function createSavingsGoal(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const goal = await financeService.createSavingsGoal(userId, req.body);
    res.status(201).json(goal);
  } catch (error) {
    next(error);
  }
}

export async function updateSavingsGoal(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const id = parseInt(req.params.id, 10);
    const goal = await financeService.updateSavingsGoal(userId, id, req.body);
    res.json(goal);
  } catch (error) {
    next(error);
  }
}

export async function deleteSavingsGoal(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const id = parseInt(req.params.id, 10);
    await financeService.deleteSavingsGoal(userId, id);
    res.json({ message: "Meta de ahorro eliminada" });
  } catch (error) {
    next(error);
  }
}

export async function contributeToSavingsGoal(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const id = parseInt(req.params.id, 10);
    const goal = await financeService.contributeToSavingsGoal(userId, id, req.body.amount);
    res.status(201).json(goal);
  } catch (error) {
    next(error);
  }
}

export async function getAnalytics(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const { month, year } = req.query as unknown as { month?: number; year?: number };
    const result = await financeService.getAnalytics(userId, month, year);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

// --- Presupuesto ---

export async function getBudgetSummary(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId as number;
    const month = parseInt(req.params.month, 10);
    const year = parseInt(req.params.year, 10);
    res.json(await budgetService.getBudgetSummary(userId, month, year));
  } catch (error) {
    next(error);
  }
}

export async function listBudgetCategories(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await budgetService.listBudgetCategories(req.userId as number));
  } catch (error) {
    next(error);
  }
}

export async function createBudgetCategory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(201).json(await budgetService.createBudgetCategory(req.userId as number, req.body));
  } catch (error) {
    next(error);
  }
}

export async function updateBudgetCategory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await budgetService.updateBudgetCategory(req.userId as number, parseInt(req.params.id, 10), req.body));
  } catch (error) {
    next(error);
  }
}

export async function deleteBudgetCategory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await budgetService.deleteBudgetCategory(req.userId as number, parseInt(req.params.id, 10));
    res.json({ message: "Categoría eliminada" });
  } catch (error) {
    next(error);
  }
}
