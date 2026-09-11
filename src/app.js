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

// 1. Helmet Security Headers with HSTS (Resolves Cleartext Transmission Findings)
app.use(
  helmet({
    contentSecurityPolicy: process.env.NODE_ENV === "production",
    crossOriginEmbedderPolicy: process.env.NODE_ENV === "production",
    hsts: {
      maxAge: 31536000, // 1 year in seconds
      includeSubDomains: true,
      preload: true,
    },
  })
);

// 2. HTTPS Enforcement Middleware in Production
if (process.env.NODE_ENV === "production") {
  app.use((req, res, next) => {
    if (req.headers["x-forwarded-proto"] !== "https" && !req.secure) {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// 3. Hardened CORS Configuration
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",")
  : ["http://localhost:5173", "http://localhost:3000"];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("CORS policy violation: Access denied"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

// 4. Safe Body Parsing (Prevents Large Payload DoS Attacks)
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));

// 5. Morgan Logging
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