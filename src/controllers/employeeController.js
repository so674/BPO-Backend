import { randomUUID } from "node:crypto";
import { query } from "../config/db.js";

// Helper to extract rows safely from db query result wrapper
const getRows = (result) => {
  if (!result) return [];
  if (result.rows) {
    return Array.isArray(result.rows) ? result.rows : [result.rows];
  }
  if (Array.isArray(result)) {
    return Array.isArray(result[0]) ? result[0] : result;
  }
  return [];
};

// Standardizes DB records into camelCase & snake_case properties for frontend compatibility
const formatEmployee = (r) => {
  if (!r) return null;

  const firstName = r.first_name || r.firstName || "";
  const lastName = r.last_name || r.lastName || "";
  const fullName = `${firstName} ${lastName}`.trim() || r.name || r.employee_name || "Unnamed";

  return {
    id: r.id,
    employeeCode: r.employee_code || r.employeeCode || "—",
    employee_code: r.employee_code || r.employeeCode || "—",

    firstName: firstName,
    first_name: firstName,
    lastName: lastName,
    last_name: lastName,
    name: fullName,
    fullName: fullName,
    employeeName: fullName,

    email: r.email || "",
    phone: r.phone || r.phone_number || "—",

    departmentId: r.department_id || r.departmentId || null,
    departmentName: r.department_name || r.departmentName || "Unassigned",

    shiftId: r.shift_id || r.shiftId || null,
    shiftName: r.shift_name || r.shiftName || "Unassigned",

    designation: r.designation || "—",
    status: (r.employment_status || r.status || "INACTIVE").toUpperCase(),
    employmentStatus: (r.employment_status || r.status || "INACTIVE").toUpperCase(),
    joiningDate: r.joining_date || r.joiningDate || r.hire_date || null,
    managerId: r.manager_id || r.managerId || null,
  };
};

// 1. GET /api/employees - Fetch all employees
export async function listEmployees(req, res) {
  try {
    const { search, status } = req.query;

    let sql = `
      SELECT 
        e.*, 
        d.name AS department_name, 
        s.name AS shift_name
      FROM employees e
      LEFT JOIN departments d ON e.department_id = d.id
      LEFT JOIN shifts s ON e.shift_id = s.id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      sql += " AND (e.first_name LIKE ? OR e.last_name LIKE ? OR e.email LIKE ? OR e.employee_code LIKE ?)";
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }

    if (status) {
      sql += " AND (e.employment_status = ? OR e.status = ?)";
      params.push(status, status);
    }

    sql += " ORDER BY e.id DESC";

    const dbResult = await query(sql, params);
    const rows = getRows(dbResult);

    res.json(rows.map(formatEmployee));
  } catch (err) {
    console.error("List Employees Error:", err);
    res.status(500).json({ error: err.message || "Failed to fetch employees" });
  }
}

// 2. GET /api/employees/:id - Fetch single employee by ID
export async function getEmployeeById(req, res) {
  try {
    const { id } = req.params;
    const dbResult = await query(
      `SELECT e.*, d.name AS department_name, s.name AS shift_name 
       FROM employees e 
       LEFT JOIN departments d ON e.department_id = d.id 
       LEFT JOIN shifts s ON e.shift_id = s.id 
       WHERE e.id = ?`,
      [id]
    );

    const rows = getRows(dbResult);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Employee not found" });
    }

    res.json(formatEmployee(rows[0]));
  } catch (err) {
    console.error("Get Employee By ID Error:", err);
    res.status(500).json({ error: err.message || "Failed to fetch employee details" });
  }
}

// 3. POST /api/employees - Create new employee with auto-generated UUID/String ID
export async function createEmployee(req, res) {
  try {
    const body = req.body || {};

    // Generate explicit string ID if table doesn't use AUTO_INCREMENT
    const newId = body.id || `emp-${randomUUID().slice(0, 8)}`;
    const employeeCode = String(body.employeeCode || body.employee_code || `EMP${Date.now().toString().slice(-4)}`).trim();
    const firstName = String(body.firstName || body.first_name || "").trim();
    const lastName = String(body.lastName || body.last_name || "").trim();
    const email = String(body.email || "").trim() || null;
    const phone = String(body.phone || body.phone_number || "").trim() || null;
    const joiningDate = body.joiningDate || body.joining_date || new Date().toISOString().split("T")[0];

    const departmentId = body.departmentId || body.department_id || body.department || null;
    const shiftId = body.shiftId || body.shift_id || body.shift || null;
    const managerId = body.managerId || body.manager_id || body.reportingManager || null;
    const designation = body.designation || null;
    const status = String(body.status || body.employmentStatus || "ACTIVE").toUpperCase();

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Try full insert including id and joining_date
    try {
      const sqlFull = `
        INSERT INTO employees 
          (id, employee_code, first_name, last_name, email, phone, joining_date, department_id, shift_id, designation, manager_id, employment_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const paramsFull = [
        newId, employeeCode, firstName, lastName, email, phone, joiningDate,
        departmentId, shiftId, designation, managerId, status
      ];

      await query(sqlFull, paramsFull);
    } catch (colErr) {
      // Fallback if joining_date column is absent
      const sqlFallback = `
        INSERT INTO employees 
          (id, employee_code, first_name, last_name, email, phone, department_id, shift_id, designation, manager_id, employment_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const paramsFallback = [
        newId, employeeCode, firstName, lastName, email, phone,
        departmentId, shiftId, designation, managerId, status
      ];

      await query(sqlFallback, paramsFallback);
    }

    // Fetch created employee record
    const createdResult = await query(
      `SELECT e.*, d.name AS department_name, s.name AS shift_name 
       FROM employees e 
       LEFT JOIN departments d ON e.department_id = d.id 
       LEFT JOIN shifts s ON e.shift_id = s.id 
       WHERE e.id = ? OR e.employee_code = ?`,
      [newId, employeeCode]
    );

    const createdRows = getRows(createdResult);
    const newEmployee = createdRows.length > 0 
      ? formatEmployee(createdRows[0]) 
      : formatEmployee({
          id: newId,
          employee_code: employeeCode,
          first_name: firstName,
          last_name: lastName,
          email,
          phone,
          department_id: departmentId,
          shift_id: shiftId,
          designation,
          employment_status: status,
        });

    res.status(201).json(newEmployee);
  } catch (err) {
    console.error("Create Employee Error:", err);
    res.status(500).json({ error: err.message || "Failed to create employee" });
  }
}

// 4. PUT /api/employees/:id - Update existing employee
export async function updateEmployee(req, res) {
  try {
    const { id } = req.params;
    const body = req.body || {};

    const firstName = body.firstName || body.first_name;
    const lastName = body.lastName || body.last_name;
    const email = body.email;
    const phone = body.phone || body.phone_number;
    const departmentId = body.departmentId || body.department_id;
    const shiftId = body.shiftId || body.shift_id;
    const designation = body.designation;
    const status = body.status || body.employmentStatus;

    const sql = `
      UPDATE employees 
      SET 
        first_name = COALESCE(?, first_name),
        last_name = COALESCE(?, last_name),
        email = COALESCE(?, email),
        phone = COALESCE(?, phone),
        department_id = COALESCE(?, department_id),
        shift_id = COALESCE(?, shift_id),
        designation = COALESCE(?, designation),
        employment_status = COALESCE(?, employment_status)
      WHERE id = ?
    `;

    const params = [
      firstName || null,
      lastName || null,
      email || null,
      phone || null,
      departmentId || null,
      shiftId || null,
      designation || null,
      status ? String(status).toUpperCase() : null,
      id,
    ];

    await query(sql, params);

    const updatedResult = await query(
      `SELECT e.*, d.name AS department_name, s.name AS shift_name 
       FROM employees e 
       LEFT JOIN departments d ON e.department_id = d.id 
       LEFT JOIN shifts s ON e.shift_id = s.id 
       WHERE e.id = ?`,
      [id]
    );

    const rows = getRows(updatedResult);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Employee not found" });
    }

    res.json(formatEmployee(rows[0]));
  } catch (err) {
    console.error("Update Employee Error:", err);
    res.status(500).json({ error: err.message || "Failed to update employee" });
  }
}

// 5. PATCH /api/employees/:id/status - Update employee status
export async function updateEmployeeStatus(req, res) {
  try {
    const { id } = req.params;
    const { status, employmentStatus } = req.body;
    const newStatus = (status || employmentStatus || "ACTIVE").toUpperCase();

    await query("UPDATE employees SET employment_status = ? WHERE id = ?", [newStatus, id]);

    res.json({ message: "Employee status updated successfully", id, status: newStatus });
  } catch (err) {
    console.error("Update Status Error:", err);
    res.status(500).json({ error: err.message || "Failed to update employee status" });
  }
}

// 6. DELETE /api/employees/:id - Delete employee
export async function deleteEmployee(req, res) {
  try {
    const { id } = req.params;
    await query("DELETE FROM employees WHERE id = ?", [id]);
    res.json({ message: "Employee deleted successfully", id });
  } catch (err) {
    console.error("Delete Employee Error:", err);
    res.status(500).json({ error: err.message || "Failed to delete employee" });
  }
}