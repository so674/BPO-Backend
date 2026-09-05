import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  applyLeave,
  listLeaves,
  updateLeaveStatus,
  applyOvertime,
  listOvertime,
  updateOvertimeStatus,
} from "../controllers/leaveOvertimeController.js";

const router = Router();

router.use(requireAuth);

// Leave Endpoints
router.post("/leaves", applyLeave);
router.get("/leaves", listLeaves);

// ---> ADD / VERIFY THIS LINE HERE <---
router.patch("/leaves/:id/status", requireRole("HR", "CEO", "ADMIN", "MANAGER"), updateLeaveStatus);

// Overtime Endpoints
router.post("/overtime", applyOvertime);
router.get("/overtime", listOvertime);
router.patch("/overtime/:id/status", requireRole("HR", "CEO", "ADMIN", "MANAGER"), updateOvertimeStatus);

export default router;