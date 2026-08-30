import { randomUUID } from "crypto";
import { z } from "zod";
import { query } from "../config/db.js";
import { recordAudit } from "../services/auditService.js";
import { ApiError } from "../middleware/errorHandler.js";

const employeeSchema = z.object({
  employeeCode: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  departmentId: z.string().min(1),
  designation: z.string().optional(),
  shiftId: z.string().min(1),
  managerId: z.string().optional().nullable(),
  joiningDate: z.string(), // YYYY-MM-DD
});

const mapRow = (r) => ({
  id: r.id,
  employeeCode: r.employee_code,
  firstName: r.first_name,
  lastName: r.last_name,
  email: r.email,
  phone: r.phone,
  departmentId: r.department_id,
  departmentName: r.department_name,
  designation: r.designation,
  shiftId: r.shift_id,
  shiftName: r.shift_name,
  employmentStatus: r.employment_status,
  managerId: r.manager_id,
  joiningDate: r.joining_date,
});

// HR sees everyone. Manager sees their direct reports. CEO sees everyone (read-only, enforced by route guard).
export async function listEmployees(req, res) {
  const { role, employeeId } = req.user;

  let sql = `
    SELECT e.*, d.name AS department_name, s.name AS shift_name
    FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN shifts s ON s.id = e.shift_id
  `;
  const params = [];

  if (role === "MANAGER") {
    sql += ` WHERE e.manager_id = ? OR e.id = ?`;
    params.push(employeeId, employeeId);
  }

  sql += " ORDER BY e.employee_code";
  const { rows } = await query(sql, params);
  res.json(rows.map(mapRow));
}

export async function getEmployee(req, res) {
  const { rows } = await query(
    `SELECT e.*, d.name AS department_name, s.name AS shift_name
     FROM employees e
     LEFT JOIN departments d ON d.id = e.department_id
     LEFT JOIN shifts s ON s.id = e.shift_id
     WHERE e.id = ?`,
    [req.params.id],
  );
  if (!rows[0]) throw new ApiError(404, "Employee not found");
  res.json(mapRow(rows[0]));
}

// HR only (enforced by route guard)
export async function createEmployee(req, res) {
  const data = employeeSchema.parse(req.body);
  const id = randomUUID();

  await query(
    `INSERT INTO employees (id, employee_code, first_name, last_name, email, phone, department_id, designation, shift_id, manager_id, joining_date)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, data.employeeCode, data.firstName, data.lastName, data.email, data.phone ?? null, data.departmentId, data.designation ?? null, data.shiftId, data.managerId ?? null, data.joiningDate],
  );

  await recordAudit(null, {
    actorUserId: req.user.id,
    action: "EMPLOYEE_CREATED",
    entityType: "Employee",
    entityId: id,
    newValue: data.employeeCode,
  });

  const { rows } = await query("SELECT * FROM employees WHERE id = ?", [id]);
  res.status(201).json(mapRow(rows[0]));
}

// HR only — e.g. toggling employment_status, per Section 4.1
export async function updateEmployeeStatus(req, res) {
  const statusSchema = z.object({ employmentStatus: z.enum(["ACTIVE", "INACTIVE"]) });
  const { employmentStatus } = statusSchema.parse(req.body);

  const { rows: before } = await query("SELECT employment_status FROM employees WHERE id = ?", [req.params.id]);
  if (!before[0]) throw new ApiError(404, "Employee not found");

  await query("UPDATE employees SET employment_status = ?, updated_at = NOW() WHERE id = ?", [employmentStatus, req.params.id]);

  await recordAudit(null, {
    actorUserId: req.user.id,
    action: "EMPLOYEE_STATUS_CHANGED",
    entityType: "Employee",
    entityId: req.params.id,
    oldValue: before[0].employment_status,
    newValue: employmentStatus,
  });

  const { rows } = await query("SELECT * FROM employees WHERE id = ?", [req.params.id]);
  res.json(mapRow(rows[0]));
}
