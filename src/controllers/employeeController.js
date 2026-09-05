import { z } from "zod";
import { query } from "../config/db.js";
import { ApiError } from "../middleware/errorHandler.js";

// Validation Schemas
const createEmployeeSchema = z.object({
  id: z.string().min(1, "Employee ID is required"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email(),
  employmentStatus: z.enum(["ACTIVE", "INACTIVE", "TERMINATED", "ON_LEAVE"]).default("ACTIVE"),
  role: z.enum(["HR", "EMPLOYEE", "MANAGER", "CEO"]).default("EMPLOYEE"),
  departmentId: z.string().optional().nullable(),
  shiftId: z.string().optional().nullable(),
});

const updateEmployeeSchema = createEmployeeSchema.partial().omit({ id: true });

const updateStatusSchema = z.object({
  employmentStatus: z.enum(["ACTIVE", "INACTIVE", "TERMINATED", "ON_LEAVE"]),
});

// 1. GET /api/employees - List all employees (supports search & filters)
export async function listEmployees(req, res) {
  const { search, status, role } = req.query;

  let sql = "SELECT * FROM employees WHERE 1=1";
  const params = [];

  if (search) {
    sql += " AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR id LIKE ?)";
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }

  if (status) {
    sql += " AND employment_status = ?";
    params.push(status);
  }

  if (role) {
    sql += " AND role = ?";
    params.push(role);
  }

  sql += " ORDER BY created_at DESC";

  const { rows } = await query(sql, params);
  res.json({ employees: rows });
}

// 2. GET /api/employees/:id - Get employee details by ID
export async function getEmployeeById(req, res) {
  const { id } = req.params;

  const { rows } = await query("SELECT * FROM employees WHERE id = ?", [id]);
  const employee = rows[0];

  if (!employee) {
    throw new ApiError(404, "Employee not found");
  }

  res.json({ employee });
}

// 3. POST /api/employees - Create a new employee record
export async function createEmployee(req, res) {
  const data = createEmployeeSchema.parse(req.body);

  const { rows: existing } = await query(
    "SELECT id, email FROM employees WHERE id = ? OR email = ?",
    [data.id, data.email]
  );

  if (existing.length > 0) {
    throw new ApiError(400, "Employee ID or email already exists");
  }

  await query(
    `INSERT INTO employees (id, first_name, last_name, email, employment_status, role, department_id, shift_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.id,
      data.firstName,
      data.lastName,
      data.email,
      data.employmentStatus,
      data.role,
      data.departmentId || null,
      data.shiftId || null,
    ]
  );

  const { rows } = await query("SELECT * FROM employees WHERE id = ?", [data.id]);
  res.status(201).json({ employee: rows[0] });
}

// 4. PUT /api/employees/:id - Update employee details
export async function updateEmployee(req, res) {
  const { id } = req.params;
  const data = updateEmployeeSchema.parse(req.body);

  const { rows: existing } = await query("SELECT * FROM employees WHERE id = ?", [id]);
  if (!existing[0]) throw new ApiError(404, "Employee not found");

  const updates = [];
  const params = [];

  if (data.firstName !== undefined) { updates.push("first_name = ?"); params.push(data.firstName); }
  if (data.lastName !== undefined) { updates.push("last_name = ?"); params.push(data.lastName); }
  if (data.email !== undefined) { updates.push("email = ?"); params.push(data.email); }
  if (data.role !== undefined) { updates.push("role = ?"); params.push(data.role); }
  if (data.departmentId !== undefined) { updates.push("department_id = ?"); params.push(data.departmentId); }
  if (data.shiftId !== undefined) { updates.push("shift_id = ?"); params.push(data.shiftId); }

  if (updates.length === 0) {
    return res.json({ employee: existing[0] });
  }

  params.push(id);
  await query(`UPDATE employees SET ${updates.join(", ")} WHERE id = ?`, params);

  const { rows } = await query("SELECT * FROM employees WHERE id = ?", [id]);
  res.json({ employee: rows[0] });
}

// 5. PATCH /api/employees/:id/status - Update employment status
export async function updateEmployeeStatus(req, res) {
  const { id } = req.params;
  const { employmentStatus } = updateStatusSchema.parse(req.body);

  const { rows: existing } = await query("SELECT * FROM employees WHERE id = ?", [id]);
  if (!existing[0]) throw new ApiError(404, "Employee not found");

  await query("UPDATE employees SET employment_status = ? WHERE id = ?", [employmentStatus, id]);

  const { rows } = await query("SELECT * FROM employees WHERE id = ?", [id]);
  res.json({ employee: rows[0] });
}

// 6. DELETE /api/employees/:id - Soft deactivate employee
export async function deleteEmployee(req, res) {
  const { id } = req.params;

  const { rows: existing } = await query("SELECT * FROM employees WHERE id = ?", [id]);
  if (!existing[0]) throw new ApiError(404, "Employee not found");

  await query("UPDATE employees SET employment_status = 'INACTIVE' WHERE id = ?", [id]);

  res.json({ message: `Employee ${id} set to INACTIVE successfully` });
}