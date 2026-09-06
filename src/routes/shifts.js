import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  listShifts,
  getShiftById,
  createShift,
  updateShiftGrace,
  assignShift,
} from "../controllers/shiftController.js";

const router = Router();

router.use(requireAuth);

// 1. Static & List routes (Allow MANAGER so they can view shifts for their team)
router.get("/", requireRole("HR", "CEO", "ADMIN", "MANAGER"), listShifts);
router.post("/", requireRole("HR", "ADMIN"), createShift);
router.post("/assign", requireRole("HR", "ADMIN"), assignShift);

// 2. Parametrized routes MUST stay at the bottom
router.get("/:id", requireRole("HR", "CEO", "ADMIN", "MANAGER"), getShiftById);
router.patch("/:id", requireRole("HR", "ADMIN"), updateShiftGrace);

export default router;