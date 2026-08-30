import { randomUUID } from "crypto";
import { z } from "zod";
import { query, withTransaction } from "../config/db.js";
import { recordAudit } from "../services/auditService.js";
import { ApiError } from "../middleware/errorHandler.js";

const mapRow = (r) => ({
  id: r.id,
  attendanceRecordId: r.attendance_record_id,
  employeeId: r.employee_id,
  correctionType: r.correction_type,
  oldValue: r.old_value,
  newValue: r.new_value,
  reason: r.reason,
  requestedBy: r.requested_by_name,
  approvedBy: r.approved_by_name,
  status: r.status,
  createdAt: r.created_at,
});

export async function listCorrections(req, res) {
  const { rows } = await query(`
    SELECT c.*, ar.employee_id,
           req.name AS requested_by_name, appr.name AS approved_by_name
    FROM attendance_corrections c
    JOIN attendance_records ar ON ar.id = c.attendance_record_id
    JOIN users req ON req.id = c.requested_by
    LEFT JOIN users appr ON appr.id = c.approved_by
    ORDER BY c.created_at DESC
  `);
  res.json(rows.map(mapRow));
}

// HR only — a correction MUST capture a reason and be attributable (Business Rules #8, #9)
export async function requestCorrection(req, res) {
  const schema = z.object({
    attendanceRecordId: z.string().min(1),
    correctionType: z.enum(["PUNCH_IN", "PUNCH_OUT", "STATUS"]),
    oldValue: z.string().optional(),
    newValue: z.string().min(1),
    reason: z.string().min(5, "A meaningful reason is required"),
  });
  const data = schema.parse(req.body);
  const id = randomUUID();

  await query(
    `INSERT INTO attendance_corrections (id, attendance_record_id, correction_type, old_value, new_value, reason, requested_by, status)
     VALUES (?,?,?,?,?,?,?,'PENDING')`,
    [id, data.attendanceRecordId, data.correctionType, data.oldValue ?? null, data.newValue, data.reason, req.user.id],
  );

  await recordAudit(null, {
    actorUserId: req.user.id,
    action: "CORRECTION_REQUESTED",
    entityType: "AttendanceCorrection",
    entityId: id,
    newValue: data.newValue,
  });

  const { rows } = await query("SELECT * FROM attendance_corrections WHERE id = ?", [id]);
  res.status(201).json(rows[0]);
}

// HR only — approving applies the change to the actual attendance record (Section 19)
export async function decideCorrection(req, res) {
  const schema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]) });
  const { decision } = schema.parse(req.body);

  const result = await withTransaction(async (client) => {
    const { rows: corrRows } = await client.query(
      "SELECT * FROM attendance_corrections WHERE id = ? AND status = 'PENDING'",
      [req.params.id],
    );
    const correction = corrRows[0];
    if (!correction) throw new ApiError(409, "Correction not found or already decided");

    await client.query(
      "UPDATE attendance_corrections SET status = ?, approved_by = ?, approved_at = NOW() WHERE id = ?",
      [decision, req.user.id, correction.id],
    );

    if (decision === "APPROVED") {
      // Apply the correction to the attendance record — never a silent overwrite,
      // the correction row above is the permanent evidence of who/why/when.
      if (correction.correction_type === "PUNCH_IN") {
        await client.query(
          "UPDATE attendance_records SET punch_in = ?, status = 'CORRECTED', updated_at = NOW() WHERE id = ?",
          [correction.new_value, correction.attendance_record_id],
        );
      } else if (correction.correction_type === "PUNCH_OUT") {
        await client.query(
          "UPDATE attendance_records SET punch_out = ?, status = 'CORRECTED', updated_at = NOW() WHERE id = ?",
          [correction.new_value, correction.attendance_record_id],
        );
      } else if (correction.correction_type === "STATUS") {
        await client.query(
          "UPDATE attendance_records SET status = ?, updated_at = NOW() WHERE id = ?",
          [correction.new_value, correction.attendance_record_id],
        );
      }
    }

    await recordAudit(client, {
      actorUserId: req.user.id,
      action: `CORRECTION_${decision}`,
      entityType: "AttendanceCorrection",
      entityId: correction.id,
      oldValue: correction.old_value,
      newValue: correction.new_value,
    });

    return correction;
  });

  res.json({ ...result, status: req.body.decision });
}
