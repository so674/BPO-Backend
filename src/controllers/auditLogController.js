import { query } from "../config/db.js";

const getRows = (result) => {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.rows)) return result.rows;
  if (Array.isArray(result[0])) return result[0];
  return [];
};

// GET /api/audit-logs - Query recent administrative action logs
export async function getAuditLogs(req, res) {
  try {
    const sql = `
      SELECT id, user_id, action, details, ip_address, created_at 
      FROM audit_logs 
      ORDER BY created_at DESC 
      LIMIT 100
    `;
    const result = await query(sql);
    const rows = getRows(result);

    res.json({
      total: rows.length,
      logs: rows,
    });
  } catch (err) {
    console.error("Audit Logs Fetch Error:", err);
    res.status(500).json({ error: err.message || "Failed to fetch audit logs" });
  }
}