import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { pool } from "../config/db.js";

const DEMO_PASSWORD = "password123";

async function seed() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    console.log("Seeding departments...");
    const deptNames = ["Customer Experience", "Technical Support", "Finance Ops", "HR & Admin", "Quality & Training"];
    const deptIds = [];
    for (const name of deptNames) {
      const id = randomUUID();
      await conn.query(
        "INSERT INTO departments (id, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)",
        [id, name],
      );
      const [rows] = await conn.query("SELECT id FROM departments WHERE name = ?", [name]);
      deptIds.push(rows[0].id);
    }

    console.log("Seeding shifts...");
    const shiftDefs = [
      { name: "Day Shift", start: "09:00", end: "18:00", grace: 10 },
      { name: "Night Shift", start: "21:00", end: "06:00", grace: 15 },
      { name: "Early Shift", start: "06:00", end: "15:00", grace: 10 },
    ];
    const shiftIds = [];
    for (const s of shiftDefs) {
      const id = randomUUID();
      await conn.query(
        `INSERT INTO shifts (id, name, start_time, end_time, grace_minutes) VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE start_time = VALUES(start_time), end_time = VALUES(end_time), grace_minutes = VALUES(grace_minutes)`,
        [id, s.name, s.start, s.end, s.grace],
      );
      const [existingShift] = await conn.query("SELECT id FROM shifts WHERE name = ? ORDER BY created_at LIMIT 1", [s.name]);
      shiftIds.push(existingShift[0].id);
    }

    console.log("Seeding devices...");
    const devices = [
      { code: "ENTRY-01", name: "Main Entrance Reader", location: "Main Entrance", type: "ENTRY" },
      { code: "EXIT-01", name: "Main Exit Reader", location: "Main Entrance", type: "EXIT" },
      { code: "ENTRY-02", name: "West Wing Reader", location: "West Wing Lobby", type: "ENTRY" },
      { code: "EXIT-02", name: "West Wing Exit", location: "West Wing Lobby", type: "EXIT" },
    ];
    for (const d of devices) {
      await conn.query(
        `INSERT INTO rfid_devices (id, device_code, device_name, location, device_type, status, last_seen_at)
         VALUES (?,?,?,?,?,'ONLINE', NOW())
         ON DUPLICATE KEY UPDATE device_name = VALUES(device_name)`,
        [randomUUID(), d.code, d.name, d.location, d.type],
      );
    }

    console.log("Seeding employees + cards...");
    const firstNames = ["Ananya", "Rohit", "Priya", "Karan", "Meera", "Arjun", "Simran", "Vikram", "Neha", "Aditya"];
    const lastNames = ["Sharma", "Verma", "Iyer", "Khan", "Nair", "Gupta", "Reddy", "Das"];
    const employeeIds = [];

    for (let i = 0; i < 20; i++) {
      const first = firstNames[i % firstNames.length];
      const last = lastNames[i % lastNames.length];
      const code = `EMP${1000 + i}`;
      const email = `${first.toLowerCase()}.${last.toLowerCase()}${i}@bpocorp.com`;
      const dept = deptIds[i % deptIds.length];
      const shift = shiftIds[i % shiftIds.length];
      const empId = randomUUID();

      await conn.query(
        `INSERT INTO employees (id, employee_code, first_name, last_name, email, department_id, designation, shift_id, joining_date)
         VALUES (?,?,?,?,?,?,?,?, DATE_SUB(CURDATE(), INTERVAL 1 YEAR))
         ON DUPLICATE KEY UPDATE first_name = VALUES(first_name)`,
        [empId, code, first, last, email, dept, i % 5 === 0 ? "Team Lead" : "Associate", shift],
      );

      const [existing] = await conn.query("SELECT id FROM employees WHERE employee_code = ?", [code]);
      const resolvedEmpId = existing[0].id;
      employeeIds.push(resolvedEmpId);

      const [existingCard] = await conn.query("SELECT id FROM rfid_cards WHERE card_uid = ?", [`CARD-${45820 + i}`]);
      if (!existingCard[0]) {
        await conn.query(
          `INSERT INTO rfid_cards (id, card_uid, employee_id, status, assigned_at, activated_at)
           VALUES (?, ?, ?, 'ACTIVE', NOW(), NOW())`,
          [randomUUID(), `CARD-${45820 + i}`, resolvedEmpId],
        );
      }
    }

    console.log("Seeding portal login users...");
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const demoUsers = [
      { name: "Ananya Sharma", email: "hr@bpocorp.com", role: "HR", employeeId: employeeIds[0] },
      { name: "Rohit Verma", email: "manager@bpocorp.com", role: "MANAGER", employeeId: employeeIds[1] },
      { name: "Meera Nair", email: "ceo@bpocorp.com", role: "CEO", employeeId: employeeIds[2] },
      { name: "Karan Iyer", email: "employee@bpocorp.com", role: "EMPLOYEE", employeeId: employeeIds[3] },
    ];
    for (const u of demoUsers) {
      await conn.query(
        `INSERT INTO users (id, name, email, password_hash, role, employee_id)
         VALUES (?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
        [randomUUID(), u.name, u.email, passwordHash, u.role, u.employeeId],
      );
    }

    await conn.commit();
    console.log("\n✔ Seed complete.");
    console.log("  Demo login (all use password: " + DEMO_PASSWORD + ")");
    demoUsers.forEach((u) => console.log(`   ${u.role.padEnd(9)} ${u.email}`));
  } catch (err) {
    await conn.rollback();
    console.error("✘ Seed failed:", err);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

seed();
