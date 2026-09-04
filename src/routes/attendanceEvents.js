import { Router } from "express";

import { requireDeviceAuth } from "../middleware/deviceAuth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

import {
  ingestEvent,
  listEvents,
} from "../controllers/eventController.js";

const router = Router();


// ============================================================
// RFID DEVICE ENDPOINT
// ============================================================
//
// RFID readers / adapters authenticate using:
// X-Device-API-Key
//
// They NEVER use a human JWT.
//
// Example:
//
// POST /attendance-events
// X-Device-API-Key: <DEVICE_API_KEY>
//
// ============================================================

router.post(
  "/",
  requireDeviceAuth,
  ingestEvent,
);


// ============================================================
// HUMAN USER ENDPOINT
// ============================================================
//
// HR       → can view all events
// MANAGER  → can view team/own events
// CEO      → can view all events
// EMPLOYEE → can view own events
//
// listEvents() applies the detailed employee/team
// filtering based on req.user.
// ============================================================

router.get(
  "/",
  requireAuth,
  requireRole(
    "HR",
    "EMPLOYEE",
    "MANAGER",
    "CEO",
  ),
  listEvents,
);


export default router;