import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { listAttendance, dailySummary } from "../controllers/attendanceController.js";

const router = Router();
router.use(requireAuth); // all four roles can read attendance, scoped by controller logic

router.get("/", listAttendance);
router.get("/summary", dailySummary);

export default router;
