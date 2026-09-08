// src/routes/rfid.js
import { Router } from "express";
import crypto from "crypto";
import { query } from "../config/db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

/**
 * 1. ASSIGN RFID CARD TO EMPLOYEE (HR / Admin Route)
 * POST /api/rfid/assign
 */
router.post("/assign", requireAuth, requireRole(["HR", "MANAGER"]), async (req, res) => {
  try {
    const { employeeId, cardUid } = req.body;

    if (!employeeId || !cardUid) {
      return res.status(400).json({ error: "Both employeeId and cardUid are required." });
    }

    // 1. Verify employee exists and is active
    const empCheck = await query(
      "SELECT id, first_name, last_name, employee_code FROM employees WHERE id = ?", 
      [employeeId]
    );

    if (empCheck.length === 0) {
      return res.status(404).json({ error: "Employee not found." });
    }

    // 2. Check if card_uid is already assigned to another employee as ACTIVE
    const existingCard = await query(
      "SELECT id, employee_id, status FROM rfid_cards WHERE card_uid = ?",
      [cardUid]
    );

    if (existingCard.length > 0 && existingCard[0].employee_id !== employeeId && existingCard[0].status === "ACTIVE") {
      return res.status(400).json({ 
        error: "This RFID card is already actively assigned to another employee." 
      });
    }

    // 3. Retire any previously assigned active cards for this employee
    await query(
      `UPDATE rfid_cards 
       SET status = 'RETIRED', updated_at = NOW() 
       WHERE employee_id = ? AND status = 'ACTIVE'`,
      [employeeId]
    );

    // 4. Insert or update the new card mapping
    const cardId = crypto.randomUUID();
    await query(
      `INSERT INTO rfid_cards (id, card_uid, employee_id, status, assigned_at, activated_at)
       VALUES (?, ?, ?, 'ACTIVE', NOW(), NOW())
       ON DUPLICATE KEY UPDATE 
         employee_id = VALUES(employee_id),
         status = 'ACTIVE',
         activated_at = NOW(),
         updated_at = NOW()`,
      [cardId, cardUid, employeeId]
    );

    const emp = empCheck[0];
    res.json({
      success: true,
      message: `RFID Card (${cardUid}) successfully linked to ${emp.first_name} ${emp.last_name} (${emp.employee_code}).`,
      cardId
    });

  } catch (err) {
    console.error("RFID Assignment Error:", err);
    res.status(500).json({ error: "Failed to assign RFID card: " + err.message });
  }
});

/**
 * 2. PROCESS AUTOMATIC RFID CARD TAP (Hardware Device Route)
 * POST /api/rfid/tap
 */
router.post("/tap", async (req, res) => {
  try {
    const { card_uid, device_code } = req.body;
    const today = new Date().toISOString().slice(0, 10);

    if (!card_uid) {
      return res.status(400).json({ success: false, error: "Missing required parameter: card_uid." });
    }

    // 1. Resolve optional hardware device ID
    let deviceId = null;
    if (device_code) {
      const deviceRes = await query(
        "SELECT id FROM rfid_devices WHERE device_code = ? AND status = 'ACTIVE'", 
        [device_code]
      );
      if (deviceRes.length > 0) {
        deviceId = deviceRes[0].id;
      }
    }

    // 2. Query employee profile and shift details linked to this card
    const cardResults = await query(
      `SELECT rc.id AS card_id, rc.employee_id, e.first_name, e.last_name, e.employee_code, 
              s.start_time, s.grace_minutes
       FROM rfid_cards rc
       JOIN employees e ON e.id = rc.employee_id
       LEFT JOIN shifts s ON s.id = e.shift_id
       WHERE rc.card_uid = ? AND rc.status = 'ACTIVE' AND e.employment_status = 'ACTIVE'`,
      [card_uid]
    );

    if (cardResults.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Access Denied: Unregistered, blocked, or inactive RFID card."
      });
    }

    const emp = cardResults[0];
    const employeeId = emp.employee_id;
    const empName = `${emp.first_name} ${emp.last_name}`;

    // 3. Query today's existing record for this employee
    const existingRecords = await query(
      `SELECT id, punch_in, punch_out FROM attendance_records 
       WHERE employee_id = ? AND attendance_date = ?`,
      [employeeId, today]
    );

    const isPunchIn = existingRecords.length === 0;
    const eventType = isPunchIn ? "PUNCH_IN" : "PUNCH_OUT";

    // 4. Log raw hardware tap in telemetry table
    if (deviceId) {
      const eventId = crypto.randomUUID();
      const eventUid = `EVT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      await query(
        `INSERT INTO attendance_events (id, event_uid, employee_id, card_id, device_id, event_type, event_timestamp)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [eventId, eventUid, employeeId, emp.card_id, deviceId, eventType]
      );
    }

    // 5. Execute Punch Logic
    // CASE A: First Tap of the Day -> PUNCH IN
    if (isPunchIn) {
      const now = new Date();
      let status = "PRESENT";
      let lateMinutes = 0;

      // Evaluate shift start time & grace minutes threshold
      if (emp.start_time) {
        const [shiftHours, shiftMins] = emp.start_time.split(":").map(Number);
        const grace = emp.grace_minutes || 10;
        const shiftStartMins = shiftHours * 60 + shiftMins + grace;
        const arrivalMins = now.getHours() * 60 + now.getMinutes();

        if (arrivalMins > shiftStartMins) {
          status = "LATE";
          lateMinutes = arrivalMins - (shiftHours * 60 + shiftMins);
        }
      } else {
        // Default rule if no explicit shift assigned (Late after 09:15 AM)
        if (now.getHours() > 9 || (now.getHours() === 9 && now.getMinutes() > 15)) {
          status = "LATE";
          lateMinutes = (now.getHours() * 60 + now.getMinutes()) - (9 * 60);
        }
      }

      const recordId = crypto.randomUUID();
      await query(
        `INSERT INTO attendance_records (id, employee_id, attendance_date, punch_in, status, late_minutes)
         VALUES (?, ?, ?, NOW(), ?, ?)`,
        [recordId, employeeId, today, status, lateMinutes]
      );

      return res.json({
        success: true,
        action: "PUNCH_IN",
        employeeName: empName,
        employeeCode: emp.employee_code,
        statusText: "IN OFFICE NOW",
        attendanceStatus: status,
        lateMinutes,
        time: now.toLocaleTimeString()
      });
    }

    const record = existingRecords[0];

    // CASE B: Second Tap -> PUNCH OUT
    if (record.punch_in && !record.punch_out) {
      await query(
        `UPDATE attendance_records
         SET punch_out = NOW(),
             working_minutes = TIMESTAMPDIFF(MINUTE, punch_in, NOW())
         WHERE id = ?`,
        [record.id]
      );

      return res.json({
        success: true,
        action: "PUNCH_OUT",
        employeeName: empName,
        employeeCode: emp.employee_code,
        statusText: "LEFT OFFICE",
        time: new Date().toLocaleTimeString()
      });
    }

    // CASE C: Third or Subsequent Taps Today
    return res.status(400).json({
      success: false,
      message: `${empName} has already completed both shift punches for today.`
    });

  } catch (err) {
    console.error("RFID Tap Execution Error:", err);
    res.status(500).json({ success: false, error: "Internal server error: " + err.message });
  }
});

export default router;