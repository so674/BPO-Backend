import { Router } from "express";

import { requireDeviceAuth } from "../middleware/deviceAuth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

import {
  ingestEvent,
  listEvents,
} from "../controllers/eventController.js"; // Ensure path matches your controller filename

const router = Router();

// ============================================================
// RFID DEVICE ENDPOINT
// ============================================================
router.post(
  "/ingest",
  // requireDeviceAuth,
  ingestEvent
);

// Alias in case devices hit root POST /api/attendance-events
router.post(
  "/",
  requireDeviceAuth,
  ingestEvent
);

// ============================================================
// HUMAN USER ENDPOINT
// ============================================================
router.get(
  "/",
  requireAuth,
  requireRole(
    "HR",
    "EMPLOYEE",
    "MANAGER",
    "CEO"
  ),
  listEvents
);

export default router;