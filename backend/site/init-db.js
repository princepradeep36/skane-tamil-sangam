const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function initializeDatabase() {
  const schema = process.env.DB_SCHEMA;
  if (!schema) return; // Local Docker keeps using its existing init scripts/databases.
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('Invalid DB_SCHEMA');
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  const exists = await pool.query("SELECT to_regclass($1) AS table_name", [`${schema}.members`]);
  if (!exists.rows[0].table_name) {
    const sql = fs.readFileSync(path.join(__dirname, 'render-schema.sql'), 'utf8');
    await pool.query(sql);
    console.log(`Initialized Render database schema: ${schema}`);
  }
}
module.exports = initializeDatabase;
