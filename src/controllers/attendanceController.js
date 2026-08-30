import { query } from "../config/db.js";

const mapRow = (r) => ({
  id: r.id,
  employeeId: r.employee_id,
  employeeName: r.employee_name,
  attendanceDate: r.attendance_date,
  punchIn: r.punch_in,
  punchOut: r.punch_out,
  workingMinutes: r.working_minutes,
  lateMinutes: r.late_minutes,
  status: r.status,
});

// Section 20: HR sees everyone, Manager sees their team, CEO sees company-wide (read-only),
// Employee sees only their own records.
export async function listAttendance(req, res) {
  const { role, employeeId } = req.user;
  const { date, from, to } = req.query;

  let sql = `
    SELECT ar.*, CONCAT(e.first_name, ' ', e.last_name) AS employee_name
    FROM attendance_records ar
    JOIN employees e ON e.id = ar.employee_id
  `;
  const conditions = [];
  const params = [];

  if (role === "MANAGER") {
    conditions.push(`(e.manager_id = ? OR e.id = ?)`);
    params.push(employeeId, employeeId);
  } else if (role === "EMPLOYEE") {
    conditions.push(`e.id = ?`);
    params.push(employeeId);
  }

  if (date) {
    conditions.push(`ar.attendance_date = ?`);
    params.push(date);
  } else if (from && to) {
    conditions.push(`ar.attendance_date BETWEEN ? AND ?`);
    params.push(from, to);
  }

  if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY ar.attendance_date DESC, e.employee_code";

  const { rows } = await query(sql, params);
  res.json(rows.map(mapRow));
}

// Daily summary counts — Section 21.1
export async function dailySummary(req, res) {
  const { role, employeeId } = req.user;
  const date = req.query.date || new Date().toISOString().slice(0, 10);

  let sql = `
    SELECT ar.status, COUNT(*) AS count
    FROM attendance_records ar
    JOIN employees e ON e.id = ar.employee_id
    WHERE ar.attendance_date = ?
  `;
  const params = [date];

  if (role === "MANAGER") {
    sql += ` AND (e.manager_id = ? OR e.id = ?)`;
    params.push(employeeId, employeeId);
  }

  sql += " GROUP BY ar.status";
  const { rows } = await query(sql, params);

  const summary = { PRESENT: 0, LATE: 0, ABSENT: 0, MISSING_PUNCH: 0, ON_LEAVE: 0, HOLIDAY: 0, WEEK_OFF: 0, CORRECTED: 0 };
  rows.forEach((r) => (summary[r.status] = Number(r.count)));
  res.json({ date, summary });
}
