-- 1. Wipe any old structure and create a fresh database
DROP DATABASE IF EXISTS bpo_attendance;
CREATE DATABASE bpo_attendance;
USE bpo_attendance;

SET FOREIGN_KEY_CHECKS = 0;

-- 2. Departments & Shifts
CREATE TABLE IF NOT EXISTS departments (
  id            CHAR(36) PRIMARY KEY,
  name          VARCHAR(255) NOT NULL UNIQUE,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shifts (
  id            CHAR(36) PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  grace_minutes INT NOT NULL DEFAULT 10,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Employees Master
CREATE TABLE IF NOT EXISTS employees (
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
  CONSTRAINT fk_employees_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  CONSTRAINT fk_employees_shift FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL,
  CONSTRAINT fk_employees_manager FOREIGN KEY (manager_id) REFERENCES employees(id) ON DELETE SET NULL
);

-- 4. Portal Users
CREATE TABLE IF NOT EXISTS users (
  id              CHAR(36) PRIMARY KEY,
  name            VARCHAR(255) NOT NULL,
  email           VARCHAR(255) NOT NULL UNIQUE,
  password_hash   VARCHAR(255) NOT NULL,
  role            ENUM('HR', 'MANAGER', 'CEO', 'EMPLOYEE') NOT NULL,
  employee_id     CHAR(36),
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

-- 5. RFID Cards
CREATE TABLE IF NOT EXISTS rfid_cards (
  id              CHAR(36) PRIMARY KEY,
  card_uid        VARCHAR(100) NOT NULL UNIQUE,
  employee_id     CHAR(36),
  status          ENUM('UNASSIGNED', 'ACTIVE', 'BLOCKED', 'RETIRED') NOT NULL DEFAULT 'UNASSIGNED',
  assigned_at     TIMESTAMP NULL,
  activated_at    TIMESTAMP NULL,
  blocked_at      TIMESTAMP NULL,
  replaced_at     TIMESTAMP NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cards_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL
);

-- 6. RFID Devices
CREATE TABLE IF NOT EXISTS rfid_devices (
  id              CHAR(36) PRIMARY KEY,
  device_code     VARCHAR(50) NOT NULL UNIQUE,
  device_name     VARCHAR(100) NOT NULL,
  location        VARCHAR(100) DEFAULT 'Main Entrance',
  ip_address      VARCHAR(45),
  status          ENUM('ACTIVE', 'INACTIVE', 'MAINTENANCE') DEFAULT 'ACTIVE',
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 7. Raw Attendance Events
CREATE TABLE IF NOT EXISTS attendance_events (
  id              CHAR(36) PRIMARY KEY,
  event_uid       VARCHAR(100) UNIQUE,
  employee_id     CHAR(36),
  card_id         CHAR(36) NOT NULL,
  device_id       CHAR(36) NOT NULL,
  event_type      ENUM('PUNCH_IN', 'PUNCH_OUT') NOT NULL,
  event_timestamp DATETIME NOT NULL,
  received_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source          VARCHAR(50) DEFAULT 'RFID',
  metadata        JSON,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_events_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  CONSTRAINT fk_events_card FOREIGN KEY (card_id) REFERENCES rfid_cards(id) ON DELETE CASCADE,
  CONSTRAINT fk_events_device FOREIGN KEY (device_id) REFERENCES rfid_devices(id) ON DELETE CASCADE
);

-- 8. Daily Attendance Records
CREATE TABLE IF NOT EXISTS attendance_records (
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
  CONSTRAINT fk_records_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  UNIQUE KEY uq_employee_date (employee_id, attendance_date)
);

-- 9. Corrections
CREATE TABLE IF NOT EXISTS attendance_corrections (
  id                    CHAR(36) PRIMARY KEY,
  attendance_record_id  CHAR(36) NOT NULL,
  correction_type       ENUM('PUNCH_IN', 'PUNCH_OUT', 'STATUS') NOT NULL,
  old_value             VARCHAR(255),
  new_value             VARCHAR(255) NOT NULL,
  reason                VARCHAR(1000) NOT NULL,
  requested_by          CHAR(36) NOT NULL,
  approved_by           CHAR(36) NULL,
  status                ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at           TIMESTAMP NULL,
  CONSTRAINT fk_corr_record FOREIGN KEY (attendance_record_id) REFERENCES attendance_records(id) ON DELETE CASCADE,
  CONSTRAINT fk_corr_requested_by FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_corr_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

-- 10. Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id              CHAR(36) PRIMARY KEY,
  actor_user_id   CHAR(36),
  action          VARCHAR(100) NOT NULL,
  entity_type     VARCHAR(100) NOT NULL,
  entity_id       VARCHAR(100) NOT NULL,
  old_value       VARCHAR(255),
  new_value       VARCHAR(255),
  ip_address      VARCHAR(64),
  timestamp       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 11. Biometric Data Table
CREATE TABLE IF NOT EXISTS biometric_data (
  id              CHAR(36) PRIMARY KEY,
  employee_id     CHAR(36) NOT NULL,
  biometric_type  ENUM('FINGERPRINT', 'FACE', 'IRIS') NOT NULL,
  reference_id    VARCHAR(255) NOT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_bio_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

-- 12. Leave Requests
CREATE TABLE IF NOT EXISTS leave_requests (
  id              CHAR(36) PRIMARY KEY,
  employee_id     CHAR(36) NOT NULL,
  leave_type      ENUM('CASUAL', 'SICK', 'EARNED', 'UNPAID') NOT NULL,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  reason          TEXT,
  status          ENUM('PENDING', 'APPROVED', 'REJECTED') DEFAULT 'PENDING',
  approved_by     CHAR(36) NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  approved_at     TIMESTAMP NULL,
  CONSTRAINT fk_leaves_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  CONSTRAINT fk_leaves_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_req_emp (employee_id),
  INDEX idx_req_status (status)
);

-- 13. Leave Balances
CREATE TABLE IF NOT EXISTS leave_balances (
  id              CHAR(36) PRIMARY KEY,
  employee_id     CHAR(36) NOT NULL,
  leave_type      ENUM('CASUAL', 'SICK', 'EARNED', 'UNPAID') NOT NULL,
  year            INT NOT NULL,
  allocated_days  INT NOT NULL DEFAULT 0,
  used_days       INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_bal_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  UNIQUE KEY uq_emp_leave_year (employee_id, leave_type, year),
  INDEX idx_bal_emp (employee_id)
);

SET FOREIGN_KEY_CHECKS = 1;