const { Pool, types } = require("pg");

// DATE columns (event dates) as plain "YYYY-MM-DD" strings, not Date objects shifted by the time zone.
types.setTypeParser(1082, value => value);

const isLocalDocker = process.env.DB_SSL === "false";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocalDocker ? false : { rejectUnauthorized: false },
  ...(process.env.DB_SCHEMA ? { options: `-c search_path=${process.env.DB_SCHEMA}` } : {})
});

module.exports = pool;
