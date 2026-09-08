import "dotenv/config";
import app from "./app.js";
import { connectDB } from "./config/db.js";

const PORT = process.env.PORT || 4000;

async function startServer() {
  try {
    // 1. Verify Database Connection
    await connectDB();

    // 2. Start Express Server (Single Listener)
    app.listen(PORT, () => {
      console.log(`BPO Attendance API running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err.message);
    process.exit(1);
  }
}

startServer();