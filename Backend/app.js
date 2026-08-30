/**
 * Express application wiring.
 *
 * Order matters: security headers and the request id come before anything
 * that can log or fail, body parsing comes before routes, and the 404 +
 * error handlers are always last.
 *
 * Rate limiting, mongo-sanitize and the auth/RBAC middleware land in later
 * phases and slot in where marked.
 */
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';

import { env } from './src/config/env.js';
import { requestId } from './src/middleware/requestId.js';
import { notFoundHandler, errorHandler } from './src/middleware/errorHandler.js';
import { httpLogStream } from './src/utils/logger.js';
import { ApiError } from './src/utils/apiResponse.js';
import { sanitizeRequest, limitQueryComplexity } from './src/middleware/sanitize.js';
import { apiLimiter } from './src/middleware/rateLimit.js';
import healthRoutes from './src/routes/health.js';
import authRoutes from './src/routes/auth.js';
import terminalRoutes from './src/routes/terminal.js';
import tenantRoutes from './src/routes/tenants.js';
import deviceRoutes from './src/routes/devices.js';
import menuRoutes from './src/routes/menu.js';
import tableRoutes from './src/routes/tables.js';
import orderRoutes from './src/routes/orders.js';
import kitchenRoutes from './src/routes/kitchen.js';
import customerRoutes from './src/routes/customers.js';
import dashboardRoutes from './src/routes/dashboard.js';
import reportRoutes from './src/routes/reports.js';
import employeeRoutes from './src/routes/employees.js';
import invoiceRoutes from './src/routes/invoice.js';
import settingsRoutes from './src/routes/settings.js';
import attendanceRoutes from './src/routes/attendance.js';
import payrollRoutes from './src/routes/payroll.js';
import auditRoutes from './src/routes/audit.js';

const app = express();

// Behind a reverse proxy (nginx, Render, Railway, Fly) req.ip must come from
// X-Forwarded-For or every client looks like the proxy — which would make
// per-IP rate limiting in Phase 4 useless. Trust exactly one hop.
app.set('trust proxy', 1);

// Do not advertise the framework.
app.disable('x-powered-by');

// Reject ?a=1&a=2 style array/object injection in query strings.
app.set('query parser', 'simple');

app.use(requestId);

// --- Security headers ------------------------------------------------------
// This is a JSON API: it serves no HTML, so the CSP can deny everything by
// default. No wildcard sources anywhere.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        scriptSrc: ["'none'"],
        styleSrc: ["'none'"],
        imgSrc: ["'none'"],
        connectSrc: ["'none'"],
        fontSrc: ["'none'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'none'"],
        frameSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    // Helmet defaults this to SAMEORIGIN. A JSON API should never be framed at
    // all, so DENY. The CSP's `frame-ancestors 'none'` says the same thing to
    // modern browsers; this is the legacy header for the ones that ignore it.
    frameguard: { action: 'deny' },
    // HSTS only makes sense over TLS, which terminates at the proxy in prod.
    hsts: env.isProd
      ? { maxAge: 63_072_000, includeSubDomains: true, preload: true }
      : false,
    // X-Content-Type-Options: nosniff, X-Frame-Options: DENY and friends are
    // on by default and left as-is.
  }),
);

// Helmet does not set this one. A JSON API has no use for camera, microphone,
// geolocation or payment APIs, so deny them outright — it costs nothing and
// shrinks what an injected script could ask the browser for.
app.use((_req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  );
  next();
});

// --- CORS ------------------------------------------------------------------
// Exact-match allow-list from env. The origin callback never reflects an
// arbitrary Origin header back, which would defeat CORS entirely once
// credentials: true is set for the refresh cookie.
app.use(
  cors({
    origin(origin, callback) {
      // No Origin header: same-origin, curl, or a server-to-server call.
      if (!origin) return callback(null, true);
      if (env.corsOrigins.includes(origin)) return callback(null, true);
      return callback(ApiError.forbidden('Origin not allowed'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  }),
);

// --- Body parsing ----------------------------------------------------------
// Capped well below the default 100kb-per-field free-for-all. The larger
// limit for menu image uploads is applied on that route only (Phase 5),
// via multer — not globally.
app.use(express.json({ limit: env.JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: false, limit: env.JSON_BODY_LIMIT }));
app.use(cookieParser());

app.use(compression());

// --- Request logging -------------------------------------------------------
// Piped through winston so the redaction rules apply. The 'dev' format is
// noisy and coloured; production uses a fixed field set with no request body.
if (!env.isTest) {
  morgan.token('id', (req) => req.id);
  app.use(
    morgan(
      env.isProd
        ? ':id :remote-addr :method :url :status :response-time ms'
        : ':method :url :status :response-time ms',
      { stream: httpLogStream },
    ),
  );
}

// --- Traffic control and input sanitising ---------------------------------
// Mounted on /api rather than globally so they cost nothing on any static or
// non-API route added later.
//
// Order matters: sanitise first, then rate-limit. A request carrying a Mongo
// operator should be scrubbed and logged even if it is about to be throttled,
// because that log line is how an injection probe becomes visible.
app.use('/api', sanitizeRequest);
app.use('/api', limitQueryComplexity({ maxKeys: 32 }));
app.use('/api', apiLimiter);

// --- Routes ----------------------------------------------------------------
// Health sits above the limiter's practical concern but inside /api, so it is
// subject to the same ceiling. That is intentional: an unbounded health probe
// is still a way to spend the server's time.
app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);
// Public: the login screen names the restaurant before anyone signs in.
// See routes/terminal.js for why it is a separate file.
app.use('/api/auth/terminal', terminalRoutes);
app.use('/api/tenants', tenantRoutes);
/*
 * Under /api/auth deliberately — see the header of routes/devices.js. The
 * device cookie is scoped to that path, and these handlers have to be able to
 * read it, not only set it.
 */
app.use('/api/auth/devices', deviceRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/tables', tableRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/kitchen', kitchenRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/employees', employeeRoutes);
// Public: a customer opening a link has no session. See routes/invoice.js.
app.use('/api/invoice', invoiceRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/audit-logs', auditRoutes);

// --- Fallbacks (must stay last) -------------------------------------------
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
