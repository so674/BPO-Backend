import { Router } from "express";
import { query } from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const { rows } = await query(
    `SELECT d.id, d.name,
            COUNT(e.id) AS head_count
     FROM departments d
     LEFT JOIN employees e ON e.department_id = d.id AND e.employment_status = 'ACTIVE'
     GROUP BY d.id, d.name
     ORDER BY d.name`,
  );
  res.json(rows.map((r) => ({ id: r.id, name: r.name, headCount: Number(r.head_count) })));
});

export default router;
