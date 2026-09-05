import { randomUUID } from "crypto";
import { z } from "zod";
import { query, withTransaction } from "../config/db.js";
import { processAttendanceEvent } from "../services/attendanceEngine.js";
import { ApiError } from "../middleware/errorHandler.js";

const eventSchema = z.object({
  eventUid: z.string().min(1),
  cardUid: z.string().min(1),
  deviceCode: z.string().min(1),
  eventTimestamp: z.string(),
});

function toMySQLDateTime(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

// POST /attendance-events
export async function ingestEvent(req, res) {
  const data = eventSchema.parse(req.body);
  const eventTimestamp = new Date(data.eventTimestamp);

  if (Number.isNaN(eventTimestamp.getTime())) {
    throw new ApiError(400, "eventTimestamp must be a valid ISO 8601 date-time");
  }

  // 1. IDEMPOTENCY CHECK
  const { rows: dupe } = await query(
    "SELECT id FROM attendance_events WHERE event_uid = ?",
    [data.eventUid]
  );

  if (dupe[0]) {
    return res.status(200).json({
      status: "duplicate_ignored",
      eventUid: data.eventUid,
    });
  }

  // 2. VALIDATE DEVICE
  const { rows: deviceRows } = await query(
    "SELECT * FROM rfid_devices WHERE device_code = ?",
    [data.deviceCode]
  );
  const device = deviceRows[0];
  if (!device) {
    throw new ApiError(400, "Unknown device");
  }

  // 3. VALIDATE CARD
  const { rows: cardRows } = await query(
    "SELECT * FROM rfid_cards WHERE card_uid = ?",
    [data.cardUid]
  );
  const card = cardRows[0];
  if (!card) {
    throw new ApiError(400, "Unknown card");
  }
  if (card.status !== "ACTIVE") {
    throw new ApiError(403, `Card is ${card.status.toLowerCase()}, cannot record attendance`);
  }

  // 4. CARD MUST BE ASSIGNED
  if (!card.employee_id) {
    throw new ApiError(400, "Card is not assigned to an employee");
  }

  // 5. VALIDATE EMPLOYEE
  const { rows: empRows } = await query(
    "SELECT * FROM employees WHERE id = ?",
    [card.employee_id]
  );
  const employee = empRows[0];
  if (!employee || employee.employment_status !== "ACTIVE") {
    throw new ApiError(403, "Employee is not active");
  }

  // 6. DETERMINE PUNCH TYPE
  const eventType = device.device_type === "ENTRY" ? "PUNCH_IN" : "PUNCH_OUT";

  // 7. SAVE EVENT + UPDATE ATTENDANCE IN TRANSACTION
  const result = await withTransaction(async (client) => {
    const eventId = randomUUID();

    await client.query(
      `INSERT INTO attendance_events
        (id, event_uid, employee_id, card_id, device_id, event_type, event_timestamp, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'RFID')`,
      [
        eventId,
        data.eventUid,
        employee.id,
        card.id,
        device.id,
        eventType,
        toMySQLDateTime(eventTimestamp),
      ]
    );

    const { rows: eventRows } = await client.query(
      "SELECT * FROM attendance_events WHERE id = ?",
      [eventId]
    );

    const record = await processAttendanceEvent(client, {
      employeeId: employee.id,
      eventType,
      eventTimestamp,
    });

    await client.query(
      `UPDATE rfid_devices SET last_seen_at = NOW(), status = 'ONLINE' WHERE id = ?`,
      [device.id]
    );

    return { event: eventRows[0], record };
  });

  // 8. RESPONSE
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

// GET /attendance-events
export async function listEvents(req, res) {
  const { employeeId: requestedEmployeeId, limit = 50 } = req.query;
  const { role, employeeId: loggedInEmployeeId } = req.user;

  let sql = `
    SELECT ev.*, CONCAT(e.first_name, ' ', e.last_name) AS employee_name, d.device_code
    FROM attendance_events ev
    JOIN employees e ON e.id = ev.employee_id
    JOIN rfid_devices d ON d.id = ev.device_id
  `;

  const conditions = [];
  const params = [];

  if (role === "HR" || role === "CEO") {
    if (requestedEmployeeId) {
      conditions.push("ev.employee_id = ?");
      params.push(requestedEmployeeId);
    }
  } else if (role === "MANAGER") {
    conditions.push("(e.manager_id = ? OR e.id = ?)");
    params.push(loggedInEmployeeId, loggedInEmployeeId);
    if (requestedEmployeeId) {
      conditions.push("ev.employee_id = ?");
      params.push(requestedEmployeeId);
    }
  } else if (role === "EMPLOYEE") {
    conditions.push("ev.employee_id = ?");
    params.push(loggedInEmployeeId);
  } else {
    throw new ApiError(403, "You are not authorized to view attendance events");
  }

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(" AND ")}`;
  }

  const parsedLimit = Number(limit);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
    throw new ApiError(400, "limit must be an integer between 1 and 200");
  }

  sql += ` ORDER BY ev.event_timestamp DESC LIMIT ?`;
  params.push(parsedLimit);

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
    }))
  );
}