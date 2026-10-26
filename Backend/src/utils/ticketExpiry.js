import mongoose from 'mongoose';
import { serviceWindow } from './date.js';

/** The placement bound also hides legacy tickets before their expiry backfill. */
export function liveTicketFilter(now = new Date()) {
  return {
    placedAt: mongoose.trusted({ $gte: serviceWindow(now).serviceStart, $lte: now }),
    $or: [
      { expiresAt: mongoose.trusted({ $gt: now }) },
      { expiresAt: mongoose.trusted({ $exists: false }) },
    ],
  };
}
