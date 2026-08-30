import { randomUUID } from "crypto";

// ────────────────────────────────────────────────────────────────
// Attendance Processing Engine
// Implements Section 13 (Processing Sequence) and Section 13.2 (Working-Hour Formula)
// of the master document.
//
// Called AFTER a raw event has been validated and persisted. Loads/creates the day's
// attendance record, applies shift + grace rules, computes status + working hours.
// ────────────────────────────────────────────────────────────────

/**
 * @param {object} client - a MySQL client already inside a transaction (query(sql, params) -> {rows})
 * @param {object} params
 * @param {string} params.employeeId
 * @param {string} params.eventType - 'PUNCH_IN' | 'PUNCH_OUT'
 * @param {Date} params.eventTimestamp
 */
export async function processAttendanceEvent(client, { employeeId, eventType, eventTimestamp }) {
  const attendanceDate = eventTimestamp.toISOString().slice(0, 10);

  // Load the employee's shift so we can apply grace-period rules
  const { rows: empRows } = await client.query(
    `SELECT e.id, s.start_time, s.grace_minutes
     FROM employees e
     LEFT JOIN shifts s ON s.id = e.shift_id
     WHERE e.id = ?`,
    [employeeId],
  );
  const employee = empRows[0];

  // Load or create today's attendance record
  const { rows: existing } = await client.query(
    `SELECT * FROM attendance_records WHERE employee_id = ? AND attendance_date = ?`,
    [employeeId, attendanceDate],
  );

  let record = existing[0];

  if (!record) {
    const id = randomUUID();
    await client.query(
      `INSERT INTO attendance_records (id, employee_id, attendance_date, status)
       VALUES (?, ?, ?, 'MISSING_PUNCH')`,
      [id, employeeId, attendanceDate],
    );
    const { rows: created } = await client.query("SELECT * FROM attendance_records WHERE id = ?", [id]);
    record = created[0];
  }

  if (eventType === "PUNCH_IN") {
    // Business rule: one punch-in allowed per shift/day — keep the earliest punch-in of the day
    if (!record.punch_in) {
      const { late, lateMinutes } = calculateLateness(eventTimestamp, employee?.start_time, employee?.grace_minutes ?? 10);
      const status = late ? "LATE" : "PRESENT";

      await client.query(
        `UPDATE attendance_records
         SET punch_in = ?, late_minutes = ?, status = ?, updated_at = NOW()
         WHERE id = ?`,
        [formatDateTime(eventTimestamp), lateMinutes, status, record.id],
      );
      const { rows: updated } = await client.query("SELECT * FROM attendance_records WHERE id = ?", [record.id]);
      record = updated[0];
    }
  }

  if (eventType === "PUNCH_OUT") {
    // Business rule: punch-out requires a valid punch-in
    if (record.punch_in) {
      const workingMinutes = calculateWorkingMinutes(record.punch_in, eventTimestamp);
      await client.query(
        `UPDATE attendance_records
         SET punch_out = ?, working_minutes = ?, updated_at = NOW()
         WHERE id = ?`,
        [formatDateTime(eventTimestamp), workingMinutes, record.id],
      );
      const { rows: updated } = await client.query("SELECT * FROM attendance_records WHERE id = ?", [record.id]);
      record = updated[0];
    }
    // If there's no punch-in yet, the punch-out event is still stored as an event
    // (events are evidence) but the record stays MISSING_PUNCH until reviewed.
  }

  return record;
}

// MySQL DATETIME columns want 'YYYY-MM-DD HH:MM:SS', not a JS Date object
function formatDateTime(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

// Section 13.2: Working Minutes = Punch Out − Punch In (no break deduction in V1)
function calculateWorkingMinutes(punchIn, punchOut) {
  const inTime = new Date(punchIn).getTime();
  const outTime = new Date(punchOut).getTime();
  return Math.max(0, Math.round((outTime - inTime) / 60000));
}

// "Late if IN time > Shift Start + Grace"
function calculateLateness(eventTimestamp, shiftStartTime, graceMinutes) {
  if (!shiftStartTime) return { late: false, lateMinutes: 0 };

  const [h, m] = String(shiftStartTime).split(":").map(Number);
  const shiftStart = new Date(eventTimestamp);
  shiftStart.setHours(h, m, 0, 0);
  shiftStart.setMinutes(shiftStart.getMinutes() + graceMinutes);

  const diffMinutes = Math.round((eventTimestamp.getTime() - shiftStart.getTime()) / 60000);
  return diffMinutes > 0 ? { late: true, lateMinutes: diffMinutes } : { late: false, lateMinutes: 0 };
}
