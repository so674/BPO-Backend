import { Router } from "express";
import {
  listEmployees,
  getEmployeeById,
  createEmployee,
  updateEmployee,
  updateEmployeeStatus,
  deleteEmployee,
} from "../controllers/employeeController.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

// Authentication required for all employee routes
router.use(requireAuth);

// Read endpoints
router.get("/", requireRole("HR", "MANAGER", "CEO"), listEmployees);
router.get("/:id", requireRole("HR", "MANAGER", "CEO"), getEmployeeById);

// Write endpoints (Restricted to HR and CEO)
router.post("/", requireRole("HR", "CEO"), createEmployee);
router.put("/:id", requireRole("HR", "CEO"), updateEmployee);
router.patch("/:id/status", requireRole("HR", "CEO"), updateEmployeeStatus);
router.delete("/:id", requireRole("HR", "CEO"), deleteEmployee);

export default router;