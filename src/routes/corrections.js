import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { listCorrections, requestCorrection, decideCorrection } from "../controllers/correctionController.js";

const router = Router();
router.use(requireAuth, requireRole("HR"));

router.get("/", listCorrections);
router.post("/", requestCorrection);
router.post("/:id/decision", decideCorrection);

export default router;
