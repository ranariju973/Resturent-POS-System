/**
 * Audit-log routes. Read-only, admin-only.
 *
 * `audit:view` rather than `reports:view`: checking margins and checking who
 * voided last Tuesday's bills are different acts, and separating them means a
 * future "accountant" role could get one without the other.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { listAuditSchema } from '../validators/audit.js';
import { listAuditLogs, auditSummary } from '../controllers/auditController.js';

const router = Router();

router.use(requireAuth());
router.use(requirePermission(PERMISSIONS.AUDIT_VIEW));

router.get('/summary', auditSummary);
router.get('/', validate({ query: listAuditSchema }), listAuditLogs);

export default router;
