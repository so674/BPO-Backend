import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import mysql from "mysql2/promise";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const sql = readFileSync(join(__dirname, "schema.sql"), "utf-8");

  // Connect without selecting a database first so the migration can create it
  // automatically on a fresh local MySQL installation.
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true,
  });

  const databaseName = process.env.DB_NAME || "bpo_attendance";
  console.log("Preparing database:", databaseName);
  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName.replaceAll("`", "``")}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.query(`USE \`${databaseName.replaceAll("`", "``")}\``);
    console.log("Applying schema.sql to database:", databaseName);
    await connection.query(sql);
    console.log("✔ Schema applied successfully.");
  } catch (err) {
    console.error("✘ Migration failed:", err.message);
    process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

migrate();
