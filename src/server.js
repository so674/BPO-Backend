import "dotenv/config";
import app from "./app.js";
import { pool } from "./config/db.js";

const PORT = process.env.PORT || 4000;
// 01-09-1016 (Saurav)
// Check database connection status
async function checkDatabaseConnection() {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    console.log(" Database connection: CONNECTED");
    return true;
  } catch (err) {
    console.error(" Database connection: FAILED");
    console.error("Error details:", err.message);
    return false;
  }
}

app.listen(PORT, async () => {
  console.log(`BPO Attendance API running on http://localhost:${PORT}`);

  // Check database connection on startup
  await checkDatabaseConnection();
});
