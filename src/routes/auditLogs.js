import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getAuditLogs } from "../controllers/auditLogController.js";

const router = Router();

// Apply authentication and role middleware once for all endpoints
router.use(requireAuth);
router.use(requireRole("HR", "ADMIN", "CEO"));

// GET /api/audit-logs
router.get("/", getAuditLogs);

export default router;