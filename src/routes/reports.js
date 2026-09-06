import { Router } from "express";
import { query } from "../config/db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const getRows = (result) => {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.rows)) return result.rows;
  if (Array.isArray(result[0])) return result[0];
  return [];
};

async function handleTeamReport(req, res) {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const role = req.user?.role;
    const currentUserId = req.user?.id || "";
    const currentEmpId = req.user?.employeeId || currentUserId;

    let sql = `
      SELECT 
        e.id AS employee_id,
        e.employee_code,
        CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
        d.name AS department_name,
        COALESCE(SUM(CASE WHEN ar.status IN ('PRESENT','LATE','CORRECTED') THEN 1 ELSE 0 END), 0) AS present_days,
        COALESCE(SUM(CASE WHEN ar.status = 'LATE' THEN 1 ELSE 0 END), 0) AS late_days,
        COALESCE(SUM(CASE WHEN ar.status = 'ABSENT' THEN 1 ELSE 0 END), 0) AS absent_days,
        COALESCE(SUM(CASE WHEN ar.status = 'MISSING_PUNCH' THEN 1 ELSE 0 END), 0) AS missing_punch_days,
        COALESCE(SUM(ar.working_minutes), 0) AS total_working_minutes
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN attendance_records ar 
        ON ar.employee_id = e.id 
       AND DATE_FORMAT(ar.attendance_date, '%Y-%m') = ?
    `;

    const params = [month];

    if (role === "MANAGER") {
      sql += `
        WHERE e.manager_id = ? 
           OR e.manager_id = ? 
           OR e.manager_id IN (SELECT employee_id FROM users WHERE id = ?)
           OR e.id = ? 
           OR e.id = ?
      `;
      params.push(currentEmpId, currentUserId, currentUserId, currentEmpId, currentUserId);
    }

    sql += " GROUP BY e.id, e.employee_code, e.first_name, e.last_name, d.name ORDER BY e.first_name ASC";

    const result = await query(sql, params);
    const rows = getRows(result);

    res.json(
      rows.map((r) => ({
        employeeId: r.employee_id,
        employeeCode: r.employee_code || "—",
        employeeName: r.employee_name || "Unknown",
        departmentName: r.department_name || "Unassigned",
        presentDays: Number(r.present_days || 0),
        lateDays: Number(r.late_days || 0),
        absentDays: Number(r.absent_days || 0),
        missingPunchDays: Number(r.missing_punch_days || 0),
        totalWorkingMinutes: Number(r.total_working_minutes || 0),
      }))
    );
  } catch (err) {
    console.error("Team Report Error:", err);
    res.status(500).json({ error: err.message || "Failed to generate report" });
  }
}

router.get("/team", requireRole("HR", "MANAGER", "ADMIN", "CEO"), handleTeamReport);
router.get("/monthly", requireRole("HR", "MANAGER", "ADMIN", "CEO"), handleTeamReport);
router.get("/manager", requireRole("HR", "MANAGER", "ADMIN", "CEO"), handleTeamReport);
router.get("/", requireRole("HR", "MANAGER", "ADMIN", "CEO"), handleTeamReport);

export default router;