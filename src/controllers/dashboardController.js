import { query } from "../config/db.js";

const getRows = (result) => {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.rows)) return result.rows;
  if (Array.isArray(result[0])) return result[0];
  return [];
};

// 1. GET /api/dashboard/hr - Summary metrics for HR / Admin / Management
export async function getHrDashboard(req, res) {
  try {
    const today = new Date().toISOString().split("T")[0];

    // Total active employees
    const empResult = await query("SELECT COUNT(*) AS total FROM employees");
    const totalEmployees = getRows(empResult)[0]?.total || 0;

    // Today's attendance stats
    const attResult = await query(
      `SELECT 
        COUNT(DISTINCT employee_id) AS checked_in_count,
        SUM(CASE WHEN status = 'LATE' THEN 1 ELSE 0 END) AS late_count
       FROM attendance WHERE DATE(check_in) = ?`,
      [today]
    );
    const attStats = getRows(attResult)[0] || {};
    const presentToday = Number(attStats.checked_in_count || 0);
    const lateToday = Number(attStats.late_count || 0);
    const absentToday = Math.max(0, totalEmployees - presentToday);

    // Pending Leave & Overtime Requests
    const leaveResult = await query("SELECT COUNT(*) AS total FROM leave_requests WHERE status = 'PENDING'");
    const pendingLeaves = getRows(leaveResult)[0]?.total || 0;

    const otResult = await query("SELECT COUNT(*) AS total FROM overtime_requests WHERE status = 'PENDING'");
    const pendingOvertime = getRows(otResult)[0]?.total || 0;

    res.json({
      date: today,
      metrics: {
        totalEmployees: Number(totalEmployees),
        presentToday,
        lateToday,
        absentToday,
        pendingLeaves: Number(pendingLeaves),
        pendingOvertime: Number(pendingOvertime),
      },
    });
  } catch (err) {
    console.error("HR Dashboard Error:", err);
    res.status(500).json({ error: err.message || "Failed to fetch HR dashboard metrics" });
  }
}

// 2. GET /api/dashboard/employee - Summary metrics for individual employee view
export async function getEmployeeDashboard(req, res) {
  try {
    const userId = req.user?.id || req.user?.userId;
    const today = new Date().toISOString().split("T")[0];

    // Today's attendance record
    const todayResult = await query(
      "SELECT check_in, check_out, status FROM attendance WHERE employee_id = ? AND DATE(check_in) = ?",
      [userId, today]
    );
    const todayAttendance = getRows(todayResult)[0] || null;

    // Monthly present count
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();
    const monthResult = await query(
      "SELECT COUNT(DISTINCT DATE(check_in)) AS present_days FROM attendance WHERE employee_id = ? AND MONTH(check_in) = ? AND YEAR(check_in) = ?",
      [userId, currentMonth, currentYear]
    );
    const presentDays = getRows(monthResult)[0]?.present_days || 0;

    res.json({
      employeeId: userId,
      todayStatus: todayAttendance ? todayAttendance.status : "NOT_CHECKED_IN",
      todayDetails: todayAttendance,
      monthlyPresentDays: Number(presentDays),
    });
  } catch (err) {
    console.error("Employee Dashboard Error:", err);
    res.status(500).json({ error: err.message || "Failed to fetch employee dashboard metrics" });
  }
}