import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { listCards, registerCard, assignCard, blockCard, replaceCard, reportLostCard } from "../controllers/cardController.js";

const router = Router();
router.use(requireAuth);

// EMPLOYEE included so a person can see their own card (Section 20.4: "Card status / lost-card reporting").
// The controller scopes results down to just their own card when role === EMPLOYEE.
router.get("/", requireRole("HR", "MANAGER", "CEO", "EMPLOYEE"), listCards);
router.post("/", requireRole("HR"), registerCard);
// Self-service report — must be registered before "/:id/block" since it's not an :id route.
router.post("/me/report-lost", requireRole("EMPLOYEE"), reportLostCard);
router.post("/:id/assign", requireRole("HR"), assignCard);
router.post("/:id/block", requireRole("HR"), blockCard);
router.post("/:id/replace", requireRole("HR"), replaceCard);

export default router;
