import express from "express";
import "express-async-errors";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import "dotenv/config";

// Route Imports
import authRoutes from "./routes/auth.js";
import employeeRoutes from "./routes/employees.js";
import departmentRoutes from "./routes/departments.js";
import shiftRoutes from "./routes/shifts.js";
import cardRoutes from "./routes/cards.js";
import deviceRoutes from "./routes/devices.js";
import attendanceEventRoutes from "./routes/attendanceEvents.js";
import attendanceRoutes from "./routes/attendance.js";
import correctionRoutes from "./routes/corrections.js";
import auditLogRoutes from "./routes/auditLogs.js";
import leaveOvertimeRoutes from "./routes/leaveOvertimeRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import rfidRoutes from "./routes/rfid.js";
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();
app.disable("etag");

// Standard Middleware
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:5173" }));
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// Health & Test Endpoints
app.get("/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));
app.get("/test", (req, res) => res.send("Server is updating correctly!"));

// 1. PUBLIC AUTH ROUTES
app.use("/api/auth", authRoutes);

// 2. SPECIFIC API ENDPOINTS
app.use("/api/employees", employeeRoutes);
app.use("/api/departments", departmentRoutes);
app.use("/api/shifts", shiftRoutes);
app.use("/api/cards", cardRoutes);
app.use("/api/devices", deviceRoutes);
app.use("/api/attendance-events", attendanceEventRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/corrections", correctionRoutes);
app.use("/api/audit-logs", auditLogRoutes);
app.use("/api/rfid", rfidRoutes);
app.use("/api/reports", reportRoutes);

// 3. GENERIC API ROUTES
app.use("/api", leaveOvertimeRoutes);
app.use("/api", dashboardRoutes);

// Catch-All 404 Handler
app.use((req, res) => res.status(404).json({ error: "Not found" }));

// Global Error Handler
app.use(errorHandler);

// Default Export (Required for server.js)
export default app;