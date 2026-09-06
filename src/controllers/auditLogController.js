import { query } from "../config/db.js";

// Helper to safely extract rows across database pool configurations
const getRows = (result) => {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.rows)) return result.rows;
  if (Array.isArray(result[0])) return result[0];
  return [];
};

const mapAuditRow = (r) => ({
  id: r.id,
  actorUserId: r.actor_user_id || r.user_id || "SYSTEM",
  actorName: r.actor_name || r.actor_email || "System",
  action: r.action || "UNKNOWN_ACTION",
  entityType: r.entity_type || "General",
  entityId: r.entity_id || "—",
  oldValue: r.old_value || "—",
  newValue: r.new_value || r.details || "—",
  ipAddress: r.ip_address || "—",
  createdAt: r.created_at,
});

// GET /api/audit-logs - Query recent administrative action logs
export async function getAuditLogs(req, res) {
  try {
    const sql = `
      SELECT a.*, 
             COALESCE(u.email, u.id) AS actor_name
      FROM audit_logs a
      LEFT JOIN users u ON u.id = COALESCE(a.actor_user_id, a.user_id)
      ORDER BY a.created_at DESC 
      LIMIT 100
    `;
    const result = await query(sql);
    const rows = getRows(result);

    // 🟢 FIX: Return flat array directly with mapped camelCase keys
    res.json(rows.map(mapAuditRow));
  } catch (err) {
    console.error("Audit Logs Fetch Error:", err);
    res.status(500).json({ error: err.message || "Failed to fetch audit logs" });
  }
}