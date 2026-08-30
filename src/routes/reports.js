import { Router } from "express";
import { query } from "../config/db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// Section 21.2: Monthly report — attendance %, late count, absence count, working-hour summary
router.get("/monthly", requireRole("HR", "MANAGER", "CEO"), async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7); // YYYY-MM

  let sql = `
    SELECT e.id AS employee_id, CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
           SUM(CASE WHEN ar.status IN ('PRESENT','LATE','CORRECTED') THEN 1 ELSE 0 END) AS present_days,
           SUM(CASE WHEN ar.status = 'LATE' THEN 1 ELSE 0 END) AS late_days,
           SUM(CASE WHEN ar.status = 'ABSENT' THEN 1 ELSE 0 END) AS absent_days,
           SUM(CASE WHEN ar.status = 'MISSING_PUNCH' THEN 1 ELSE 0 END) AS missing_punch_days,
           COALESCE(SUM(ar.working_minutes), 0) AS total_working_minutes
    FROM employees e
    JOIN attendance_records ar ON ar.employee_id = e.id
    WHERE DATE_FORMAT(ar.attendance_date, '%Y-%m') = ?
  `;
  const params = [month];

  if (req.user.role === "MANAGER") {
    sql += ` AND (e.manager_id = ? OR e.id = ?)`;
    params.push(req.user.employeeId, req.user.employeeId);
  }

  sql += " GROUP BY e.id, e.first_name, e.last_name ORDER BY e.first_name";

  const { rows } = await query(sql, params);
  res.json(
    rows.map((r) => ({
      employee_id: r.employee_id,
      employee_name: r.employee_name,
      present_days: Number(r.present_days),
      late_days: Number(r.late_days),
      absent_days: Number(r.absent_days),
      missing_punch_days: Number(r.missing_punch_days),
      total_working_minutes: Number(r.total_working_minutes),
    })),
  );
});

// Section 21.3: Department report — CEO / HR scope
router.get("/departments", requireRole("HR", "CEO"), async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);

  const { rows } = await query(
    `
    SELECT d.name AS department,
           SUM(CASE WHEN ar.status IN ('PRESENT','LATE','CORRECTED') THEN 1 ELSE 0 END) AS present,
           COUNT(*) AS total
    FROM departments d
    JOIN employees e ON e.department_id = d.id
    JOIN attendance_records ar ON ar.employee_id = e.id AND ar.attendance_date = ?
    GROUP BY d.name
    ORDER BY d.name
    `,
    [date],
  );
  res.json(
    rows.map((r) => {
      const present = Number(r.present);
      const total = Number(r.total);
      return { department: r.department, present, total, rate: total > 0 ? Math.round((present / total) * 100) : 0 };
    }),
  );
});

export default router;
