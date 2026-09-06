import mysql from "mysql2/promise";
import "dotenv/config";

// Capped connection pool for cloud/local execution
export const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'bpo_attendance',
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

// Query helper — matches the shape controllers use: query(sql, params) -> rows
export async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return { rows };
}

// Transaction wrapper for atomic multi-query updates
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


export default pool;