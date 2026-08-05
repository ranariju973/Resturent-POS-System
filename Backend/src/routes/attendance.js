/**
 * Attendance routes. Every one of them is `user:manage`, which only admin
 * holds — these records decide what staff are paid, so they are not something
 * a cashier may read about their colleagues, let alone write.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  attendanceMonthSchema,
  attendanceDaySchema,
  markDaySchema,
  updateAttendanceSchema,
  idParamSchema,
} from '../validators/attendance.js';
import {
  getAttendanceDay,
  markAttendanceDay,
  getAttendanceMonth,
  updateAttendance,
  deleteAttendance,
} from '../controllers/attendanceController.js';

const router = Router();

router.use(requireAuth());
router.use(requirePermission(PERMISSIONS.USER_MANAGE));

router.get('/', validate({ query: attendanceMonthSchema }), getAttendanceMonth);

/**
 * `/day` is declared before `/:id` deliberately. They do not currently collide
 * — the methods differ — but a literal path that sits behind a parameterised
 * one is the classic way to make a route silently unreachable later.
 */
router.get('/day', validate({ query: attendanceDaySchema }), getAttendanceDay);
router.post('/day', validate({ body: markDaySchema }), markAttendanceDay);

router.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateAttendanceSchema }),
  updateAttendance,
);
router.delete('/:id', validate({ params: idParamSchema }), deleteAttendance);

export default router;
