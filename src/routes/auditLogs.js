import { Router } from "express";
import { query } from "../config/db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireRole("HR"));

router.get("/", async (req, res) => {
  const { rows } = await query(`
    SELECT a.*, u.name AS actor_name
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_user_id
    ORDER BY a.timestamp DESC
    LIMIT 200
  `);
  res.json(
    rows.map((r) => ({
      id: r.id,
      actor: r.actor_name ?? "System",
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      oldValue: r.old_value,
      newValue: r.new_value,
      timestamp: r.timestamp,
    })),
  );
});

export default router;
