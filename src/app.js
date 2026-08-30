import express from "express";
import "express-async-errors"; // lets async route handlers throw and hit errorHandler
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import "dotenv/config";

import authRoutes from "./routes/auth.js";
import employeeRoutes from "./routes/employees.js";
import departmentRoutes from "./routes/departments.js";
import shiftRoutes from "./routes/shifts.js";
import cardRoutes from "./routes/cards.js";
import deviceRoutes from "./routes/devices.js";
import attendanceEventRoutes from "./routes/attendanceEvents.js";
import attendanceRoutes from "./routes/attendance.js";
import correctionRoutes from "./routes/corrections.js";
import reportRoutes from "./routes/reports.js";
import auditLogRoutes from "./routes/auditLogs.js";
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:5173" }));
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

app.get("/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

// Resource groups, matching Section 22 of the master document
app.use("/auth", authRoutes);
app.use("/employees", employeeRoutes);
app.use("/departments", departmentRoutes);
app.use("/shifts", shiftRoutes);
app.use("/cards", cardRoutes);
app.use("/devices", deviceRoutes);
app.use("/attendance-events", attendanceEventRoutes);
app.use("/attendance", attendanceRoutes);
app.use("/corrections", correctionRoutes);
app.use("/reports", reportRoutes);
app.use("/audit-logs", auditLogRoutes);

app.use((req, res) => res.status(404).json({ error: "Not found" }));
app.use(errorHandler);

export default app;
