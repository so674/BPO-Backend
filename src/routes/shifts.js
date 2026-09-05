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

// Shift management
router.get("/", requireRole("HR", "CEO", "ADMIN"), listShifts);
router.get("/:id", requireRole("HR", "CEO", "ADMIN"), getShiftById);
router.post("/", requireRole("HR", "ADMIN"), createShift);
router.patch("/:id", requireRole("HR", "ADMIN"), updateShiftGrace);

// Employee shift assignment
router.post("/assign", requireRole("HR", "ADMIN"), assignShift);

export default router;