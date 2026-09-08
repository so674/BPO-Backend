import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { 
  getTeamReport, 
  getDailyReport, 
  getMonthlySummary, 
  exportCsvReport,
  getDepartmentReport
} from "../controllers/reportController.js";

const router = Router();

router.use(requireAuth);

// Correct: relative paths to /api/reports
router.get("/team", getTeamReport);        // Endpoint: /api/reports/team
router.get("/daily", getDailyReport);      // Endpoint: /api/reports/daily
router.get("/monthly", getMonthlySummary);  // Endpoint: /api/reports/monthly
router.get("/export", exportCsvReport);    // Endpoint: /api/reports/export
router.get("/departments", getDepartmentReport);

export default router;