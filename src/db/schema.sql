-- BPO RFID Attendance & Access Management System
-- Database schema — mirrors Section 11 (Data Architecture) of the master document.
-- Target: MySQL 8.0+
--
-- Note on IDs: MySQL has no built-in UUID-generating column default that returns
-- the value on INSERT the way Postgres does, so UUIDs are generated in application
-- code (crypto.randomUUID()) and passed in explicitly. This also means we never
-- need a RETURNING clause — the app already knows the ID it just inserted.

SET NAMES utf8mb4;

-- ────────────────────────────────────────────────────────────────
-- Organization: departments, shifts
-- ────────────────────────────────────────────────────────────────
CREATE TABLE departments (
  id            CHAR(36) PRIMARY KEY,
  name          VARCHAR(255) NOT NULL UNIQUE,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE shifts (
  id              CHAR(36) PRIMARY KEY,
  name            VARCHAR(255) NOT NULL,
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  grace_minutes   INT NOT NULL DEFAULT 10,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ────────────────────────────────────────────────────────────────
-- Human users of the portal (Section 5: Personas and Role Model)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id              CHAR(36) PRIMARY KEY,
  name            VARCHAR(255) NOT NULL,
  email           VARCHAR(255) NOT NULL UNIQUE,
  password_hash   VARCHAR(255) NOT NULL,
  role            ENUM('HR', 'MANAGER', 'CEO', 'EMPLOYEE') NOT NULL,
  employee_id     CHAR(36),
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ────────────────────────────────────────────────────────────────
-- Employees (Section 11.2)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE employees (
  id                  CHAR(36) PRIMARY KEY,
  employee_code       VARCHAR(50) NOT NULL UNIQUE,
  first_name          VARCHAR(100) NOT NULL,
  last_name           VARCHAR(100) NOT NULL,
  email               VARCHAR(255) NOT NULL UNIQUE,
  phone               VARCHAR(30),
  department_id       CHAR(36),
  designation         VARCHAR(100),
  shift_id            CHAR(36),
  employment_status   ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  manager_id          CHAR(36),
  joining_date        DATE NOT NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_employees_department FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_employees_shift FOREIGN KEY (shift_id) REFERENCES shifts(id),
  CONSTRAINT fk_employees_manager FOREIGN KEY (manager_id) REFERENCES employees(id)
);

ALTER TABLE users
  ADD CONSTRAINT fk_users_employee FOREIGN KEY (employee_id) REFERENCES employees(id);

-- ────────────────────────────────────────────────────────────────
-- RFID Cards (Section 11.3, Section 17 lifecycle)
-- ────────────────────────────────────────────────────────────────

-- CREATE TABLE rfid_cards (
--   id              CHAR(36) PRIMARY KEY,
--   card_uid        VARCHAR(100) NOT NULL UNIQUE,
--   employee_id     CHAR(36),
--   status          ENUM('UNASSIGNED', 'ACTIVE', 'BLOCKED', 'RETIRED') NOT NULL DEFAULT 'UNASSIGNED',
--   assigned_at     TIMESTAMP NULL,
--   activated_at    TIMESTAMP NULL,
--   blocked_at      TIMESTAMP NULL,
--   replaced_at     TIMESTAMP NULL,
--   created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
--   updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
--   CONSTRAINT fk_cards_employee FOREIGN KEY (employee_id) REFERENCES employees(id)
-- );

-- chenge the code 01/09/2026
CREATE TABLE rfid_devices (
  id              CHAR(36) PRIMARY KEY,
  device_code     VARCHAR(50) NOT NULL UNIQUE,
  device_name     VARCHAR(255) NOT NULL,
  location        VARCHAR(255),
  device_type     ENUM('ENTRY', 'EXIT') NOT NULL,

  api_key_hash    VARCHAR(255) NOT NULL UNIQUE,

  status          ENUM('ONLINE', 'OFFLINE', 'WARNING') NOT NULL DEFAULT 'ONLINE',
  last_seen_at    TIMESTAMP NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ────────────────────────────────────────────────────────────────
-- RFID Devices (Section 9.2, Section 11.4)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE rfid_devices (
  id              CHAR(36) PRIMARY KEY,
  device_code     VARCHAR(50) NOT NULL UNIQUE,
  device_name     VARCHAR(255) NOT NULL,
  location        VARCHAR(255),
  device_type     ENUM('ENTRY', 'EXIT') NOT NULL,
  status          ENUM('ONLINE', 'OFFLINE', 'WARNING') NOT NULL DEFAULT 'ONLINE',
  last_seen_at    TIMESTAMP NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ────────────────────────────────────────────────────────────────
-- Attendance Events (Section 8.1, 11.5) — the raw, immutable observation
-- ────────────────────────────────────────────────────────────────
CREATE TABLE attendance_events (
  id                  CHAR(36) PRIMARY KEY,
  event_uid           VARCHAR(100) UNIQUE,
  employee_id         CHAR(36),
  card_id             CHAR(36) NOT NULL,
  device_id           CHAR(36) NOT NULL,
  event_type          ENUM('PUNCH_IN', 'PUNCH_OUT') NOT NULL,
  event_timestamp     DATETIME NOT NULL,
  received_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source              VARCHAR(50) DEFAULT 'RFID',
  metadata            JSON,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_events_employee FOREIGN KEY (employee_id) REFERENCES employees(id),
  CONSTRAINT fk_events_card FOREIGN KEY (card_id) REFERENCES rfid_cards(id),
  CONSTRAINT fk_events_device FOREIGN KEY (device_id) REFERENCES rfid_devices(id)
);

-- ────────────────────────────────────────────────────────────────
-- Attendance Records (Section 8.2, 11.6)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE attendance_records (
  id                    CHAR(36) PRIMARY KEY,
  employee_id           CHAR(36) NOT NULL,
  attendance_date       DATE NOT NULL,
  punch_in              DATETIME NULL,
  punch_out             DATETIME NULL,
  working_minutes       INT NULL,
  late_minutes          INT NOT NULL DEFAULT 0,
  status                ENUM('PRESENT','LATE','ABSENT','MISSING_PUNCH','ON_LEAVE','HOLIDAY','WEEK_OFF','CORRECTED') NOT NULL,
  calculation_version   INT NOT NULL DEFAULT 1,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_records_employee FOREIGN KEY (employee_id) REFERENCES employees(id),
  UNIQUE KEY uq_employee_date (employee_id, attendance_date)
);

-- ────────────────────────────────────────────────────────────────
-- Corrections (Section 19)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE attendance_corrections (
  id                      CHAR(36) PRIMARY KEY,
  attendance_record_id    CHAR(36) NOT NULL,
  correction_type         ENUM('PUNCH_IN', 'PUNCH_OUT', 'STATUS') NOT NULL,
  old_value               VARCHAR(255),
  new_value               VARCHAR(255) NOT NULL,
  reason                  VARCHAR(1000) NOT NULL,
  requested_by            CHAR(36) NOT NULL,
  approved_by             CHAR(36) NULL,
  status                  ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at             TIMESTAMP NULL,
  CONSTRAINT fk_corr_record FOREIGN KEY (attendance_record_id) REFERENCES attendance_records(id),
  CONSTRAINT fk_corr_requested_by FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT fk_corr_approved_by FOREIGN KEY (approved_by) REFERENCES users(id)
);

-- ────────────────────────────────────────────────────────────────
-- Audit Logs (Section 34)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE audit_logs (
  id              CHAR(36) PRIMARY KEY,
  actor_user_id   CHAR(36),
  action          VARCHAR(100) NOT NULL,
  entity_type     VARCHAR(100) NOT NULL,
  entity_id       VARCHAR(100) NOT NULL,
  old_value       VARCHAR(255),
  new_value       VARCHAR(255),
  ip_address      VARCHAR(64),
  timestamp       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id)
);
-- 11. LEAVES TABLE
CREATE TABLE IF NOT EXISTS leaves (
  id VARCHAR(36) PRIMARY KEY,
  employee_id VARCHAR(36) NOT NULL,
  leave_type ENUM('CASUAL', 'SICK', 'EARNED', 'UNPAID') NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  status ENUM('PENDING', 'APPROVED', 'REJECTED') DEFAULT 'PENDING',
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  approved_by VARCHAR(36),
  approved_at TIMESTAMP NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

-- . BIOMETRIC DATA TABLE // 04/09/2026 
CREATE TABLE IF NOT EXISTS biometric_data (
  id VARCHAR(36) PRIMARY KEY,
  employee_id VARCHAR(36) NOT NULL,
  biometric_type ENUM('FINGERPRINT', 'FACE', 'IRIS') NOT NULL,
  reference_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);
-- ────────────────────────────────────────────────────────────────
-- Indexes
-- ────────────────────────────────────────────────────────────────
CREATE INDEX idx_employees_department ON employees(department_id);
CREATE INDEX idx_employees_manager ON employees(manager_id);
CREATE INDEX idx_cards_employee ON rfid_cards(employee_id);
CREATE INDEX idx_events_employee ON attendance_events(employee_id);
CREATE INDEX idx_events_device ON attendance_events(device_id);
CREATE INDEX idx_events_timestamp ON attendance_events(event_timestamp);
CREATE INDEX idx_records_employee_date ON attendance_records(employee_id, attendance_date);
CREATE INDEX idx_records_date ON attendance_records(attendance_date);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
