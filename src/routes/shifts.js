import { Router } from "express";
import { z } from "zod";
import { query } from "../config/db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { recordAudit } from "../services/auditService.js";

const router = Router();
router.use(requireAuth);

const mapRow = (r) => ({
  id: r.id,
  name: r.name,
  start: r.start_time,
  end: r.end_time,
  graceMinutes: r.grace_minutes,
});

router.get("/", async (req, res) => {
  const { rows } = await query("SELECT * FROM shifts ORDER BY name");
  res.json(rows.map(mapRow));
});

// HR only — Section 10.1: Configuration module owns shift/grace policy
router.patch("/:id", requireRole("HR"), async (req, res) => {
  const schema = z.object({ graceMinutes: z.number().int().min(0).max(120) });
  const { graceMinutes } = schema.parse(req.body);

  const { rows: before } = await query("SELECT grace_minutes FROM shifts WHERE id = ?", [req.params.id]);
  await query("UPDATE shifts SET grace_minutes = ? WHERE id = ?", [graceMinutes, req.params.id]);

  await recordAudit(null, {
    actorUserId: req.user.id,
    action: "SHIFT_UPDATED",
    entityType: "Shift",
    entityId: req.params.id,
    oldValue: `grace=${before[0]?.grace_minutes}m`,
    newValue: `grace=${graceMinutes}m`,
  });

  const { rows } = await query("SELECT * FROM shifts WHERE id = ?", [req.params.id]);
  res.json(mapRow(rows[0]));
});

export default router;
