import express from "express";
import "express-async-errors"; // lets async route handlers throw and hit errorHandler
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
import dashboardRoutes from "./routes/dashboardRoutes.js"; // Added Dashboard route import
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();

// Standard Middleware
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:5173" }));
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// Health & Test Endpoints
app.get("/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));
app.get("/test", (req, res) => res.send("Server is updating correctly!"));

// Master API Route Mounts (Standardized with /api prefix)
app.use("/api", leaveOvertimeRoutes);
app.use("/api", reportRoutes);
app.use("/api", dashboardRoutes); // Mounted /api/dashboard/hr and /api/dashboard/employee

app.use("/api/auth", authRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/departments", departmentRoutes);
app.use("/api/shifts", shiftRoutes);
app.use("/api/cards", cardRoutes);
app.use("/api/devices", deviceRoutes);
app.use("/api/attendance-events", attendanceEventRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/corrections", correctionRoutes);
app.use("/api/audit-logs", auditLogRoutes);

// Catch-All 404 Handler (MUST stay at the bottom)
app.use((req, res) => res.status(404).json({ error: "Not found" }));

// Global Error Handler (MUST be the absolute last middleware)
app.use(errorHandler);

export default app;