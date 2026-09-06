import { pool } from './src/config/db.js';

async function fixPasswords() {
  // Hash for 'password123'
  const validHash = '$2b$10$aQxBI9F2ER8RGfbMfBVdne6/d9cqWXT7UCteRJlPV2FNJ46gNdZoC';
  
  await pool.query('UPDATE users SET password_hash = ?', [validHash]);
  console.log('✔ All user password hashes successfully updated to password123');
  process.exit(0);
}

fixPasswords().catch((err) => {
  console.error(' Error updating database:', err);
  process.exit(1);
});