// Guest feedback: a 1–5 star rating (and an optional comment) for the event itself and for each food stall.
// One rating per phone number per stall (sending again updates it). Vendors only see their own stall's
// ratings (first names only, no phone numbers); admins see everything.
module.exports = function registerFeedback(app, { pool, requireVendor, vendorScope, normalizePhone, customerPhones }) {
  const clean = (v, max) => { const s = String(v ?? "").trim().slice(0, max); return s || null; };
  const stars = v => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null; };

  async function ensureFeedbackTable() {
    await pool.query(`CREATE TABLE IF NOT EXISTS feedback (
      id SERIAL PRIMARY KEY,
      vendor_id INTEGER NULL REFERENCES vendors(id) ON DELETE CASCADE,
      rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment VARCHAR(1000) NULL,
      name VARCHAR(100) NULL,
      phone VARCHAR(30) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS feedback_vendor_idx ON feedback(vendor_id)`);
  }

  // Stalls to rate. With a phone number: which stalls they ordered from (listed first) and what they rated before.
  app.get("/feedback/stalls", async (req, res) => {
    try {
      const phones = req.query.phone ? customerPhones(req.query.phone) : [];
      const vendors = await pool.query(`SELECT v.id, v.name,
          EXISTS (SELECT 1 FROM orders o JOIN customers c ON c.id = o.customer_id
                  WHERE o.vendor_id = v.id AND o.payment_status = 'PAID' AND c.phone = ANY($1)) AS ordered
        FROM vendors v ORDER BY v.name`, [phones]);
      const mine = phones.length
        ? (await pool.query(`SELECT vendor_id, rating, comment, name FROM feedback WHERE phone = ANY($1)`, [phones])).rows
        : [];
      res.json({ stalls: vendors.rows.sort((a, b) => b.ordered - a.ordered), mine });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/feedback", async (req, res) => {
    const name = clean(req.body.name, 100);
    const phone = req.body.phone ? normalizePhone(req.body.phone) : null;
    if (req.body.phone && !phone) return res.status(400).json({ error: "Please check your phone number, e.g. +46 70 123 45 67, or leave it empty." });
    const entries = [];
    if (req.body.event && stars(req.body.event.rating)) entries.push({ vendorId: null, rating: stars(req.body.event.rating), comment: clean(req.body.event.comment, 1000) });
    for (const s of Array.isArray(req.body.stalls) ? req.body.stalls.slice(0, 50) : []) {
      const vendorId = Number(s.vendorId);
      if (Number.isInteger(vendorId) && stars(s.rating)) entries.push({ vendorId, rating: stars(s.rating), comment: clean(s.comment, 1000) });
    }
    if (!entries.length) return res.status(400).json({ error: "Please choose at least one star rating." });
    try {
      const known = new Set((await pool.query("SELECT id FROM vendors")).rows.map(r => r.id));
      let saved = 0;
      for (const e of entries) {
        if (e.vendorId !== null && !known.has(e.vendorId)) continue;
        if (phone) {
          const up = await pool.query(`UPDATE feedback SET rating = $1, comment = $2, name = COALESCE($3, name), updated_at = NOW()
            WHERE phone = ANY($4) AND vendor_id IS NOT DISTINCT FROM $5 RETURNING id`, [e.rating, e.comment, name, customerPhones(phone), e.vendorId]);
          if (up.rows.length) { saved++; continue; }
        }
        await pool.query("INSERT INTO feedback(vendor_id, rating, comment, name, phone) VALUES($1,$2,$3,$4,$5)", [e.vendorId, e.rating, e.comment, name, phone]);
        saved++;
      }
      res.json({ success: true, saved });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Vendors: their own stall. Admins (and Food staff): one stall with ?vendorId=, or everything (event + all stalls).
  app.get("/vendor/feedback", requireVendor, async (req, res) => {
    const isAdmin = req.user.role === "admin";
    const vendorId = isAdmin ? (req.query.vendorId ? Number(req.query.vendorId) : null) : vendorScope(req);
    if (!isAdmin && !vendorId) return res.status(403).json({ error: "No stall linked to this login." });
    try {
      const where = vendorId ? "WHERE f.vendor_id = $1" : "";
      const params = vendorId ? [vendorId] : [];
      const items = (await pool.query(`SELECT f.id, f.vendor_id, v.name AS vendor_name, f.rating, f.comment, f.name, f.phone, f.updated_at
        FROM feedback f LEFT JOIN vendors v ON v.id = f.vendor_id ${where} ORDER BY f.updated_at DESC`, params)).rows;
      const summary = (await pool.query(`SELECT f.vendor_id, v.name AS vendor_name, COUNT(*)::int AS count, ROUND(AVG(f.rating), 1)::float AS average,
          ${[1, 2, 3, 4, 5].map(n => `COUNT(*) FILTER (WHERE f.rating = ${n})::int AS s${n}`).join(", ")}
        FROM feedback f LEFT JOIN vendors v ON v.id = f.vendor_id ${where}
        GROUP BY f.vendor_id, v.name ORDER BY f.vendor_id NULLS FIRST`, params)).rows;
      // Vendors see first names only, never phone numbers.
      const list = isAdmin ? items : items.map(i => ({ ...i, phone: undefined, name: i.name ? i.name.split(/\s+/)[0] : null }));
      res.json({ admin: isAdmin, summary, items: list });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/admin/feedback/:id", requireVendor, async (req, res) => {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Admin access required" });
    try {
      await pool.query("DELETE FROM feedback WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return ensureFeedbackTable;
};
