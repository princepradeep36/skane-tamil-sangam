// Staff accounts with chosen access. Full admins (role "admin") can do everything; a "staff" account
// can only use the admin areas ticked for it. The ticks are read from the database on every request,
// so changing or removing an account takes effect straight away. Older "scanner" logins count as
// staff with only the QR scanner.

const PERMISSIONS = {
  registrations: "Event registrations & summary",
  swish: "Event Swish accounts",
  messages: "Event messages (email & WhatsApp)",
  scan: "QR scanner: entrance check-in & sweet boxes",
  scan_override: "QR scanner: “Give anyway” & undo",
  games: "Stage games (Connection & Clue)",
  food: "Food: orders, vendors, menus, live dashboard, sales",
  settings: "Site controls"
};

module.exports = function registerStaff({ app, pool, authenticateToken, requireAdmin, bcrypt }) {
  const clean = list => [...new Set((Array.isArray(list) ? list : []).filter(p => PERMISSIONS[p]))];

  // null means "everything" (full admin).
  async function permissionsOf(user) {
    if (user.role === "admin") return null;
    if (user.role === "scanner") return ["scan"];
    if (user.role !== "staff") return [];
    const q = await pool.query("SELECT permissions FROM users WHERE id = $1 AND role = 'staff'", [user.userId]);
    return q.rows.length ? String(q.rows[0].permissions || "").split(",").filter(Boolean) : [];
  }

  // Lets the request through for a full admin or a staff account with any of the given areas.
  function requirePerm(...areas) {
    return (req, res, next) => authenticateToken(req, res, async () => {
      try {
        req.perms = await permissionsOf(req.user);
        if (req.perms === null || areas.some(a => req.perms.includes(a))) return next();
        res.status(403).json({ error: "You don't have access to this." });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });
  }
  const hasPerm = (req, area) => req.perms === null || (req.perms || []).includes(area) || req.user?.role === "admin";

  async function ensureStaffColumns() {
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions TEXT");
    const checks = await pool.query(`SELECT conname FROM pg_constraint WHERE conrelid = 'users'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'`);
    for (const { conname } of checks.rows) await pool.query(`ALTER TABLE users DROP CONSTRAINT "${conname}"`);
    await pool.query("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'vendor', 'scanner', 'staff'))");
  }

  /* ---------- Managing staff accounts (full admins only) ---------- */

  app.get("/admin/staff", requireAdmin, async (req, res) => {
    try {
      const q = await pool.query("SELECT id, username, role, permissions FROM users WHERE role IN ('staff', 'scanner') ORDER BY username");
      res.json({
        permissions: PERMISSIONS,
        users: q.rows.map(u => ({ id: u.id, username: u.username, permissions: u.role === "scanner" ? ["scan"] : String(u.permissions || "").split(",").filter(Boolean) }))
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/admin/staff", requireAdmin, async (req, res) => {
    const username = String(req.body?.username || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const permissions = clean(req.body?.permissions);
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) return res.status(400).json({ error: "Username: 3 to 40 letters or numbers (no spaces)." });
    if (password.length < 8) return res.status(400).json({ error: "The password must be at least 8 characters." });
    if (!permissions.length) return res.status(400).json({ error: "Tick at least one area this account may use." });
    try {
      if ((await pool.query("SELECT 1 FROM users WHERE username = $1", [username])).rows.length) return res.status(409).json({ error: "That username is already taken." });
      await pool.query("INSERT INTO users(username, password, role, permissions) VALUES($1, $2, 'staff', $3)", [username, await bcrypt.hash(password, 12), permissions.join(",")]);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put("/admin/staff/:id/permissions", requireAdmin, async (req, res) => {
    const permissions = clean(req.body?.permissions);
    if (!permissions.length) return res.status(400).json({ error: "Tick at least one area, or remove the account." });
    try {
      // An older scanner login becomes a normal staff account when its access is changed.
      const q = await pool.query("UPDATE users SET role = 'staff', permissions = $1 WHERE id = $2 AND role IN ('staff', 'scanner') RETURNING id", [permissions.join(","), req.params.id]);
      if (!q.rows.length) return res.status(404).json({ error: "Staff account not found." });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put("/admin/staff/:id/password", requireAdmin, async (req, res) => {
    const password = String(req.body?.password || "");
    if (password.length < 8) return res.status(400).json({ error: "The password must be at least 8 characters." });
    try {
      const q = await pool.query("UPDATE users SET password = $1 WHERE id = $2 AND role IN ('staff', 'scanner') RETURNING id", [await bcrypt.hash(password, 12), req.params.id]);
      if (!q.rows.length) return res.status(404).json({ error: "Staff account not found." });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/admin/staff/:id", requireAdmin, async (req, res) => {
    try {
      const q = await pool.query("DELETE FROM users WHERE id = $1 AND role IN ('staff', 'scanner') RETURNING id", [req.params.id]);
      if (!q.rows.length) return res.status(404).json({ error: "Staff account not found." });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // The staff member's own access, so pages can show only what they may use.
  app.get("/staff/me", authenticateToken, async (req, res) => {
    try { res.json({ role: req.user.role, username: req.user.username, permissions: await permissionsOf(req.user) }); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  return { PERMISSIONS, requirePerm, hasPerm, permissionsOf, ensureStaffColumns };
};
