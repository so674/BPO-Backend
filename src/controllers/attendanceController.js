import { z } from "zod";
import { query } from "../config/db.js";
import { ApiError } from "../middleware/errorHandler.js";

// Helper to safely format JS Date to MySQL DATETIME (YYYY-MM-DD HH:mm:ss)
const toMySQLDateTime = (d = new Date()) => {
  const date = new Date(d);
  return date.toISOString().slice(0, 19).replace("T", " ");
};

// Helper to extract rows safely regardless of db.js return structure
const getRows = (result) => {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.rows)) return result.rows;
  if (result && Array.isArray(result[0])) return result[0];
  return [];
};

const checkInSchema = z.object({
  employeeId: z.string().optional(),
  punchIn: z.string().optional(),
  note: z.string().optional(),
});

const checkOutSchema = z.object({
  employeeId: z.string().optional(),
  punchOut: z.string().optional(),
  note: z.string().optional(),
});

const mapRow = (r) => ({
  id: r.id,
  employeeId: r.employee_id,
  employeeName: r.employee_name || `${r.first_name || ""} ${r.last_name || ""}`.trim(),
  attendanceDate: r.attendance_date,
  punchIn: r.punch_in,
  punchOut: r.punch_out,
  workingMinutes: r.working_minutes,
  lateMinutes: r.late_minutes,
  status: r.status,
  note: r.note,
});

// 1. POST /api/attendance/check-in
export async function checkIn(req, res) {
  const { role, employeeId: userEmpId } = req.user;
  const body = checkInSchema.parse(req.body || {});

  const targetEmployeeId =
    body.employeeId && (role === "HR" || role === "ADMIN" || role === "CEO")
      ? body.employeeId
      : userEmpId;

  if (!targetEmployeeId) {
    throw new ApiError(400, "Employee ID is required for check-in");
  }

  const today = new Date().toISOString().slice(0, 10);
  const punchInTime = body.punchIn ? new Date(body.punchIn) : new Date();
  const formattedPunchIn = toMySQLDateTime(punchInTime);

  // Check if today's record already exists
  const resExisting = await query(
    "SELECT * FROM attendance_records WHERE employee_id = ? AND attendance_date = ?",
    [targetEmployeeId, today]
  );
  const existing = getRows(resExisting);

  if (existing.length > 0 && existing[0].punch_in) {
    throw new ApiError(400, "Employee has already checked in for today");
  }

  // Calculate status (LATE if check-in is past 09:15 AM)
  const shiftStart = new Date(punchInTime);
  shiftStart.setHours(9, 15, 0, 0);

  let status = "PRESENT";
  let lateMinutes = 0;

  if (punchInTime > shiftStart) {
    status = "LATE";
    lateMinutes = Math.floor((punchInTime - shiftStart) / (1000 * 60));
  }

  const recordId = existing.length > 0 ? existing[0].id : `att-${Date.now()}`;

  if (existing.length > 0) {
    await query(
      `UPDATE attendance_records 
       SET punch_in = ?, status = ?, late_minutes = ?, note = ? 
       WHERE id = ?`,
      [formattedPunchIn, status, lateMinutes, body.note || null, recordId]
    );
  } else {
    await query(
      `INSERT INTO attendance_records 
       (id, employee_id, attendance_date, punch_in, status, late_minutes, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [recordId, targetEmployeeId, today, formattedPunchIn, status, lateMinutes, body.note || null]
    );
  }

  const resRecord = await query("SELECT * FROM attendance_records WHERE id = ?", [recordId]);
  const rows = getRows(resRecord);
  res.status(201).json({ record: mapRow(rows[0]) });
}

// 2. POST /api/attendance/check-out
export async function checkOut(req, res) {
  const { role, employeeId: userEmpId } = req.user;
  const body = checkOutSchema.parse(req.body || {});

  const targetEmployeeId =
    body.employeeId && (role === "HR" || role === "ADMIN" || role === "CEO")
      ? body.employeeId
      : userEmpId;

  const today = new Date().toISOString().slice(0, 10);
  const punchOutTime = body.punchOut ? new Date(body.punchOut) : new Date();
  const formattedPunchOut = toMySQLDateTime(punchOutTime);

  const resExisting = await query(
    "SELECT * FROM attendance_records WHERE employee_id = ? AND attendance_date = ?",
    [targetEmployeeId, today]
  );
  const existing = getRows(resExisting);

  if (existing.length === 0 || !existing[0].punch_in) {
    throw new ApiError(400, "Cannot check out without a valid check-in record for today");
  }

  const record = existing[0];
  const punchInTime = new Date(record.punch_in);
  const workingMinutes = Math.max(0, Math.floor((punchOutTime - punchInTime) / (1000 * 60)));

  await query(
    `UPDATE attendance_records 
     SET punch_out = ?, working_minutes = ?, note = COALESCE(?, note)
     WHERE id = ?`,
    [formattedPunchOut, workingMinutes, body.note || null, record.id]
  );

  const resRecord = await query("SELECT * FROM attendance_records WHERE id = ?", [record.id]);
  const rows = getRows(resRecord);
  res.json({ record: mapRow(rows[0]) });
}

// 3. GET /api/attendance
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

  const resList = await query(sql, params);
  const rows = getRows(resList);
  res.json({ records: rows.map(mapRow) });
}

// 4. GET /api/attendance/today
export async function getTodayAttendance(req, res) {
  const { employeeId } = req.user;
  const today = new Date().toISOString().slice(0, 10);

  const resToday = await query(
    `SELECT ar.*, CONCAT(e.first_name, ' ', e.last_name) AS employee_name
     FROM attendance_records ar
     JOIN employees e ON e.id = ar.employee_id
     WHERE ar.employee_id = ? AND ar.attendance_date = ?`,
    [employeeId, today]
  );
  const rows = getRows(resToday);

  if (rows.length === 0) {
    return res.json({ record: null, message: "No attendance recorded for today" });
  }

  res.json({ record: mapRow(rows[0]) });
}

// 5. GET /api/attendance/employee/:id
export async function getAttendanceByEmployee(req, res) {
  const { id } = req.params;
  const { role, employeeId: userEmpId } = req.user;

  if (role === "EMPLOYEE" && id !== userEmpId) {
    throw new ApiError(403, "Access denied: You can only view your own records");
  }

  const resEmp = await query(
    `SELECT ar.*, CONCAT(e.first_name, ' ', e.last_name) AS employee_name
     FROM attendance_records ar
     JOIN employees e ON e.id = ar.employee_id
     WHERE ar.employee_id = ?
     ORDER BY ar.attendance_date DESC`,
    [id]
  );
  const rows = getRows(resEmp);

  res.json({ records: rows.map(mapRow) });
}

// 6. GET /api/attendance/:id
export async function getAttendanceById(req, res) {
  const { id } = req.params;

  const resById = await query(
    `SELECT ar.*, CONCAT(e.first_name, ' ', e.last_name) AS employee_name
     FROM attendance_records ar
     JOIN employees e ON e.id = ar.employee_id
     WHERE ar.id = ?`,
    [id]
  );
  const rows = getRows(resById);

  if (rows.length === 0) {
    throw new ApiError(404, "Attendance record not found");
  }

  res.json({ record: mapRow(rows[0]) });
}

// 7. GET /api/attendance/summary/daily
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
  const resSum = await query(sql, params);
  const rows = getRows(resSum);

  const summary = {
    PRESENT: 0,
    LATE: 0,
    ABSENT: 0,
    MISSING_PUNCH: 0,
    ON_LEAVE: 0,
    HOLIDAY: 0,
    WEEK_OFF: 0,
    CORRECTED: 0,
  };

  rows.forEach((r) => {
    if (summary[r.status] !== undefined) {
      summary[r.status] = Number(r.count);
    }
  });

  res.json({ date, summary });
}