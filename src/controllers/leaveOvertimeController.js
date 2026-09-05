import { z } from "zod";
import { query } from "../config/db.js";
import { recordAudit } from "../services/auditService.js";
import { ApiError } from "../middleware/errorHandler.js";

const getRows = (result) => {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.rows)) return result.rows;
  if (result && Array.isArray(result[0])) return result[0];
  return [];
};

// ==================== LEAVE MANAGEMENT ====================

// 1. POST /api/leaves - Apply for Leave
export async function applyLeave(req, res) {
  const schema = z.object({
    employeeId: z.string().min(1),
    leaveType: z.enum(["CASUAL", "SICK", "ANNUAL", "UNPAID"]),
    startDate: z.string().min(1),
    endDate: z.string().min(1),
    reason: z.string().optional(),
  });

  const data = schema.parse(req.body);
  const id = `leave-${Date.now()}`;

  // Verify employee exists
  const empRes = await query("SELECT id FROM employees WHERE id = ?", [data.employeeId]);
  if (getRows(empRes).length === 0) {
    throw new ApiError(404, `Employee '${data.employeeId}' not found`);
  }

  await query(
    `INSERT INTO leave_requests (id, employee_id, leave_type, start_date, end_date, reason)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, data.employeeId, data.leaveType, data.startDate, data.endDate, data.reason || null]
  );

  res.status(201).json({ message: "Leave request submitted successfully", leaveId: id });
}

// 2. GET /api/leaves - List all leave requests
export async function listLeaves(req, res) {
  const { employeeId, status } = req.query;
  let sql = "SELECT * FROM leave_requests WHERE 1=1";
  const params = [];

  if (employeeId) {
    sql += " AND employee_id = ?";
    params.push(employeeId);
  }
  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }

  sql += " ORDER BY created_at DESC";

  const result = await query(sql, params);
  res.json(getRows(result));
}

// 3. PATCH /api/leaves/:id/status - Approve/Reject Leave Request (HR / Manager / Admin)
export async function updateLeaveStatus(req, res) {
  const schema = z.object({
    status: z.enum(["APPROVED", "REJECTED"]),
  });

  const { status } = schema.parse(req.body);

  const existingRes = await query("SELECT * FROM leave_requests WHERE id = ?", [req.params.id]);
  const rows = getRows(existingRes);
  if (rows.length === 0) {
    throw new ApiError(404, "Leave request not found");
  }

  const reviewerId = req.user?.id || "SYSTEM";

  await query(
    "UPDATE leave_requests SET status = ?, reviewed_by = ? WHERE id = ?",
    [status, reviewerId, req.params.id]
  );

  try {
    if (typeof recordAudit === "function") {
      await recordAudit(null, {
        actorUserId: reviewerId,
        action: `LEAVE_${status}`,
        entityType: "LeaveRequest",
        entityId: req.params.id,
        newValue: status,
      });
    }
  } catch (auditErr) {
    console.warn("Audit log skipped:", auditErr.message);
  }

  res.json({ message: `Leave request ${status.toLowerCase()}`, leaveId: req.params.id, status });
}

// ==================== OVERTIME MANAGEMENT ====================

// 4. POST /api/overtime - Request Overtime
export async function applyOvertime(req, res) {
  const schema = z.object({
    employeeId: z.string().min(1),
    workDate: z.string().min(1),
    hours: z.number().positive(),
    reason: z.string().optional(),
  });

  const data = schema.parse(req.body);
  const id = `ot-${Date.now()}`;

  // Verify employee exists
  const empRes = await query("SELECT id FROM employees WHERE id = ?", [data.employeeId]);
  if (getRows(empRes).length === 0) {
    throw new ApiError(404, `Employee '${data.employeeId}' not found`);
  }

  await query(
    `INSERT INTO overtime_requests (id, employee_id, work_date, hours, reason)
     VALUES (?, ?, ?, ?, ?)`,
    [id, data.employeeId, data.workDate, data.hours, data.reason || null]
  );

  res.status(201).json({ message: "Overtime request submitted successfully", overtimeId: id });
}

// 5. GET /api/overtime - List all overtime requests
export async function listOvertime(req, res) {
  const { employeeId, status } = req.query;
  let sql = "SELECT * FROM overtime_requests WHERE 1=1";
  const params = [];

  if (employeeId) {
    sql += " AND employee_id = ?";
    params.push(employeeId);
  }
  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }

  sql += " ORDER BY created_at DESC";

  const result = await query(sql, params);
  res.json(getRows(result));
}

// 6. PATCH /api/overtime/:id/status - Approve/Reject Overtime Request (HR / Manager / Admin)
export async function updateOvertimeStatus(req, res) {
  const schema = z.object({
    status: z.enum(["APPROVED", "REJECTED"]),
  });

  const { status } = schema.parse(req.body);

  const existingRes = await query("SELECT * FROM overtime_requests WHERE id = ?", [req.params.id]);
  const rows = getRows(existingRes);
  if (rows.length === 0) {
    throw new ApiError(404, "Overtime request not found");
  }

  const reviewerId = req.user?.id || "SYSTEM";

  await query(
    "UPDATE overtime_requests SET status = ?, reviewed_by = ? WHERE id = ?",
    [status, reviewerId, req.params.id]
  );

  res.json({ message: `Overtime request ${status.toLowerCase()}`, overtimeId: req.params.id, status });
}