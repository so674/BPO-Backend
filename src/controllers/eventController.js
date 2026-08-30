import { randomUUID } from "crypto";
import { z } from "zod";
import { query, withTransaction } from "../config/db.js";
import { processAttendanceEvent } from "../services/attendanceEngine.js";
import { ApiError } from "../middleware/errorHandler.js";

const eventSchema = z.object({
  eventUid: z.string().optional(),
  cardUid: z.string().min(1),
  deviceCode: z.string().min(1),
  eventTimestamp: z.string(), // ISO 8601
});

function toMySQLDateTime(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

// POST /attendance-events
// This is what a reader (or its adapter) calls. Implements the Processing Sequence
// from Section 13.1, steps 1–9, plus idempotency from Section 16.
export async function ingestEvent(req, res) {
  const data = eventSchema.parse(req.body);
  const eventTimestamp = new Date(data.eventTimestamp);
  if (Number.isNaN(eventTimestamp.getTime())) {
    throw new ApiError(400, "eventTimestamp must be a valid ISO 8601 date-time");
  }

  // Step 1 & 2: idempotency check — if we've already seen this event_uid, do nothing (Section 16.1)
  if (data.eventUid) {
    const { rows: dupe } = await query("SELECT id FROM attendance_events WHERE event_uid = ?", [data.eventUid]);
    if (dupe[0]) {
      return res.status(200).json({ status: "duplicate_ignored", eventUid: data.eventUid });
    }
  }

  // Step 3: validate device — must be registered (Section 9.2, Business Rule #5)
  const { rows: deviceRows } = await query("SELECT * FROM rfid_devices WHERE device_code = ?", [data.deviceCode]);
  const device = deviceRows[0];
  if (!device) throw new ApiError(400, "Unknown device");

  // Step 4: validate card — must exist and be ACTIVE (Business Rules #1, #2)
  const { rows: cardRows } = await query("SELECT * FROM rfid_cards WHERE card_uid = ?", [data.cardUid]);
  const card = cardRows[0];
  if (!card) throw new ApiError(400, "Unknown card");
  if (card.status !== "ACTIVE") throw new ApiError(403, `Card is ${card.status.toLowerCase()}, cannot record attendance`);

  // Step 5: resolve employee from the card (never trust an employee id from the device, Section 22.1)
  if (!card.employee_id) throw new ApiError(400, "Card is not assigned to an employee");

  // Step 6: validate employment status (Business Rule #3)
  const { rows: empRows } = await query("SELECT * FROM employees WHERE id = ?", [card.employee_id]);
  const employee = empRows[0];
  if (!employee || employee.employment_status !== "ACTIVE") {
    throw new ApiError(403, "Employee is not active");
  }

  // Step 7: determine event type from device role (ENTRY → PUNCH_IN, EXIT → PUNCH_OUT)
  const eventType = device.device_type === "ENTRY" ? "PUNCH_IN" : "PUNCH_OUT";

  // Steps 8–12: persist event + update attendance record, inside one transaction (Section 12.1)
  const result = await withTransaction(async (client) => {
    const eventId = randomUUID();
    await client.query(
      `INSERT INTO attendance_events (id, event_uid, employee_id, card_id, device_id, event_type, event_timestamp, source)
       VALUES (?,?,?,?,?,?,?,'RFID')`,
      [eventId, data.eventUid ?? null, employee.id, card.id, device.id, eventType, toMySQLDateTime(eventTimestamp)],
    );
    const { rows: eventRows } = await client.query("SELECT * FROM attendance_events WHERE id = ?", [eventId]);

    const record = await processAttendanceEvent(client, {
      employeeId: employee.id,
      eventType,
      eventTimestamp,
    });

    await client.query("UPDATE rfid_devices SET last_seen_at = NOW(), status = 'ONLINE' WHERE id = ?", [device.id]);

    return { event: eventRows[0], record };
  });

  res.status(201).json({
    status: "accepted",
    eventType,
    event: {
      id: result.event.id,
      eventUid: result.event.event_uid,
      eventTimestamp: result.event.event_timestamp,
    },
    attendance: {
      status: result.record.status,
      punchIn: result.record.punch_in,
      punchOut: result.record.punch_out,
      workingMinutes: result.record.working_minutes,
    },
  });
}

export async function listEvents(req, res) {
  const { employeeId, limit = 50 } = req.query;
  let sql = `
    SELECT ev.*, CONCAT(e.first_name, ' ', e.last_name) AS employee_name, d.device_code
    FROM attendance_events ev
    JOIN employees e ON e.id = ev.employee_id
    JOIN rfid_devices d ON d.id = ev.device_id
  `;
  const params = [];
  if (employeeId) {
    sql += ` WHERE ev.employee_id = ?`;
    params.push(employeeId);
  }
  sql += ` ORDER BY ev.event_timestamp DESC LIMIT ?`;
  params.push(Number(limit));

  const { rows } = await query(sql, params);
  res.json(
    rows.map((r) => ({
      id: r.id,
      eventUid: r.event_uid,
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      deviceCode: r.device_code,
      eventType: r.event_type,
      eventTimestamp: r.event_timestamp,
    })),
  );
}
