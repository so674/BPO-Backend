import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  getDailyReport,
  getMonthlySummary,
  exportCsvReport,
} from "../controllers/reportController.js";

const router = Router();

router.use(requireAuth);
router.use(requireRole("HR", "CEO", "ADMIN", "MANAGER"));

router.get("/reports/daily", getDailyReport);
router.get("/reports/monthly", getMonthlySummary);
router.get("/reports/export", exportCsvReport);

export default router;