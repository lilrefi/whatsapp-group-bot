require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const file = process.argv[2];
if (!file) { console.error('Usage: node run-sql.js <file.sql>'); process.exit(1); }

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    const sql = fs.readFileSync(file, 'utf8');
    await pool.query(sql);
    console.log(`✅ ${file} executed successfully`);
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
})();
