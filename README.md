# BPO RFID Attendance & Access Management — Backend

Node.js + Express + MySQL API implementing the architecture in the master document:
event ingestion, the attendance processing engine, RBAC, card/device lifecycle, corrections,
audit logging, and reports.

**This has been tested end-to-end on real MySQL 8** — migration, seed, login, event
ingestion, attendance processing, card blocking, corrections, reports, and audit trail
were all verified working with live `curl` requests before being handed to you.

## Prerequisites

- Node.js 18+
- MySQL 8.0+ installed and running locally
  - Windows: https://dev.mysql.com/downloads/installer/
  - Mac: `brew install mysql && brew services start mysql`
  - Linux: `sudo apt install mysql-server`

## 1. Install dependencies

```bash
cd bpo-backend
npm install
```

## 2. Create the database

Open a MySQL client (MySQL Workbench, or the `mysql` CLI) and run:

```sql
CREATE DATABASE bpo_attendance;
```

## 3. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and set `DB_USER` / `DB_PASSWORD` to match your local MySQL install
(commonly `root` and whatever password you set during MySQL installation).
Also change `JWT_SECRET` and `DEVICE_API_KEY` to your own random strings.

## 4. Apply the schema

```powershell
npm run db:migrate
```

This creates all 10 tables from `src/db/schema.sql`: departments, shifts, users, employees,
rfid_cards, rfid_devices, attendance_events, attendance_records, attendance_corrections,
audit_logs.

## 5. Seed demo data

```powershell
npm run db:seed
```

Creates 5 departments, 3 shifts, 4 devices, 20 employees with active RFID cards, and
4 login users — one per role, all sharing the password `password123`:

| Role     | Email                  |
|----------|-------------------------|
| HR       | hr@bpocorp.com          |
| Manager  | manager@bpocorp.com     |
| CEO      | ceo@bpocorp.com         |
| Employee | employee@bpocorp.com    |

## 6. Run the server

```powershell
npm run dev
```

API runs at `http://localhost:4000`. Confirm it's up:

```bash
curl http://localhost:4000/health
```

## API overview

Resource groups match Section 22 of the master document:

| Route                | Purpose                                              | Auth                     |
|-----------------------|-------------------------------------------------------|---------------------------|
| `POST /auth/login`    | Human login, returns JWT                              | —                          |
| `GET /employees`      | List employees (scoped by role)                       | HR, Manager, CEO           |
| `POST /employees`     | Create employee                                        | HR                          |
| `GET /cards`          | List RFID cards                                        | HR, Manager, CEO           |
| `POST /cards/:id/block` / `/assign` / `/replace` | Card lifecycle actions      | HR                          |
| `GET /devices`        | List readers + health                                  | HR, Manager, CEO           |
| `POST /attendance-events` | **Reader-facing.** Ingests a punch event            | Device API key (not JWT)   |
| `GET /attendance`     | Processed daily attendance records (scoped by role)     | Any logged-in role         |
| `GET /attendance/summary` | Daily present/late/absent counts                    | Any logged-in role         |
| `POST /corrections`   | Request an attendance correction                        | HR                          |
| `POST /corrections/:id/decision` | Approve/reject a correction                  | HR                          |
| `GET /audit-logs`     | Full audit trail                                        | HR                          |
| `GET /reports/monthly`, `/reports/departments` | Aggregated reports                | HR, Manager, CEO            |

### Simulating a card tap (no hardware needed)

This is exactly what a real RFID reader/adapter would send. Try it once the server is running:

```bash
curl -X POST http://localhost:4000/attendance-events \
  -H "Content-Type: application/json" \
  -H "X-Device-Api-Key: <your DEVICE_API_KEY from .env>" \
  -d '{
    "eventUid": "EVT-DEMO-001",
    "cardUid": "CARD-45820",
    "deviceCode": "ENTRY-01",
    "eventTimestamp": "2026-08-29T09:05:00Z"
  }'
```

This runs the full pipeline from Section 13: validates the device, validates the card,
resolves the employee, checks employment status, persists the event, and updates (or creates)
the day's attendance record — returning the resulting status (`PRESENT` / `LATE` / etc).

Submitting the same `eventUid` again is safely ignored (idempotency, Section 16.1) —
this is what protects against a reader retrying after a network blip.

## Project structure

```
src/
  app.js               # Express app assembly, all routes mounted
  server.js             # entry point
  config/db.js           # MySQL connection pool + transaction helper
  db/
    schema.sql            # full schema (Section 11 of the doc), MySQL 8 syntax
    migrate.js             # applies schema.sql
    seed.js                 # demo data
  middleware/
    auth.js                  # JWT verification + role guard (requireAuth, requireRole)
    deviceAuth.js              # separate device-credential check for readers (Section 22.2)
    errorHandler.js             # central error handling
  services/
    attendanceEngine.js          # the processing engine — Section 13, the business core
    auditService.js               # writes audit_logs rows
  controllers/            # one per resource — request handling + validation (zod)
  routes/                  # one per resource — wires routes to controllers + guards
```

### A note on IDs

MySQL has no built-in way to auto-generate a UUID and return it from an `INSERT` the way
Postgres's `RETURNING` does. So every ID is generated in application code with Node's
`crypto.randomUUID()` before the insert — the app already knows the ID it just created,
no `RETURNING` needed. You'll see this pattern (`const id = randomUUID()`) at the top of
every "create" controller function.

## Connecting the frontend

Update the frontend's data layer to call this API instead of `src/data/mock.ts`, using
the JWT returned from `POST /auth/login` as a Bearer token on every subsequent request.
The CORS origin is already configured to allow `http://localhost:5173` (Vite's default)
in `.env.example` — change `CORS_ORIGIN` if your frontend runs elsewhere.

## What's implemented vs. what's next

**Implemented and tested** (matches MVP scope, Section 31.1):
- Auth + RBAC (HR / Manager / CEO / Employee)
- Employee management, departments, shifts
- RFID card lifecycle (register, assign, block, replace)
- RFID device registry
- Event ingestion with idempotency + full validation sequence
- Attendance processing engine (punch-in/out, late detection, working hours)
- Correction request/approval workflow
- Audit logging
- Daily/monthly/department reports

**Not yet implemented** (Phase 2, Section 31.2, or out of scope for V1 per Section 4.2):
- Notifications (email/SMS)
- Rate limiting on the device endpoint
- Refresh tokens (current JWT is a single 8h token)
- Break-time deduction in working-hour calculation
- Advanced/overtime shift rules
- Payroll integration
