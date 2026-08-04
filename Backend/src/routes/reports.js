/**
 * Report routes. Every one of them is `reports:view`, which only admin holds.
 *
 * This is the hard boundary from the original brief: a cashier is not merely
 * shown no Reports tab, the routes themselves refuse them. Guessing the URL
 * achieves nothing.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  dailyReportSchema,
  monthlyReportSchema,
  rangeSchema,
  expenseListSchema,
  createExpenseSchema,
  idParamSchema,
} from '../validators/reports.js';
import {
  dailyReport,
  monthlyReport,
  profitAndLoss,
  listExpenses,
  createExpense,
  deleteExpense,
} from '../controllers/reportController.js';

const router = Router();

router.use(requireAuth());
router.use(requirePermission(PERMISSIONS.REPORTS_VIEW));

router.get('/daily', validate({ query: dailyReportSchema }), dailyReport);
router.get('/monthly', validate({ query: monthlyReportSchema }), monthlyReport);
router.get('/pnl', validate({ query: rangeSchema }), profitAndLoss);

router.get('/expenses', validate({ query: expenseListSchema }), listExpenses);
router.post('/expenses', validate({ body: createExpenseSchema }), createExpense);
router.delete('/expenses/:id', validate({ params: idParamSchema }), deleteExpense);

export default router;
