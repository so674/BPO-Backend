import { Router } from "express";
import {
  checkIn,
  checkOut,
  listAttendance,
  getTodayAttendance,
  getAttendanceByEmployee,
  getAttendanceById,
  dailySummary,
} from "../controllers/attendanceController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth);

router.post("/check-in", checkIn);
router.post("/check-out", checkOut);
router.get("/", listAttendance);
router.get("/today", getTodayAttendance);

//  FIX: Added /summary route (and kept /summary/daily as an alias)
router.get("/summary", dailySummary);
router.get("/summary/daily", dailySummary);

router.get("/employee/:id", getAttendanceByEmployee);

//  MUST STAY AT THE BOTTOM (parametrized routes catch all remaining strings)
router.get("/:id", getAttendanceById);

export default router;