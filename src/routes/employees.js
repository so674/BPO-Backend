import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { listEmployees, getEmployee, createEmployee, updateEmployeeStatus } from "../controllers/employeeController.js";

const router = Router();

router.use(requireAuth);

router.get("/", requireRole("HR", "MANAGER", "CEO"), listEmployees);
router.get("/:id", requireRole("HR", "MANAGER", "CEO"), getEmployee);
router.post("/", requireRole("HR"), createEmployee);
router.patch("/:id/status", requireRole("HR"), updateEmployeeStatus);

export default router;
