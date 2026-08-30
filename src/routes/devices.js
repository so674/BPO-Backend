import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { listDevices, registerDevice, getDeviceHealth } from "../controllers/deviceController.js";

const router = Router();
router.use(requireAuth);

router.get("/", requireRole("HR", "MANAGER", "CEO"), listDevices);
router.get("/health", requireRole("HR"), getDeviceHealth);
router.post("/", requireRole("HR"), registerDevice);

export default router;
