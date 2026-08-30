import { randomUUID } from "crypto";
import { z } from "zod";
import { query } from "../config/db.js";
import { recordAudit } from "../services/auditService.js";

const mapRow = (r) => ({
  id: r.id,
  deviceCode: r.device_code,
  name: r.device_name,
  location: r.location,
  type: r.device_type,
  status: r.status,
  lastSeenAt: r.last_seen_at,
});

export async function listDevices(req, res) {
  const { rows } = await query("SELECT * FROM rfid_devices ORDER BY device_code");
  res.json(rows.map(mapRow));
}

// HR only — register a new reader (Section 9.2)
export async function registerDevice(req, res) {
  const schema = z.object({
    deviceCode: z.string().min(1),
    name: z.string().min(1),
    location: z.string().optional(),
    type: z.enum(["ENTRY", "EXIT"]),
  });
  const data = schema.parse(req.body);
  const id = randomUUID();

  await query(
    `INSERT INTO rfid_devices (id, device_code, device_name, location, device_type, status)
     VALUES (?,?,?,?,?,'OFFLINE')`,
    [id, data.deviceCode, data.name, data.location ?? null, data.type],
  );

  await recordAudit(null, {
    actorUserId: req.user.id,
    action: "DEVICE_REGISTERED",
    entityType: "RfidDevice",
    entityId: id,
    newValue: data.deviceCode,
  });

  const { rows } = await query("SELECT * FROM rfid_devices WHERE id = ?", [id]);
  res.status(201).json(mapRow(rows[0]));
}

export async function getDeviceHealth(req, res) {
  const { rows } = await query(`
    SELECT device_code, status, last_seen_at,
      CASE WHEN last_seen_at < NOW() - INTERVAL 10 MINUTE THEN true ELSE false END AS stale
    FROM rfid_devices
    ORDER BY device_code
  `);
  res.json(rows);
}
