import { randomUUID } from "crypto";
import { z } from "zod";
import { query } from "../config/db.js";
import { recordAudit } from "../services/auditService.js";
import { ApiError } from "../middleware/errorHandler.js";

// Helper to safely extract database rows across different MySQL wrapper formats
const getRows = (result) => {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.rows)) return result.rows;
  if (result && Array.isArray(result[0])) return result[0];
  return [];
};

const mapRow = (r) => ({
  id: r.id,
  name: r.name,
  startTime: r.start_time,
  endTime: r.end_time,
  graceMinutes: r.grace_minutes,
});

// 1. GET /api/shifts - List all shifts
export async function listShifts(req, res) {
  const result = await query("SELECT * FROM shifts ORDER BY name");
  const rows = getRows(result);
  res.json(rows.map(mapRow));
}

// 2. GET /api/shifts/:id - Get shift details by ID
export async function getShiftById(req, res) {
  const result = await query("SELECT * FROM shifts WHERE id = ?", [req.params.id]);
  const rows = getRows(result);
  if (rows.length === 0) {
    throw new ApiError(404, "Shift not found");
  }
  res.json(mapRow(rows[0]));
}

// 3. POST /api/shifts - Create a new shift (HR / Admin)
export async function createShift(req, res) {
  const schema = z.object({
    name: z.string().min(1),
    startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/, "Invalid time format (HH:MM:SS)"),
    endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/, "Invalid time format (HH:MM:SS)"),
    graceMinutes: z.number().int().min(0).max(120).default(15),
  });

  const data = schema.parse(req.body);
  const id = `shift-${Date.now()}`;

  await query(
    `INSERT INTO shifts (id, name, start_time, end_time, grace_minutes)
     VALUES (?, ?, ?, ?, ?)`,
    [id, data.name, data.startTime, data.endTime, data.graceMinutes]
  );

  const result = await query("SELECT * FROM shifts WHERE id = ?", [id]);
  const rows = getRows(result);
  res.status(201).json(mapRow(rows[0]));
}

// 4. PATCH /api/shifts/:id - Update shift grace minutes (HR / Admin)
export async function updateShiftGrace(req, res) {
  const schema = z.object({ 
    graceMinutes: z.number().int().min(0).max(120) 
  });
  const { graceMinutes } = schema.parse(req.body);

  const beforeRes = await query("SELECT grace_minutes FROM shifts WHERE id = ?", [req.params.id]);
  const beforeRows = getRows(beforeRes);
  if (beforeRows.length === 0) {
    throw new ApiError(404, "Shift not found");
  }

  await query("UPDATE shifts SET grace_minutes = ? WHERE id = ?", [graceMinutes, req.params.id]);

  try {
    if (typeof recordAudit === "function") {
      await recordAudit(null, {
        actorUserId: req.user?.id || "SYSTEM",
        action: "SHIFT_UPDATED",
        entityType: "Shift",
        entityId: req.params.id,
        oldValue: `grace=${beforeRows[0]?.grace_minutes}m`,
        newValue: `grace=${graceMinutes}m`,
      });
    }
  } catch (auditErr) {
    console.warn("Audit log skipped:", auditErr.message);
  }

  const result = await query("SELECT * FROM shifts WHERE id = ?", [req.params.id]);
  const rows = getRows(result);
  res.json(mapRow(rows[0]));
}

// 5. POST /api/shifts/assign - Assign shift to an employee
export async function assignShift(req, res) {
  try {
    const schema = z.object({
      employeeId: z.string().min(1, "employeeId is required"),
      shiftId: z.string().min(1, "shiftId is required"),
      effectiveFrom: z.string().min(1, "effectiveFrom is required"),
      effectiveTo: z.string().nullable().optional(),
    });

    const data = schema.parse(req.body || {});
    const assignmentId = `emp-shift-${Date.now()}`;

    // Verify employee exists
    const empRes = await query("SELECT id FROM employees WHERE id = ?", [data.employeeId]);
    if (getRows(empRes).length === 0) {
      return res.status(400).json({ error: `Employee ID '${data.employeeId}' does not exist.` });
    }

    // Verify shift exists
    const shiftRes = await query("SELECT id FROM shifts WHERE id = ?", [data.shiftId]);
    if (getRows(shiftRes).length === 0) {
      return res.status(400).json({ error: `Shift ID '${data.shiftId}' does not exist.` });
    }

    await query(
      `INSERT INTO employee_shifts (id, employee_id, shift_id, effective_from, effective_to)
       VALUES (?, ?, ?, ?, ?)`,
      [assignmentId, data.employeeId, data.shiftId, data.effectiveFrom, data.effectiveTo || null]
    );

    res.status(201).json({
      message: "Shift assigned successfully",
      assignmentId,
      employeeId: data.employeeId,
      shiftId: data.shiftId,
      effectiveFrom: data.effectiveFrom,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.errors });
    }
    console.error("Assign Shift Error:", err);
    return res.status(500).json({ error: err.message || "Failed to assign shift" });
  }
}