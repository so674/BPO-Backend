import { query } from "../config/db.js";

// Safe helper to extract query results
const getRows = (result) => {
  if (!result) return [];
  if (Array.isArray(result)) {
    return Array.isArray(result[0]) ? result[0] : result;
  }
  return result.rows || [];
};

// GET /api/audit-logs
export async function getAuditLogs(req, res) {
  try {
    const dbResult = await query("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100");
    const rows = getRows(dbResult);

    const mapped = rows.map((r) => ({
      id: r.id,
      actorUserId: r.actor_user_id || r.actor_id || r.user_id || "SYSTEM",
      actorName: r.actor_name || r.actor_email || "System",
      action: r.action || "UNKNOWN_ACTION",
      entityType: r.entity_type || "General",
      entityId: r.entity_id || "—",
      oldValue: r.old_value || "—",
      newValue: r.new_value || r.details || "—",
      ipAddress: r.ip_address || "—",
      createdAt: r.created_at || r.timestamp || new Date().toISOString(),
    }));

    res.json(mapped);
  } catch (err) {
    console.error("Audit Logs Fetch Error:", err);
    res.status(500).json({ error: err.message || "Failed to fetch audit logs" });
  }
}