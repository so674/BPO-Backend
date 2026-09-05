import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  listDevices,
  registerDevice,
  getDeviceHealth,
  heartbeat,
  ingestEvent,
} from "../controllers/deviceController.js";

const router = Router();

// Device management routes
router.get("/", requireAuth, requireRole("HR", "CEO", "ADMIN"), listDevices);
router.get("/health", requireAuth, requireRole("HR", "ADMIN"), getDeviceHealth);
router.post("/", requireAuth, requireRole("HR", "ADMIN"), registerDevice);

// Hardware device communication endpoints
router.post("/heartbeat", requireAuth, heartbeat);
router.post("/events/ingest", requireAuth, ingestEvent);

export default router;