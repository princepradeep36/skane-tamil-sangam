// One Diwali QR code per registration (a link to sweets.html with a signed pass code), used twice:
//  1. Check-in at the entrance: an admin scans it and sees the registered adults and kids; the
//     registration is marked as checked in.
//  2. Sweet boxes: one box per adult. The pass is marked as used once the boxes are given. Before
//     that, the family should have checked in (and paid, and the counter should be open); an admin
//     can still give the boxes after confirming. Only an admin can mark either step as not done again.
// Who may do what comes from staff accounts (staff.js): "scan" to scan, "scan_override" to give
// boxes anyway and to undo a scan; full admins can do everything.
const { sweetsPassCode, readSweetsPass, SWEETS_OPEN_AT, SWEETS_START_AT, sweetsOpen } = require("./booking-link");

module.exports = function registerSweets(app, { pool, requirePerm, hasPerm, wa }) {
  async function ensureSweetsTable() {
    await pool.query(`CREATE TABLE IF NOT EXISTS event_sweet_collections (
      registration_id INTEGER PRIMARY KEY REFERENCES event_registrations(id) ON DELETE CASCADE,
      boxes INTEGER NOT NULL,
      collected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      collected_by VARCHAR(100))`);
    await pool.query(`CREATE TABLE IF NOT EXISTS event_checkins (
      registration_id INTEGER PRIMARY KEY REFERENCES event_registrations(id) ON DELETE CASCADE,
      checked_in_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      checked_in_by VARCHAR(100))`);
  }

  async function registrationWithCollection(id) {
    const q = await pool.query(`SELECT r.id, r.first_name, r.last_name, r.adults_count, r.kids_6_12_count, r.kids_below_6_count,
        r.payment_status, r.registration_status, GREATEST(r.total_amount - r.paid_amount, 0) AS amount_due,
        c.boxes AS collected_boxes, c.collected_at, c.collected_by, k.checked_in_at, k.checked_in_by
      FROM event_registrations r
      LEFT JOIN event_sweet_collections c ON c.registration_id = r.id
      LEFT JOIN event_checkins k ON k.registration_id = r.id
      WHERE r.id = $1`, [id]);
    return q.rows[0] || null;
  }

  function family(r) {
    const adults = Number(r.adults_count) || 0, kids612 = Number(r.kids_6_12_count) || 0, kidsUnder6 = Number(r.kids_below_6_count) || 0;
    return {
      id: r.id, name: `${r.first_name} ${r.last_name}`,
      adults, kids612, kidsUnder6, people: adults + kids612 + kidsUnder6,
      boxes: adults, paid: r.payment_status === "PAID", amountDue: Number(r.amount_due) || 0,
      checkedIn: r.checked_in_at ? { at: r.checked_in_at, by: r.checked_in_by } : null,
      collected: r.collected_at ? { at: r.collected_at, boxes: r.collected_boxes, by: r.collected_by } : null
    };
  }
  const adminName = req => String(req.user?.username || "admin").slice(0, 100);

  // Public: the family's own QR page. Anyone with the link sees the name and the registered people.
  app.get("/event/sweets-pass/:code", async (req, res) => {
    try {
      const id = readSweetsPass(req.params.code);
      const r = id && await registrationWithCollection(id);
      if (!r) return res.status(404).json({ error: "This QR code is not valid." });
      const f = family(r);
      res.json({
        ...f,
        checkedIn: f.checkedIn ? { at: f.checkedIn.at } : null,
        collected: f.collected ? { at: f.collected.at, boxes: f.collected.boxes } : null,
        firstName: r.first_name,
        cancelled: r.registration_status === "CANCELLED",
        startsAt: SWEETS_START_AT, open: sweetsOpen()
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Entrance: shows who is registered and marks the registration as checked in (once).
  app.post("/admin/checkin/scan", requirePerm("scan"), async (req, res) => {
    try {
      const id = readSweetsPass(req.body?.code);
      const r = id && await registrationWithCollection(id);
      if (!r) return res.status(404).json({ result: "INVALID", error: "This is not a valid Diwali QR code." });
      if (r.registration_status === "CANCELLED") return res.json({ result: "CANCELLED", ...family(r) });
      if (r.checked_in_at) return res.json({ result: "ALREADY_CHECKED_IN", ...family(r) });
      const saved = await pool.query(`INSERT INTO event_checkins(registration_id, checked_in_by) VALUES($1,$2)
        ON CONFLICT (registration_id) DO NOTHING RETURNING registration_id`, [r.id, adminName(req)]);
      // No row back means another scanner checked them in at the same moment.
      res.json({ result: saved.rows.length ? "CHECKED_IN" : "ALREADY_CHECKED_IN", ...family(await registrationWithCollection(r.id)) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Admin only: undo a check-in (for example after scanning the wrong code).
  app.delete("/admin/checkin/:id", requirePerm("scan_override"), async (req, res) => {
    try {
      const q = await pool.query("DELETE FROM event_checkins WHERE registration_id = $1 RETURNING registration_id", [req.params.id]);
      if (!q.rows.length) return res.status(404).json({ error: "This registration is not checked in." });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Sweet boxes: gives boxes (and marks the pass used) only once per registration. If the counter is
  // not open yet, the family has not checked in, or the registration is unpaid, the details are shown
  // first and the pass is only marked when the admin confirms with force.
  app.post("/admin/sweets/scan", requirePerm("scan"), async (req, res) => {
    try {
      const force = !!req.body?.force && hasPerm(req, "scan_override"); // "Give anyway" needs that access
      const id = readSweetsPass(req.body?.code);
      const r = id && await registrationWithCollection(id);
      if (!r) return res.status(404).json({ result: "INVALID", error: "This is not a valid Diwali QR code." });
      const who = family(r);
      if (r.registration_status === "CANCELLED") return res.json({ result: "CANCELLED", ...who });
      if (r.collected_at) return res.json({ result: "ALREADY_USED", ...who });
      if (!who.boxes) return res.json({ result: "NO_ADULTS", ...who });
      const warnings = [];
      if (!sweetsOpen()) warnings.push("NOT_OPEN");
      if (!who.checkedIn) warnings.push("NOT_CHECKED_IN");
      if (!who.paid) warnings.push("NOT_PAID");
      if (warnings.length && !force) return res.json({ result: warnings[0], warnings, ...who, opensAt: SWEETS_OPEN_AT });
      const saved = await pool.query(`INSERT INTO event_sweet_collections(registration_id, boxes, collected_by) VALUES($1,$2,$3)
        ON CONFLICT (registration_id) DO NOTHING RETURNING collected_at`, [r.id, who.boxes, adminName(req)]);
      const now = family(await registrationWithCollection(r.id));
      if (!saved.rows.length) return res.json({ result: "ALREADY_USED", ...now }); // scanned twice at the same moment
      res.json({ result: "GIVE", ...now });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Admin only: make a used pass usable again (for example after a scan by mistake).
  app.delete("/admin/sweets/:id", requirePerm("scan_override"), async (req, res) => {
    try {
      const q = await pool.query("DELETE FROM event_sweet_collections WHERE registration_id = $1 RETURNING registration_id", [req.params.id]);
      if (!q.rows.length) return res.status(404).json({ error: "This pass is not marked as used." });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Totals for the scanner page.
  app.get("/admin/sweets/summary", requirePerm("scan"), async (req, res) => {
    try {
      const q = await pool.query(`SELECT
          COUNT(*)::int AS registrations,
          COALESCE(SUM(r.adults_count + r.kids_6_12_count + r.kids_below_6_count), 0)::int AS people,
          COUNT(k.registration_id)::int AS checked_in_families,
          COALESCE(SUM(r.adults_count + r.kids_6_12_count + r.kids_below_6_count) FILTER (WHERE k.registration_id IS NOT NULL), 0)::int AS checked_in_people,
          COUNT(*) FILTER (WHERE r.adults_count > 0)::int AS families,
          COALESCE(SUM(r.adults_count), 0)::int AS boxes,
          COUNT(c.registration_id)::int AS collected_families,
          COALESCE(SUM(c.boxes), 0)::int AS collected_boxes
        FROM event_registrations r
        LEFT JOIN event_sweet_collections c ON c.registration_id = r.id
        LEFT JOIN event_checkins k ON k.registration_id = r.id
        WHERE r.registration_status <> 'CANCELLED'`);
      res.json({ ...q.rows[0], opensAt: SWEETS_OPEN_AT, open: sweetsOpen() });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // The ready-written WhatsApp message with one family's QR link (Registrations page button).
  app.get("/admin/sweets/:id/whatsapp", requirePerm("registrations", "messages"), async (req, res) => {
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
