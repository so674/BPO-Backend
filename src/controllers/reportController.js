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

// 1. GET /api/reports/daily - Daily Attendance Audit
export async function getDailyReport(req, res) {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split("T")[0];

    // Simplified daily audit query
    const sql = `
      SELECT 
        e.id AS employee_id,
        COALESCE(CONCAT(e.first_name, ' ', e.last_name), e.id) AS employee_name,
        COALESCE(e.department, 'N/A') AS department,
        a.check_in,
        a.check_out,
        COALESCE(a.status, 'ABSENT') AS status
      FROM employees e
      LEFT JOIN attendance a ON e.id = a.employee_id AND DATE(a.check_in) = ?
      ORDER BY e.first_name
    `;

    const result = await query(sql, [targetDate]);
    const rows = getRows(result);

    res.json({
      date: targetDate,
      totalEmployees: rows.length,
      records: rows,
    });
  } catch (err) {
    console.error("Daily Report Error:", err);
    res.status(500).json({ error: err.message || "Failed to generate daily report" });
  }
}

// 2. GET /api/reports/monthly - Monthly Summary
export async function getMonthlySummary(req, res) {
  try {
    const { month, year } = req.query;
    const currentYear = Number(year) || new Date().getFullYear();
    const currentMonth = Number(month) || new Date().getMonth() + 1;

    const sql = `
      SELECT 
        e.id AS employee_id,
        COALESCE(CONCAT(e.first_name, ' ', e.last_name), e.id) AS full_name,
        COALESCE(e.department, 'N/A') AS department,
        COUNT(DISTINCT DATE(a.check_in)) AS days_present,
        SUM(CASE WHEN a.status = 'LATE' THEN 1 ELSE 0 END) AS late_count
      FROM employees e
      LEFT JOIN attendance a ON e.id = a.employee_id 
        AND MONTH(a.check_in) = ? AND YEAR(a.check_in) = ?
      GROUP BY e.id, e.first_name, e.last_name, e.department
      ORDER BY full_name
    `;

    const result = await query(sql, [currentMonth, currentYear]);

    res.json({
      month: currentMonth,
      year: currentYear,
      summary: getRows(result),
    });
  } catch (err) {
    console.error("Monthly Summary Error:", err);
    res.status(500).json({ error: err.message || "Failed to generate monthly summary" });
  }
}

// 3. GET /api/reports/export - Export CSV
export async function exportCsvReport(req, res) {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split("T")[0];

    const sql = `
      SELECT 
        e.id AS 'Employee ID',
        COALESCE(CONCAT(e.first_name, ' ', e.last_name), e.id) AS 'Employee Name',
        COALESCE(e.department, 'N/A') AS 'Department',
        COALESCE(a.check_in, 'N/A') AS 'Check In',
        COALESCE(a.check_out, 'N/A') AS 'Check Out',
        COALESCE(a.status, 'ABSENT') AS 'Status'
      FROM employees e
      LEFT JOIN attendance a ON e.id = a.employee_id AND DATE(a.check_in) = ?
      ORDER BY e.first_name
    `;

    const result = await query(sql, [targetDate]);
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