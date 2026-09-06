import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  listCorrections,
  requestCorrection,
  decideCorrection,
} from "../controllers/correctionController.js";

const router = Router();

// 1. Require authentication for all correction endpoints
router.use(requireAuth);

// 2. Allow HR, ADMIN, and CEO to view the list of corrections
router.get("/", requireRole("HR", "ADMIN", "CEO"), listCorrections);

// 3. Allow HR and ADMIN to request or decide on corrections
router.post("/", requireRole("HR", "ADMIN"), requestCorrection);
router.post("/:id/decision", requireRole("HR", "ADMIN"), decideCorrection);

export default router;