import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getHrDashboard, getEmployeeDashboard } from "../controllers/dashboardController.js";

const router = Router();

router.use(requireAuth);

router.get("/dashboard/hr", requireRole("HR", "CEO", "ADMIN", "MANAGER"), getHrDashboard);
router.get("/dashboard/employee", getEmployeeDashboard);

export default router;