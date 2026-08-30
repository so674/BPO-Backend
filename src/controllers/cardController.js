import { randomUUID } from "crypto";
import { z } from "zod";
import { query, withTransaction } from "../config/db.js";
import { recordAudit } from "../services/auditService.js";
import { ApiError } from "../middleware/errorHandler.js";

const mapRow = (r) => ({
  id: r.id,
  cardUid: r.card_uid,
  employeeId: r.employee_id,
  employeeName: r.employee_name,
  status: r.status,
  assignedAt: r.assigned_at,
  activatedAt: r.activated_at,
  blockedAt: r.blocked_at,
});

export async function listCards(req, res) {
  const { role, employeeId } = req.user;

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

// HR only — register a new card, initially UNASSIGNED
export async function registerCard(req, res) {
  const schema = z.object({ cardUid: z.string().min(1) });
  const { cardUid } = schema.parse(req.body);
  const id = randomUUID();

  await query("INSERT INTO rfid_cards (id, card_uid, status) VALUES (?, ?, 'UNASSIGNED')", [id, cardUid]);

  await recordAudit(null, {
    actorUserId: req.user.id,
    action: "CARD_REGISTERED",
    entityType: "RfidCard",
    entityId: id,
    newValue: cardUid,
  });

  const { rows } = await query("SELECT * FROM rfid_cards WHERE id = ?", [id]);
  res.status(201).json(mapRow(rows[0]));
}

// HR only — assign + activate a card to an employee (Section 17: assign + activate)
export async function assignCard(req, res) {
  const schema = z.object({ employeeId: z.string().min(1) });
  const { employeeId } = schema.parse(req.body);

  const { rows: result } = await query(
    `UPDATE rfid_cards
     SET employee_id = ?, status = 'ACTIVE', assigned_at = NOW(), activated_at = NOW(), updated_at = NOW()
     WHERE id = ? AND status = 'UNASSIGNED'`,
    [employeeId, req.params.id],
  );
  if (result.affectedRows === 0) throw new ApiError(409, "Card is not available for assignment");

  await recordAudit(null, {
    actorUserId: req.user.id,
    action: "CARD_ASSIGNED",
    entityType: "RfidCard",
    entityId: req.params.id,
    oldValue: "UNASSIGNED",
    newValue: `ACTIVE → ${employeeId}`,
  });

  const { rows } = await query("SELECT * FROM rfid_cards WHERE id = ?", [req.params.id]);
  res.json(mapRow(rows[0]));
}

// HR only — block a card (e.g. lost card workflow, Section 17.1)
export async function blockCard(req, res) {
  const { rows: result } = await query(
    `UPDATE rfid_cards SET status = 'BLOCKED', blocked_at = NOW(), updated_at = NOW()
     WHERE id = ? AND status = 'ACTIVE'`,
    [req.params.id],
  );
  if (result.affectedRows === 0) throw new ApiError(409, "Only an active card can be blocked");

  await recordAudit(null, {
    actorUserId: req.user.id,
    action: "CARD_BLOCKED",
    entityType: "RfidCard",
    entityId: req.params.id,
    oldValue: "ACTIVE",
    newValue: "BLOCKED",
  });

  const { rows } = await query("SELECT * FROM rfid_cards WHERE id = ?", [req.params.id]);
  res.json(mapRow(rows[0]));
}

// HR only — full lost-card workflow: block the old card, register + assign + activate a new one
// atomically, per Section 17.1 (Old card is blocked → New card assigned → New card activated).
export async function replaceCard(req, res) {
  const schema = z.object({ newCardUid: z.string().min(1) });
  const { newCardUid } = schema.parse(req.body);

  const result = await withTransaction(async (client) => {
    const { rows: oldCardBefore } = await client.query(
      "SELECT * FROM rfid_cards WHERE id = ? AND status IN ('ACTIVE', 'BLOCKED')",
      [req.params.id],
    );
    if (!oldCardBefore[0]) throw new ApiError(409, "Card cannot be replaced from its current status");
    const oldCard = oldCardBefore[0];

    await client.query(
      "UPDATE rfid_cards SET status = 'RETIRED', replaced_at = NOW(), updated_at = NOW() WHERE id = ?",
      [req.params.id],
    );

    const newId = randomUUID();
    await client.query(
      `INSERT INTO rfid_cards (id, card_uid, employee_id, status, assigned_at, activated_at)
       VALUES (?, ?, ?, 'ACTIVE', NOW(), NOW())`,
      [newId, newCardUid, oldCard.employee_id],
    );

    await recordAudit(client, {
      actorUserId: req.user.id,
      action: "CARD_REPLACED",
      entityType: "RfidCard",
      entityId: newId,
      oldValue: oldCard.card_uid,
      newValue: newCardUid,
    });

    const { rows: newCardRows } = await client.query("SELECT * FROM rfid_cards WHERE id = ?", [newId]);
    return newCardRows[0];
  });

  res.status(201).json(mapRow(result));
}

// EMPLOYEE only — self-service "lost card" report (Section 20.4). Employees cannot
// block arbitrary cards (that stays HR-only via blockCard above) — this blocks
// exactly the card assigned to the caller's own employee record, nothing else.
export async function reportLostCard(req, res) {
  const { employeeId } = req.user;
  if (!employeeId) throw new ApiError(400, "No employee profile is linked to this account");

  const { rows: cardRows } = await query(
    "SELECT * FROM rfid_cards WHERE employee_id = ? AND status = 'ACTIVE'",
    [employeeId],
  );
  const card = cardRows[0];
  if (!card) throw new ApiError(409, "You don't have an active card to report as lost");

  await query(
    "UPDATE rfid_cards SET status = 'BLOCKED', blocked_at = NOW(), updated_at = NOW() WHERE id = ?",
    [card.id],
  );

  await recordAudit(null, {
    actorUserId: req.user.id,
    action: "CARD_REPORTED_LOST",
    entityType: "RfidCard",
    entityId: card.id,
    oldValue: "ACTIVE",
    newValue: "BLOCKED",
  });

  const { rows } = await query("SELECT * FROM rfid_cards WHERE id = ?", [card.id]);
  res.json(mapRow(rows[0]));
}

export { mapRow as mapCardRow };
