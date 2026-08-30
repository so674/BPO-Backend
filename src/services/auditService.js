import { randomUUID } from "crypto";
import { query } from "../config/db.js";

// Section 34: every privileged administrative action should be attributable, with
// old/new value captured where relevant. Controllers call this after a successful mutation.
export async function recordAudit(client, { actorUserId, action, entityType, entityId, oldValue, newValue, ipAddress }) {
  const run = client ? client.query.bind(client) : query;
  await run(
    `INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, old_value, new_value, ip_address)
     VALUES (?,?,?,?,?,?,?,?)`,
    [randomUUID(), actorUserId, action, entityType, String(entityId), oldValue ?? null, newValue ?? null, ipAddress ?? null],
  );
}
