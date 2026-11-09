// Diwali sweet boxes: one box per adult in a registration. Each family gets a personal QR code
// (a link to sweets.html with a signed pass code); at the counter an admin scans it, sees how many
// boxes to give, and the pass is marked as used. Only an admin can mark it unused again.
const { sweetsPassCode, readSweetsPass, SWEETS_OPEN_AT, sweetsOpen } = require("./booking-link");

module.exports = function registerSweets(app, { pool, requireAdmin, wa }) {
  async function ensureSweetsTable() {
    await pool.query(`CREATE TABLE IF NOT EXISTS event_sweet_collections (
      registration_id INTEGER PRIMARY KEY REFERENCES event_registrations(id) ON DELETE CASCADE,
      boxes INTEGER NOT NULL,
      collected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      collected_by VARCHAR(100))`);
  }

  async function registrationWithCollection(id) {
    const q = await pool.query(`SELECT r.id, r.first_name, r.last_name, r.adults_count, r.payment_status, r.registration_status,
        GREATEST(r.total_amount - r.paid_amount, 0) AS amount_due,
        c.boxes AS collected_boxes, c.collected_at, c.collected_by
      FROM event_registrations r LEFT JOIN event_sweet_collections c ON c.registration_id = r.id WHERE r.id = $1`, [id]);
    return q.rows[0] || null;
  }

  function family(r) {
    return { id: r.id, name: `${r.first_name} ${r.last_name}`, boxes: Number(r.adults_count) || 0, paid: r.payment_status === "PAID", amountDue: Number(r.amount_due) || 0 };
  }

  // Public: the family's own pass page. Anyone with the link sees the name and the number of boxes.
  app.get("/event/sweets-pass/:code", async (req, res) => {
    try {
      const id = readSweetsPass(req.params.code);
      const r = id && await registrationWithCollection(id);
      if (!r) return res.status(404).json({ error: "This sweets QR code is not valid." });
      res.json({
        ...family(r),
        firstName: r.first_name,
        cancelled: r.registration_status === "CANCELLED",
        opensAt: SWEETS_OPEN_AT, open: sweetsOpen(),
        collected: r.collected_at ? { at: r.collected_at, boxes: r.collected_boxes } : null
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // The counter scanned a pass. Gives boxes (and marks the pass used) only once per registration.
  // Before the opening time, or for an unpaid registration, the details are shown first and the
  // pass is only marked when the admin confirms with force (to give a specific family early).
  app.post("/admin/sweets/scan", requireAdmin, async (req, res) => {
    try {
      const id = readSweetsPass(req.body?.code);
      const r = id && await registrationWithCollection(id);
      if (!r) return res.status(404).json({ result: "INVALID", error: "This is not a valid sweets QR code." });
      const who = family(r);
      if (r.registration_status === "CANCELLED") return res.json({ result: "CANCELLED", ...who });
      if (r.collected_at) return res.json({ result: "ALREADY_USED", ...who, collected: { at: r.collected_at, boxes: r.collected_boxes, by: r.collected_by } });
      if (!who.boxes) return res.json({ result: "NO_ADULTS", ...who });
      if (!sweetsOpen() && !req.body?.force) return res.json({ result: "NOT_OPEN", ...who, opensAt: SWEETS_OPEN_AT });
      if (!who.paid && !req.body?.force) return res.json({ result: "NOT_PAID", ...who });
      const saved = await pool.query(`INSERT INTO event_sweet_collections(registration_id, boxes, collected_by) VALUES($1,$2,$3)
        ON CONFLICT (registration_id) DO NOTHING RETURNING collected_at`, [r.id, who.boxes, String(req.user?.username || "admin").slice(0, 100)]);
      if (!saved.rows.length) {
        const now = await registrationWithCollection(r.id); // scanned twice at the same moment
        return res.json({ result: "ALREADY_USED", ...who, collected: { at: now.collected_at, boxes: now.collected_boxes, by: now.collected_by } });
      }
      res.json({ result: "GIVE", ...who, collected: { at: saved.rows[0].collected_at, boxes: who.boxes } });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Admin only: make a used pass usable again (for example after a scan by mistake).
  app.delete("/admin/sweets/:id", requireAdmin, async (req, res) => {
    try {
      const q = await pool.query("DELETE FROM event_sweet_collections WHERE registration_id = $1 RETURNING registration_id", [req.params.id]);
      if (!q.rows.length) return res.status(404).json({ error: "This pass is not marked as used." });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Totals for the scanner page.
  app.get("/admin/sweets/summary", requireAdmin, async (req, res) => {
    try {
      const q = await pool.query(`SELECT
          COUNT(*) FILTER (WHERE r.adults_count > 0)::int AS families,
          COALESCE(SUM(r.adults_count), 0)::int AS boxes,
          COUNT(c.registration_id)::int AS collected_families,
          COALESCE(SUM(c.boxes), 0)::int AS collected_boxes
        FROM event_registrations r LEFT JOIN event_sweet_collections c ON c.registration_id = r.id
        WHERE r.registration_status <> 'CANCELLED'`);
      res.json({ ...q.rows[0], opensAt: SWEETS_OPEN_AT, open: sweetsOpen() });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // The ready-written WhatsApp message with one family's QR link (Registrations page button).
  app.get("/admin/sweets/:id/whatsapp", requireAdmin, async (req, res) => {
    try {
      const q = await pool.query(`SELECT r.*, GREATEST(r.total_amount - r.paid_amount, 0) AS amount_due, a.swish_number
        FROM event_registrations r LEFT JOIN event_swish_accounts a ON a.id = r.swish_account_id WHERE r.id = $1`, [req.params.id]);
      if (!q.rows.length) return res.status(404).json({ error: "Registration not found" });
      const r = q.rows[0];
      res.json({ digits: wa.whatsappDigits(r.whatsapp), whatsapp: r.whatsapp, code: sweetsPassCode(r.id), text: wa.MESSAGES.SWEETS_PASS(r) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return ensureSweetsTable;
};
