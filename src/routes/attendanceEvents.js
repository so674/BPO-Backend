import { Router } from "express";
import { requireDeviceAuth } from "../middleware/deviceAuth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { ingestEvent, listEvents } from "../controllers/eventController.js";

const router = Router();

// Reader/adapter-facing endpoint — device credentials, NOT a human JWT (Section 22.2)
router.post("/", requireDeviceAuth, ingestEvent);

// Human-facing: view the raw event stream (HR, and employees viewing their own via a filter)
router.get("/", requireAuth, requireRole("HR", "MANAGER", "CEO"), listEvents);

export default router;
