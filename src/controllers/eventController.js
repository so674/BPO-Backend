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

// =====================================================
// POST /attendance-events
// RFID DEVICE → BACKEND → ATTENDANCE
// =====================================================

export async function ingestEvent(req, res) {
  const data = eventSchema.parse(req.body);

  const eventTimestamp = new Date(data.eventTimestamp);

  if (Number.isNaN(eventTimestamp.getTime())) {
    throw new ApiError(
      400,
      "eventTimestamp must be a valid ISO 8601 date-time",
    );
  }

  // ===================================================
  // 1. IDEMPOTENCY CHECK
  // ===================================================

  const { rows: dupe } = await query(
    "SELECT id FROM attendance_events WHERE event_uid = ?",
    [data.eventUid],
  );

  if (dupe[0]) {
    return res.status(200).json({
      status: "duplicate_ignored",
      eventUid: data.eventUid,
    });
  }

  // ===================================================
  // 2. VALIDATE DEVICE
  // ===================================================

  const { rows: deviceRows } = await query(
    "SELECT * FROM rfid_devices WHERE device_code = ?",
    [data.deviceCode],
  );

  const device = deviceRows[0];

  if (!device) {
    throw new ApiError(400, "Unknown device");
  }

  // ===================================================
  // 3. VALIDATE CARD
  // ===================================================

  const { rows: cardRows } = await query(
    "SELECT * FROM rfid_cards WHERE card_uid = ?",
    [data.cardUid],
  );

  const card = cardRows[0];

  if (!card) {
    throw new ApiError(400, "Unknown card");
  }

  if (card.status !== "ACTIVE") {
    throw new ApiError(
      403,
      `Card is ${card.status.toLowerCase()}, cannot record attendance`,
    );
  }

  // ===================================================
  // 4. CARD MUST BE ASSIGNED
  // ===================================================

  if (!card.employee_id) {
    throw new ApiError(
      400,
      "Card is not assigned to an employee",
    );
  }

  // ===================================================
  // 5. VALIDATE EMPLOYEE
  // ===================================================

  const { rows: empRows } = await query(
    "SELECT * FROM employees WHERE id = ?",
    [card.employee_id],
  );

  const employee = empRows[0];

  if (
    !employee ||
    employee.employment_status !== "ACTIVE"
  ) {
    throw new ApiError(
      403,
      "Employee is not active",
    );
  }

  // ===================================================
  // 6. DETERMINE PUNCH TYPE
  // ===================================================

  const eventType =
    device.device_type === "ENTRY"
      ? "PUNCH_IN"
      : "PUNCH_OUT";

  // ===================================================
  // 7. SAVE EVENT + UPDATE ATTENDANCE
  //    INSIDE ONE TRANSACTION
  // ===================================================

  const result = await withTransaction(async (client) => {
    const eventId = randomUUID();

    await client.query(
      `INSERT INTO attendance_events
        (
          id,
          event_uid,
          employee_id,
          card_id,
          device_id,
          event_type,
          event_timestamp,
          source
        )
       VALUES (?, ?, ?, ?, ?, ?, ?, 'RFID')`,
      [
        eventId,
        data.eventUid,
        employee.id,
        card.id,
        device.id,
        eventType,
        toMySQLDateTime(eventTimestamp),
      ],
    );

    const { rows: eventRows } =
      await client.query(
        "SELECT * FROM attendance_events WHERE id = ?",
        [eventId],
      );

    const record = await processAttendanceEvent(
      client,
      {
        employeeId: employee.id,
        eventType,
        eventTimestamp,
      },
    );

    // Mark RFID device as online.
    await client.query(
      `UPDATE rfid_devices
       SET last_seen_at = NOW(),
           status = 'ONLINE'
       WHERE id = ?`,
      [device.id],
    );

    return {
      event: eventRows[0],
      record,
    };
  });

  // ===================================================
  // 8. RESPONSE
  // ===================================================

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


// =====================================================
// GET /attendance-events
//
// ACCESS RULES:
//
// HR       → ALL EVENTS
// CEO      → ALL EVENTS
// MANAGER  → OWN TEAM + OWN EVENTS
// EMPLOYEE → OWN EVENTS ONLY
// =====================================================

export async function listEvents(req, res) {
  const {
    employeeId: requestedEmployeeId,
    limit = 50,
  } = req.query;

  const {
    role,
    employeeId: loggedInEmployeeId,
  } = req.user;

  // ===================================================
  // BASE QUERY
  // ===================================================

  let sql = `
    SELECT
      ev.*,
      CONCAT(
        e.first_name,
        ' ',
        e.last_name
      ) AS employee_name,
      d.device_code
    FROM attendance_events ev
    JOIN employees e
      ON e.id = ev.employee_id
    JOIN rfid_devices d
      ON d.id = ev.device_id
  `;

  const conditions = [];
  const params = [];

  // ===================================================
  // HR
  // ===================================================

  if (role === "HR") {
    /*
     * HR can view all RFID events.
     *
     * If employeeId is supplied, HR can filter
     * the result to one employee.
     */

    if (requestedEmployeeId) {
      conditions.push(
        "ev.employee_id = ?",
      );

      params.push(
        requestedEmployeeId,
      );
    }
  }

  // ===================================================
  // CEO
  // ===================================================

  else if (role === "CEO") {
    /*
     * CEO can view all RFID events.
     *
     * If employeeId is supplied, CEO can filter
     * the result to one employee.
     */

    if (requestedEmployeeId) {
      conditions.push(
        "ev.employee_id = ?",
      );

      params.push(
        requestedEmployeeId,
      );
    }
  }

  // ===================================================
  // MANAGER
  // ===================================================

  else if (role === "MANAGER") {
    /*
     * Manager can ONLY see:
     *
     * 1. Employees whose manager_id is the
     *    currently logged-in manager.
     *
     * 2. The manager's own RFID events.
     *
     * This restriction is applied BEFORE any
     * requested employeeId filter.
     */

    conditions.push(
      "(e.manager_id = ? OR e.id = ?)",
    );

    params.push(
      loggedInEmployeeId,
      loggedInEmployeeId,
    );

    /*
     * If the manager requests a particular employee,
     * the employee must ALSO belong to the manager's team.
     */

    if (requestedEmployeeId) {
      conditions.push(
        "ev.employee_id = ?",
      );

      params.push(
        requestedEmployeeId,
      );
    }
  }

  // ===================================================
  // EMPLOYEE
  // ===================================================

  else if (role === "EMPLOYEE") {
    /*
     * Employees can NEVER choose another employeeId.
     *
     * We intentionally ignore requestedEmployeeId.
     *
     * The backend always uses the authenticated user's
     * employeeId.
     */

    conditions.push(
      "ev.employee_id = ?",
    );

    params.push(
      loggedInEmployeeId,
    );
  }

  // ===================================================
  // UNKNOWN ROLE
  // ===================================================

  else {
    throw new ApiError(
      403,
      "You are not authorized to view attendance events",
    );
  }

  // ===================================================
  // WHERE
  // ===================================================

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(" AND ")}`;
  }

  // ===================================================
  // VALIDATE LIMIT
  // ===================================================

  const parsedLimit = Number(limit);

  if (
    !Number.isInteger(parsedLimit) ||
    parsedLimit < 1 ||
    parsedLimit > 200
  ) {
    throw new ApiError(
      400,
      "limit must be an integer between 1 and 200",
    );
  }

  // ===================================================
  // SORT + LIMIT
  // ===================================================

  sql += `
    ORDER BY ev.event_timestamp DESC
    LIMIT ?
  `;

  params.push(parsedLimit);

  // ===================================================
  // EXECUTE QUERY
  // ===================================================

  const { rows } = await query(
    sql,
    params,
  );

  // ===================================================
  // RESPONSE
  // ===================================================

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