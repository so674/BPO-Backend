import mysql from "mysql2/promise";
import "dotenv/config";
import dotenv from 'dotenv';

// Query helper — matches the shape controllers use: query(sql, params) -> rows
// mysql2 returns [rows, fields]; we only ever need rows, wrapped to look like { rows }
// so the rest of the app can stay in a familiar shape.
export async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return { rows };
}

// For operations that must run in a transaction (e.g. event ingestion + attendance
// update), per Section 12.1: "the application SHOULD use a transaction so that event
// persistence and the required attendance update cannot leave the database in a
// partial state." fn receives a client with the same query(sql, params) -> {rows} shape.
export async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const client = {
      query: async (sql, params = []) => {
        const [rows] = await conn.query(sql, params);
        return { rows };
      },
    };
    const result = await fn(client);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
dotenv.config();

// Update src/config/db.js to handle cloud SSL connections and limit connection exhaustion during serverless function bursts

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'bpo_attendance',
  waitForConnections: true,
  connectionLimit: 5, // Capped low specifically for Vercel serverless execution
  queueLimit: 0,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

export default pool;