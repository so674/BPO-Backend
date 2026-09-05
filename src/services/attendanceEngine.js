// import { randomUUID } from "crypto";

// // ────────────────────────────────────────────────────────────────
// // Attendance Processing Engine
// // Implements Section 13 (Processing Sequence) and Section 13.2 (Working-Hour Formula)
// // of the master document.
// //
// // Called AFTER a raw event has been validated and persisted. Loads/creates the day's
// // attendance record, applies shift + grace rules, computes status + working hours.
// // ────────────────────────────────────────────────────────────────

// /**
//  * @param {object} client - a MySQL client already inside a transaction (query(sql, params) -> {rows})
//  * @param {object} params
//  * @param {string} params.employeeId
//  * @param {string} params.eventType - 'PUNCH_IN' | 'PUNCH_OUT'
//  * @param {Date} params.eventTimestamp
//  */
// export async function processAttendanceEvent(client, { employeeId, eventType, eventTimestamp }) {
//   const attendanceDate = eventTimestamp.toISOString().slice(0, 10);

//   // Load the employee's shift so we can apply grace-period rules
//   const { rows: empRows } = await client.query(
//     `SELECT e.id, s.start_time, s.grace_minutes
//      FROM employees e
//      LEFT JOIN shifts s ON s.id = e.shift_id
//      WHERE e.id = ?`,
//     [employeeId],
//   );
//   const employee = empRows[0];

//   // Load or create today's attendance record
//   const { rows: existing } = await client.query(
//     `SELECT * FROM attendance_records WHERE employee_id = ? AND attendance_date = ?`,
//     [employeeId, attendanceDate],
//   );

//   let record = existing[0];

//   if (!record) {
//     const id = randomUUID();
//     await client.query(
//       `INSERT INTO attendance_records (id, employee_id, attendance_date, status)
//        VALUES (?, ?, ?, 'MISSING_PUNCH')`,
//       [id, employeeId, attendanceDate],
//     );
//     const { rows: created } = await client.query("SELECT * FROM attendance_records WHERE id = ?", [id]);
//     record = created[0];
//   }

//   if (eventType === "PUNCH_IN") {
//     // Business rule: one punch-in allowed per shift/day — keep the earliest punch-in of the day
//     if (!record.punch_in) {
//       const { late, lateMinutes } = calculateLateness(eventTimestamp, employee?.start_time, employee?.grace_minutes ?? 10);
//       const status = late ? "LATE" : "PRESENT";

//       await client.query(
//         `UPDATE attendance_records
//          SET punch_in = ?, late_minutes = ?, status = ?, updated_at = NOW()
//          WHERE id = ?`,
//         [formatDateTime(eventTimestamp), lateMinutes, status, record.id],
//       );
//       const { rows: updated } = await client.query("SELECT * FROM attendance_records WHERE id = ?", [record.id]);
//       record = updated[0];
//     }
//   }

//   // if (eventType === "PUNCH_OUT") {
//   //   // Business rule: punch-out requires a valid punch-in
//   //   if (record.punch_in && !record.punch_out) {
//   //     const workingMinutes = calculateWorkingMinutes(record.punch_in, eventTimestamp);
//   //     await client.query(
//   //       `UPDATE attendance_records
//   //        SET punch_out = ?, working_minutes = ?, updated_at = NOW()
//   //        WHERE id = ?`,
//   //       [formatDateTime(eventTimestamp), workingMinutes, record.id],
//   //     );
//   //     const { rows: updated } = await client.query("SELECT * FROM attendance_records WHERE id = ?", [record.id]);
//   //     record = updated[0];
//   //   }
//   //   // If there's no punch-in yet, the punch-out event is still stored as an event
//   //   // (events are evidence) but the record stays MISSING_PUNCH until reviewed.
//   // }
//   if (eventType === "PUNCH_OUT") {
//     if (record.punch_in && !record.punch_out) {
//       const workingMinutes = calculateWorkingMinutes(
//         record.punch_in,
//         eventTimestamp
//       );

//       await client.query(
//         `UPDATE attendance_records
//        SET punch_out = ?, working_minutes = ?, updated_at = NOW()
//        WHERE id = ?`,
//         [
//           formatDateTime(eventTimestamp),
//           workingMinutes,
//           record.id
//         ],
//       );

//       const { rows: updated } = await client.query(
//         "SELECT * FROM attendance_records WHERE id = ?",
//         [record.id]
//       );

//       record = updated[0];
//     }
//   }

//   return record;
// }

// // MySQL DATETIME columns want 'YYYY-MM-DD HH:MM:SS', not a JS Date object
// function formatDateTime(date) {
//   return date.toISOString().slice(0, 19).replace("T", " ");
// }

// // Section 13.2: Working Minutes = Punch Out − Punch In (no break deduction in V1)
// function calculateWorkingMinutes(punchIn, punchOut) {
//   const inTime = new Date(punchIn).getTime();
//   const outTime = new Date(punchOut).getTime();
//   return Math.max(0, Math.round((outTime - inTime) / 60000));
// }

// // "Late if IN time > Shift Start + Grace"
// function calculateLateness(eventTimestamp, shiftStartTime, graceMinutes) {
//   if (!shiftStartTime) return { late: false, lateMinutes: 0 };

//   const [h, m] = String(shiftStartTime).split(":").map(Number);
//   const shiftStart = new Date(eventTimestamp);
//   shiftStart.setHours(h, m, 0, 0);
//   shiftStart.setMinutes(shiftStart.getMinutes() + graceMinutes);

//   const diffMinutes = Math.round((eventTimestamp.getTime() - shiftStart.getTime()) / 60000);
//   return diffMinutes > 0 ? { late: true, lateMinutes: diffMinutes } : { late: false, lateMinutes: 0 };
// }
import { randomUUID } from "crypto";

// ────────────────────────────────────────────────────────────────
// Attendance Processing Engine
//
// Responsibilities:
// 1. Load employee shift information
// 2. Determine attendance date using Asia/Kolkata
// 3. Create/load daily attendance record
// 4. Process PUNCH_IN
// 5. Process PUNCH_OUT
// 6. Prevent duplicate punch-in / punch-out updates
// 7. Calculate late minutes
// 8. Calculate working minutes
//
// Business timezone:
// Asia/Kolkata
// ────────────────────────────────────────────────────────────────

const BUSINESS_TIMEZONE = "Asia/Kolkata";

/**
 * Process a validated RFID attendance event.
 *
 * @param {object} client
 * @param {object} params
 * @param {string} params.employeeId
 * @param {string} params.eventType
 * @param {Date} params.eventTimestamp
 */
export async function processAttendanceEvent(
  client,
  {
    employeeId,
    eventType,
    eventTimestamp,
  },
) {
  // ------------------------------------------------------------
  // Validate event timestamp
  // ------------------------------------------------------------

  if (
    !(eventTimestamp instanceof Date) ||
    Number.isNaN(eventTimestamp.getTime())
  ) {
    throw new Error("Invalid attendance event timestamp");
  }

  // ------------------------------------------------------------
  // Determine attendance date in Kolkata time
  // ------------------------------------------------------------

  const attendanceDate =
    getBusinessDate(eventTimestamp);

  // ------------------------------------------------------------
  // Load employee shift
  // ------------------------------------------------------------

  const { rows: empRows } =
    await client.query(
      `SELECT
         e.id,
         s.start_time,
         s.grace_minutes
       FROM employees e
       LEFT JOIN shifts s
         ON s.id = e.shift_id
       WHERE e.id = ?`,
      [employeeId],
    );

  const employee = empRows[0];

  if (!employee) {
    throw new Error("Employee not found");
  }

  // ------------------------------------------------------------
  // Load today's attendance record
  // ------------------------------------------------------------
//to calculate the nigt=ht shift and if the employee forget to punchout after 9 hours complete it automatic say missing employee.
//calculate shif //(04/09/2026)
  const { rows: existing } =
    await client.query(
      `SELECT *
       FROM attendance_records
       WHERE employee_id = ?       
         AND punch_out IS NULL
         AND punch_in >= DATE_SUB(? , INTERVAL 16 HOURS) 
      ORDER BY punch_in DESC
      LIMIT 1   
         
       FOR UPDATE`,
      [
        employeeId,
        // attendanceDate,
        eventTimestamp
      ],
    );

  let record = existing[0];

  // ------------------------------------------------------------
  // Create attendance record if it doesn't exist
  // ------------------------------------------------------------

  if (!record) {
    const id = randomUUID();

    await client.query(
      `INSERT INTO attendance_records
        (
          id,
          employee_id,
          attendance_date,
          status
        )
       VALUES (?, ?, ?, 'MISSING_PUNCH')`,
      [
        id,
        employeeId,
        attendanceDate,
      ],
    );

    const { rows: created } =
      await client.query(
        `SELECT *
         FROM attendance_records
         WHERE id = ?`,
        [id],
      );

    record = created[0];
  }

  // ============================================================
  // PUNCH IN
  // ============================================================

  if (eventType === "PUNCH_IN") {

    // ----------------------------------------------------------
    // Duplicate PUNCH_IN protection
    //
    // First valid punch-in is preserved.
    // Any later punch-in event is stored in attendance_events
    // but does NOT overwrite attendance_records.punch_in.
    // ----------------------------------------------------------

    if (!record.punch_in) {

      const {
        late,
        lateMinutes,
      } = calculateLateness(
        eventTimestamp,
        employee.start_time,
        employee.grace_minutes ?? 10,
      );

      const status =
        late
          ? "LATE"
          : "PRESENT";

      await client.query(
        `UPDATE attendance_records
         SET
           punch_in = ?,
           late_minutes = ?,
           status = ?,
           updated_at = NOW()
         WHERE id = ?`,
        [
          formatDateTime(eventTimestamp),
          lateMinutes,
          status,
          record.id,
        ],
      );

      const { rows: updated } =
        await client.query(
          `SELECT *
           FROM attendance_records
           WHERE id = ?`,
          [record.id],
        );

      record = updated[0];
    }

    // If punch_in already exists:
    // intentionally do nothing.
  }

  // ============================================================
  // PUNCH OUT
  // ============================================================

  if (eventType === "PUNCH_OUT") {
  // 1. Search for an open shift within the 16-hour lookback window 🔍
  const [existing] = await client.query(
    `SELECT *
     FROM attendance_records
     WHERE employee_id = ?
       AND punch_out IS NULL
       AND punch_in >= DATE_SUB(?, INTERVAL 16 HOUR)
     ORDER BY punch_in DESC
     LIMIT 1
     FOR UPDATE`,
    [employeeId, eventTimestamp]
  );

  let record = existing[0];

  if (record) {
    // 2A. Matched Shift: Calculate working minutes and UPDATE existing record ⏱️
    const workingMinutes = calculateWorkingMinutes(
      record.punch_in,
      eventTimestamp
    );

    await client.query(
      `UPDATE attendance_records
       SET
         punch_out = ?,
         working_minutes = ?,
         status = CASE WHEN status = 'LATE' THEN 'LATE' ELSE 'PRESENT' END,
         updated_at = NOW()
       WHERE id = ?`,
      [formatDateTime(eventTimestamp), workingMinutes, record.id]
    );

    const [updated] = await client.query(
      `SELECT * FROM attendance_records WHERE id = ?`,
      [record.id]
    );
    record = updated[0];

  } else {
    // 2B. Orphan Check-out: Create a flagged MISSING_PUNCH record 🚩
    const newRecordId = crypto.randomUUID();

    await client.query(
      `INSERT INTO attendance_records (
         id,
         employee_id,
         attendance_date,
         punch_in,
         punch_out,
         working_minutes,
         status
       ) VALUES (?, ?, ?, NULL, ?, 0, 'MISSING_PUNCH')`,
      [newRecordId, employeeId, attendanceDate, formatDateTime(eventTimestamp)]
    );

    const [inserted] = await client.query(
      `SELECT * FROM attendance_records WHERE id = ?`,
      [newRecordId]
    );
    record = inserted[0];
  }

  return record;
}


// ============================================================
// BUSINESS DATE
// ============================================================
//
// Returns YYYY-MM-DD using Asia/Kolkata.
//
// IMPORTANT:
// Do NOT use:
// eventTimestamp.toISOString().slice(0, 10)
//
// because that uses UTC.
// ============================================================

function getBusinessDate(date) {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: BUSINESS_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    },
  ).format(date);
}


// ============================================================
// BUSINESS DATETIME
// ============================================================
//
// Converts JS Date into:
// YYYY-MM-DD HH:MM:SS
//
// using Asia/Kolkata.
// ============================================================

function formatDateTime(date) {
  const parts = new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: BUSINESS_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    },
  ).formatToParts(date);

  const values = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  return `${values.year}-${values.month}-${values.day} ` +
    `${values.hour}:${values.minute}:${values.second}`;
}


// ============================================================
// WORKING MINUTES
// ============================================================
//
// Working Minutes = Punch Out - Punch In
//
// No break deduction in V1.
//
// MySQL DATETIME values are interpreted as business-local
// attendance times, so calculate the difference using the
// actual stored timestamps.
// ============================================================

function calculateWorkingMinutes(
  punchIn,
  punchOut,
) {
  const inTime =
    parseMySQLDateTime(punchIn);

  const outTime =
    punchOut instanceof Date
      ? punchOut
      : parseMySQLDateTime(punchOut);

  if (
    Number.isNaN(inTime.getTime()) ||
    Number.isNaN(outTime.getTime())
  ) {
    return 0;
  }

 const difference = outTime.getTime() - inTime.getTime();

return Math.max(
  0,
  Math.round(
    difference / 60000,
  ),
);
}


// ============================================================
// MYSQL DATETIME PARSER
// ============================================================
//
// Converts:
// YYYY-MM-DD HH:MM:SS
//
// into a Date representing Kolkata local time.
// ============================================================

function parseMySQLDateTime(value) {
  if (value instanceof Date) {
    return value;
  }

  const match =
    String(value).match(
      /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/,
    );

  if (!match) {
    return new Date(value);
  }

  const [
    ,
    year,
    month,
    day,
    hour,
    minute,
    second,
  ] = match;

  /*
   * The MySQL DATETIME represents business-local
   * Asia/Kolkata time.
   *
   * Convert that local time to a UTC timestamp
   * explicitly so working-minute calculations remain
   * correct regardless of the server's local timezone.
   */

  const utcMillis =
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ) -
    330 * 60 * 1000;

  return new Date(utcMillis);
}


// ============================================================
// LATE CALCULATION
// ============================================================
//
// Late if:
// Punch-In > Shift Start + Grace Period
// ============================================================

function calculateLateness(
  eventTimestamp,
  shiftStartTime,
  graceMinutes,
) {
  if (!shiftStartTime) {
    return {
      late: false,
      lateMinutes: 0,
    };
  }

  const timeParts =
    String(shiftStartTime)
      .split(":")
      .map(Number);

  const hours = timeParts[0] ?? 0;
  const minutes = timeParts[1] ?? 0;

  // Build shift start on the same business date
  // as the RFID punch.
  const businessDate =
    getBusinessDate(eventTimestamp);

  const [year, month, day] =
    businessDate
      .split("-")
      .map(Number);

  /*
   * Create the shift start as Kolkata local time.
   */

  const shiftStartUtc =
    Date.UTC(
      year,
      month - 1,
      day,
      hours,
      minutes,
      0,
    ) -
    330 * 60 * 1000;

  const shiftStart =
    new Date(shiftStartUtc);

  shiftStart.setUTCMinutes(
    shiftStart.getUTCMinutes() +
      Number(graceMinutes || 0),
  );

  const diffMinutes =
    Math.round(
      (
        eventTimestamp.getTime() -
        shiftStart.getTime()
      ) / 60000,
    );

  if (diffMinutes > 0) {
    return {
      late: true,
      lateMinutes: diffMinutes,
    };
  }

  return {
    late: false,
    lateMinutes: 0,
  };
}
}