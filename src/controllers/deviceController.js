import { randomUUID } from "crypto";
import { z } from "zod";
import { query } from "../config/db.js";
import { recordAudit } from "../services/auditService.js";
import { ApiError } from "../middleware/errorHandler.js";

// Helper to safely extract database rows
const getRows = (result) => {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.rows)) return result.rows;
  if (result && Array.isArray(result[0])) return result[0];
  return [];
};

// Helper to format date for MySQL DATETIME
const toMySQLDateTime = (d = new Date()) => {
  const date = new Date(d);
  return date.toISOString().slice(0, 19).replace("T", " ");
};

const mapRow = (r) => ({
  id: r.id,
  deviceCode: r.device_code,
  name: r.device_name,
  location: r.location,
  type: r.device_type,
  status: r.status,
  lastSeenAt: r.last_seen_at,
});

// 1. GET /api/devices - List all registered devices
export async function listDevices(req, res) {
  const result = await query("SELECT * FROM rfid_devices ORDER BY device_code");
  const rows = getRows(result);
  res.json(rows.map(mapRow));
}
// 2. POST /api/devices/register - Register a new reader (HR / Admin)
export async function registerDevice(req, res) {
  const schema = z.object({
    deviceCode: z.string().min(1),
    name: z.string().min(1),
    location: z.string().optional(),
    type: z.enum(["ENTRY", "EXIT"]),
  });

  const data = schema.parse(req.body);
  const id = `dev-${Date.now()}`;

  // Check if device_code already exists
  const existingRes = await query("SELECT id FROM rfid_devices WHERE device_code = ?", [data.deviceCode]);
  if (getRows(existingRes).length > 0) {
    throw new ApiError(400, "Device code already exists");
  }

  await query(
    `INSERT INTO rfid_devices (id, device_code, device_name, location, device_type, status)
     VALUES (?, ?, ?, ?, ?, 'OFFLINE')`,
    [id, data.deviceCode, data.name, data.location ?? null, data.type]
  );

  // Safely record audit log without failing request if table missing
  try {
    if (typeof recordAudit === "function") {
      await recordAudit(null, {
        actorUserId: req.user?.id || "SYSTEM",
        action: "DEVICE_REGISTERED",
        entityType: "RfidDevice",
        entityId: id,
        newValue: data.deviceCode,
      });
    }
  } catch (auditErr) {
    console.warn("Audit logging warning:", auditErr.message);
  }

  const result = await query("SELECT * FROM rfid_devices WHERE id = ?", [id]);
  const rows = getRows(result);
  res.status(201).json({ device: mapRow(rows[0]) });
}

// 3. GET /api/devices/health - Device health and stale status check
export async function getDeviceHealth(req, res) {
  const result = await query(`
    SELECT device_code, device_name, status, last_seen_at,
      CASE 
        WHEN last_seen_at IS NULL THEN true
        WHEN last_seen_at < NOW() - INTERVAL 10 MINUTE THEN true 
        ELSE false 
      END AS stale
    FROM rfid_devices
    ORDER BY device_code
  `);
  const rows = getRows(result);
  res.json({ devices: rows });
}

// 4. POST /api/devices/heartbeat - Keep-alive signal from RFID reader
export async function heartbeat(req, res) {
  const schema = z.object({
    deviceCode: z.string().min(1),
  });
  const { deviceCode } = schema.parse(req.body);

  const result = await query("SELECT id FROM rfid_devices WHERE device_code = ?", [deviceCode]);
  const rows = getRows(result);

  if (rows.length === 0) {
    throw new ApiError(404, "Device not registered");
  }

  await query(
    `UPDATE rfid_devices 
     SET last_seen_at = NOW(), status = 'ONLINE' 
     WHERE device_code = ?`,
    [deviceCode]
  );

  res.json({ message: "Heartbeat acknowledged", status: "ONLINE", deviceCode });
}

// 5. POST /api/devices/events/ingest - Process RFID card taps from devices
export async function ingestEvent(req, res) {
  try {
    const schema = z.object({
      deviceCode: z.string().min(1),
      cardNumber: z.string().min(1),
      timestamp: z.string().optional(),
    });

    const { deviceCode, cardNumber, timestamp } = schema.parse(req.body || {});
    const scanTime = timestamp ? new Date(timestamp) : new Date();
    const formattedScanTime = toMySQLDateTime(scanTime);
    const today = scanTime.toISOString().slice(0, 10);

    // 1. Verify Device
    const devRes = await query("SELECT * FROM rfid_devices WHERE device_code = ?", [deviceCode]);
    const devices = getRows(devRes);
    if (devices.length === 0) {
      return res.status(404).json({ error: `Unregistered device code: ${deviceCode}` });
    }
    const device = devices[0];

    // Update device health status
    await query("UPDATE rfid_devices SET last_seen_at = NOW(), status = 'ONLINE' WHERE id = ?", [device.id]);

    // 2. Find Employee by RFID Card
    const cardRes = await query("SELECT * FROM rfid_cards WHERE card_number = ? AND status = 'ACTIVE'", [cardNumber]);
    const cards = getRows(cardRes);
    if (cards.length === 0) {
      return res.status(404).json({ error: `Card not recognized or inactive: ${cardNumber}` });
    }
    const employeeId = cards[0].employee_id;

    // 3. Process Attendance based on Device Type (ENTRY vs EXIT)
    const attRes = await query(
      "SELECT * FROM attendance_records WHERE employee_id = ? AND attendance_date = ?",
      [employeeId, today]
    );
    const existingAtt = getRows(attRes);

    if (device.device_type === "ENTRY") {
      if (existingAtt.length > 0 && existingAtt[0].punch_in) {
        return res.json({ message: "Already checked in for today", employeeId });
      }

      const shiftStart = new Date(scanTime);
      shiftStart.setHours(9, 15, 0, 0);
      const status = scanTime > shiftStart ? "LATE" : "PRESENT";
      const lateMinutes = scanTime > shiftStart ? Math.floor((scanTime - shiftStart) / 60000) : 0;
      const recordId = existingAtt.length > 0 ? existingAtt[0].id : `att-${Date.now()}`;

      if (existingAtt.length > 0) {
        await query(
          `UPDATE attendance_records SET punch_in = ?, status = ?, late_minutes = ? WHERE id = ?`,
          [formattedScanTime, status, lateMinutes, recordId]
        );
      } else {
        await query(
          `INSERT INTO attendance_records (id, employee_id, attendance_date, punch_in, status, late_minutes, note)
           VALUES (?, ?, ?, ?, ?, ?, 'RFID ENTRY Tap')`,
          [recordId, employeeId, today, formattedScanTime, status, lateMinutes]
        );
      }

      return res.status(201).json({ message: "Check-in successful", employeeId, status });
    } else if (device.device_type === "EXIT") {
      if (existingAtt.length === 0 || !existingAtt[0].punch_in) {
        return res.status(400).json({ error: "Cannot check out without check-in record for today" });
      }

      const record = existingAtt[0];
      const punchInTime = new Date(record.punch_in);
      const workingMinutes = Math.max(0, Math.floor((scanTime - punchInTime) / 60000));

      await query(
        `UPDATE attendance_records 
         SET punch_out = ?, working_minutes = ?, note = 'RFID EXIT Tap' 
         WHERE id = ?`,
        [formattedScanTime, workingMinutes, record.id]
      );

      return res.json({ message: "Check-out successful", employeeId, workingMinutes });
    } else {
      return res.status(400).json({ error: `Invalid device type: ${device.device_type}` });
    }
  } catch (err) {
    console.error("Ingest Event Error:", err);
    return res.status(500).json({ error: err.message || "Failed to ingest event" });
  }
}