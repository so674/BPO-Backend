import { randomUUID } from "crypto";
import { z } from "zod";
import { query, withTransaction } from "../config/db.js";
import { recordAudit } from "../services/auditService.js";
import { ApiError } from "../middleware/errorHandler.js";

const mapRow = (r) => ({
  id: r.id,
  cardUid: r.card_uid,
  employeeId: r.employee_id,
  employeeName: r.employee_name || "",
  status: r.status,
  assignedAt: r.assigned_at,
  activatedAt: r.activated_at,
  blockedAt: r.blocked_at,
});

// Helper for single card fetch with joined employee name
const getCardWithEmployee = async (id) => {
  const { rows } = await query(
    `SELECT c.*, CONCAT(e.first_name, ' ', e.last_name) AS employee_name
     FROM rfid_cards c
     LEFT JOIN employees e ON e.id = c.employee_id
     WHERE c.id = ?`,
    [id]
  );
  return rows[0];
};

// 1. GET /api/cards - List all cards
export async function listCards(req, res) {
  const { role, employeeId } = req.user || {};

  let sql = `
    SELECT c.*, CONCAT(e.first_name, ' ', e.last_name) AS employee_name
    FROM rfid_cards c
    LEFT JOIN employees e ON e.id = c.employee_id
  `;
  const params = [];

  if (role === "EMPLOYEE") {
    sql += " WHERE c.employee_id = ?";
    params.push(employeeId);
  }

  sql += " ORDER BY c.card_uid";
  const { rows } = await query(sql, params);
  res.json(rows.map(mapRow));
}

// 2. POST /api/cards - Register a new unassigned card
export async function registerCard(req, res) {
  const schema = z.object({ cardUid: z.string().min(1) });
  const { cardUid } = schema.parse(req.body);
  const id = randomUUID();

  await query("INSERT INTO rfid_cards (id, card_uid, status) VALUES (?, ?, 'UNASSIGNED')", [id, cardUid]);

  try {
    if (typeof recordAudit === "function") {
      await recordAudit(null, {
        actorUserId: req.user?.id || "SYSTEM",
        action: "CARD_REGISTERED",
        entityType: "RfidCard",
        entityId: id,
        newValue: cardUid,
      });
    }
  } catch (err) {
    console.warn("Audit log skipped:", err.message);
  }

  const card = await getCardWithEmployee(id);
  res.status(201).json(mapRow(card));
}

// 3. POST /api/cards/:id/assign - Assign & activate card
export async function assignCard(req, res) {
  const schema = z.object({ employeeId: z.string().min(1) });
  const { employeeId } = schema.parse(req.body);

  const { rows: result } = await query(
    `UPDATE rfid_cards
     SET employee_id = ?, status = 'ACTIVE', assigned_at = NOW(), activated_at = NOW(), updated_at = NOW()
     WHERE id = ? AND status = 'UNASSIGNED'`,
    [employeeId, req.params.id]
  );

  const card = await getCardWithEmployee(req.params.id);
  if (!card) throw new ApiError(404, "Card not found");

  try {
    if (typeof recordAudit === "function") {
      await recordAudit(null, {
        actorUserId: req.user?.id || "SYSTEM",
        action: "CARD_ASSIGNED",
        entityType: "RfidCard",
        entityId: req.params.id,
        oldValue: "UNASSIGNED",
        newValue: `ACTIVE → ${employeeId}`,
      });
    }
  } catch (err) {
    console.warn("Audit log skipped:", err.message);
  }

  res.json(mapRow(card));
}

// 4. POST /api/cards/:id/block - Block active card
export async function blockCard(req, res) {
  await query(
    `UPDATE rfid_cards SET status = 'BLOCKED', blocked_at = NOW(), updated_at = NOW()
     WHERE id = ?`,
    [req.params.id]
  );

  const card = await getCardWithEmployee(req.params.id);
  if (!card) throw new ApiError(404, "Card not found");

  try {
    if (typeof recordAudit === "function") {
      await recordAudit(null, {
        actorUserId: req.user?.id || "SYSTEM",
        action: "CARD_BLOCKED",
        entityType: "RfidCard",
        entityId: req.params.id,
        oldValue: "ACTIVE",
        newValue: "BLOCKED",
      });
    }
  } catch (err) {
    console.warn("Audit log skipped:", err.message);
  }

  res.json(mapRow(card));
}

// 5. POST /api/cards/:id/replace - Replace card
export async function replaceCard(req, res) {
  const schema = z.object({ newCardUid: z.string().min(1) });
  const { newCardUid } = schema.parse(req.body);

  const newId = randomUUID();

  const { rows: oldCards } = await query("SELECT * FROM rfid_cards WHERE id = ?", [req.params.id]);
  const oldCard = oldCards[0];
  if (!oldCard) throw new ApiError(404, "Card not found");

  await query(
    "UPDATE rfid_cards SET status = 'RETIRED', replaced_at = NOW(), updated_at = NOW() WHERE id = ?",
    [req.params.id]
  );

  await query(
    `INSERT INTO rfid_cards (id, card_uid, employee_id, status, assigned_at, activated_at)
     VALUES (?, ?, ?, 'ACTIVE', NOW(), NOW())`,
    [newId, newCardUid, oldCard.employee_id]
  );

  const newCard = await getCardWithEmployee(newId);
  res.status(201).json(mapRow(newCard));
}

// 6. POST /api/cards/me/report-lost - Self-service lost card report
export async function reportLostCard(req, res) {
  const { employeeId } = req.user || {};
  if (!employeeId) throw new ApiError(400, "No employee profile is linked to this account");

  const { rows: cardRows } = await query(
    "SELECT * FROM rfid_cards WHERE employee_id = ? AND status = 'ACTIVE'",
    [employeeId]
  );
  const card = cardRows[0];
  if (!card) throw new ApiError(409, "You don't have an active card to report as lost");

  await query(
    "UPDATE rfid_cards SET status = 'BLOCKED', blocked_at = NOW(), updated_at = NOW() WHERE id = ?",
    [card.id]
  );

  const updatedCard = await getCardWithEmployee(card.id);
  res.json(mapRow(updatedCard));
}

export { mapRow as mapCardRow };