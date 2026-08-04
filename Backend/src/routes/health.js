/**
 * Health check.
 *
 * Public and unauthenticated by design (load balancers need it), so it must
 * not leak anything useful to an attacker: no version numbers, no hostnames,
 * no connection strings, no dependency list.
 */
import { Router } from 'express';
import { isDBHealthy } from '../config/db.js';
import { sendSuccess } from '../utils/apiResponse.js';

const router = Router();

router.get('/health', (req, res) => {
  const dbUp = isDBHealthy();

  return sendSuccess(
    res,
    {
      status: dbUp ? 'ok' : 'degraded',
      db: dbUp ? 'up' : 'down',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    },
    { status: dbUp ? 200 : 503 },
  );
});

export default router;
