import "dotenv/config";
import app from "./app.js";
import pool from "./config/db.js";
// import leaveOvertimeRoutes from "./routes/leaveOvertimeRoutes.js";
// import reportRoutes from "./routes/reportRoutes.js";

const PORT = process.env.PORT || 4000;

async function checkDatabaseConnection() {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    console.log("Database connection: CONNECTED");
    return true;
  } catch (err) {
    console.error("Database connection: FAILED");
    console.error("Error details:", err.message);
    return false;
  }
}

// Mount API routes (MUST be above app.listen)
// app.use("/api", leaveOvertimeRoutes);
// app.use("/api", reportRoutes);

app.listen(PORT, async () => {
  console.log(`BPO Attendance API running on http://localhost:${PORT}`);
  await checkDatabaseConnection();
});