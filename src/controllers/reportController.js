import { query } from "../config/db.js";

const getRows = (result) => {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.rows)) return result.rows;
  if (Array.isArray(result[0])) return result[0];
  return [];
};

// Utility: Convert JSON array to CSV format
function jsonToCsv(data) {
  if (!data || data.length === 0) return "";
  const headers = Object.keys(data[0]);
  const csvRows = [
    headers.join(","),
    ...data.map((row) =>
      headers
        .map((field) => {
          const val = row[field] === null || row[field] === undefined ? "" : row[field];
          return `"${String(val).replace(/"/g, '""')}"`;
        })
        .join(",")
    ),
  ];
  return csvRows.join("\n");
}

const mapDailyRow = (r) => ({
  employeeId: r.employee_id,
  employeeCode: r.employee_code || "—",
  employeeName: r.employee_name || "Unknown",
  departmentName: r.department_name || "Unassigned",
  punchIn: r.punch_in ? new Date(r.punch_in).toISOString() : null,
  punchOut: r.punch_out ? new Date(r.punch_out).toISOString() : null,
  status: r.status || "ABSENT",
});

const mapMonthlyRow = (r) => ({
  employeeId: r.employee_id,
  employeeCode: r.employee_code || "—",
  employeeName: r.employee_name || "Unknown",
  departmentName: r.department_name || "Unassigned",
  daysPresent: Number(r.days_present || 0),
  lateCount: Number(r.late_count || 0),
  absentCount: Number(r.absent_count || 0),
  totalWorkingMinutes: Number(r.total_working_minutes || 0),
});

// 1. GET /api/reports/daily - Daily Attendance Audit
export async function getDailyReport(req, res) {
  try {
    const { date } = req.query;
    const { role, employeeId } = req.user || {};
    const targetDate = date || new Date().toISOString().split("T")[0];

    let sql = `
      SELECT 
        e.id AS employee_id,
        e.employee_code,
        CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
        d.name AS department_name,
        ar.punch_in,
        ar.punch_out,
        COALESCE(ar.status, 'ABSENT') AS status
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN attendance_records ar ON e.id = ar.employee_id AND ar.attendance_date = ?
    `;

    const conditions = [];
    const params = [targetDate];

    // Filter by team if requested by a Manager
    if (role === "MANAGER") {
      conditions.push("(e.manager_id = ? OR e.id = ?)");
      params.push(employeeId, employeeId);
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }

    sql += " ORDER BY e.first_name ASC";

    const result = await query(sql, params);
    const rows = getRows(result);

    // 🟢 Returns flat array directly
    res.json(rows.map(mapDailyRow));
  } catch (err) {
    console.error("Daily Report Error:", err);
    res.status(500).json({ error: err.message || "Failed to generate daily report" });
  }
}

// 2. GET /api/reports/monthly - Monthly Summary
export async function getMonthlySummary(req, res) {
  try {
    const { month, year } = req.query;
    const { role, employeeId } = req.user || {};
    const currentYear = Number(year) || new Date().getFullYear();
    const currentMonth = Number(month) || new Date().getMonth() + 1;

    let sql = `
      SELECT 
        e.id AS employee_id,
        e.employee_code,
        CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
        d.name AS department_name,
        COUNT(DISTINCT CASE WHEN ar.status IN ('PRESENT', 'LATE', 'CORRECTED') THEN ar.attendance_date END) AS days_present,
        SUM(CASE WHEN ar.status = 'LATE' THEN 1 ELSE 0 END) AS late_count,
        SUM(CASE WHEN ar.status = 'ABSENT' THEN 1 ELSE 0 END) AS absent_count,
        COALESCE(SUM(ar.working_minutes), 0) AS total_working_minutes
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN attendance_records ar ON e.id = ar.employee_id 
        AND MONTH(ar.attendance_date) = ? AND YEAR(ar.attendance_date) = ?
    `;

    const conditions = [];
    const params = [currentMonth, currentYear];

    // Filter by team if requested by a Manager
    if (role === "MANAGER") {
      conditions.push("(e.manager_id = ? OR e.id = ?)");
      params.push(employeeId, employeeId);
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }

    sql += " GROUP BY e.id, e.employee_code, e.first_name, e.last_name, d.name ORDER BY e.first_name ASC";

    const result = await query(sql, params);
    const rows = getRows(result);

    // 🟢 Returns flat array directly
    res.json(rows.map(mapMonthlyRow));
  } catch (err) {
    console.error("Monthly Summary Error:", err);
    res.status(500).json({ error: err.message || "Failed to generate monthly summary" });
  }
}

// 3. GET /api/reports/export - Export CSV
export async function exportCsvReport(req, res) {
  try {
    const { date } = req.query;
    const { role, employeeId } = req.user || {};
    const targetDate = date || new Date().toISOString().split("T")[0];

    let sql = `
      SELECT 
        e.id AS 'Employee ID',
        e.employee_code AS 'Employee Code',
        CONCAT(e.first_name, ' ', e.last_name) AS 'Employee Name',
        COALESCE(d.name, 'N/A') AS 'Department',
        COALESCE(ar.punch_in, 'N/A') AS 'Punch In',
        COALESCE(ar.punch_out, 'N/A') AS 'Punch Out',
        COALESCE(ar.status, 'ABSENT') AS 'Status'
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN attendance_records ar ON e.id = ar.employee_id AND ar.attendance_date = ?
    `;

    const conditions = [];
    const params = [targetDate];

    if (role === "MANAGER") {
      conditions.push("(e.manager_id = ? OR e.id = ?)");
      params.push(employeeId, employeeId);
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }

    sql += " ORDER BY e.first_name ASC";

    const result = await query(sql, params);
    const rows = getRows(result);
    const csvData = jsonToCsv(rows);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=attendance_report_${targetDate}.csv`);
    res.status(200).send(csvData);
  } catch (err) {
    console.error("Export CSV Error:", err);
    res.status(500).json({ error: err.message || "Failed to export CSV report" });
  }
}