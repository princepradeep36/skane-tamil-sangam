// Events: every registration, food order and feedback answer belongs to one event (Diwali 2026,
// Pongal 2027, ...). Admins create and edit events on the Events page: name, date, venue, prices,
// page texts (rich text), banner and partner logo, and whether registration and food ordering are
// open. Exactly one event is the "current" one: the public registration page, Click2Eat, the QR
// scanner and the feedback form always use it. Admin pages can look at an earlier event by sending
// an X-Event-Id header (see frontend/food/auth.js).
//
// All events are kept in memory (there are only a handful) so email and WhatsApp templates can
// read them without a database call. Every change goes through this module, which reloads the cache.
const sanitizeHtml = require("sanitize-html");

const TEXT_FIELDS = {
  name: 150, short_name: 60, emoji: 20, time_text: 100, venue: 150, summary: 500,
  contacts_text: 1000, partner_name: 150
};
const HTML_FIELDS = ["intro_html", "consent_html", "thanks_html"];
const MENU_MODES = ["BOTH", "FOOD", "SNACKS"];
const BOOL_FIELDS = ["ask_volunteer", "ask_cultural", "registration_open", "food_open", "sweets_enabled"];
const IMAGE_KINDS = ["banner", "partner"];

// Rich text from the editor: only simple formatting, links and images survive.
function cleanHtml(value) {
  const html = sanitizeHtml(String(value || "").slice(0, 200000), {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "h2", "h3", "h4", "ul", "ol", "li", "a", "blockquote", "span", "img"],
    allowedAttributes: { a: ["href", "target", "rel"], img: ["src", "alt"], span: ["style"], p: ["class"], li: ["class"], h2: ["class"], h3: ["class"] },
    allowedClasses: { p: ["ql-align-center", "ql-align-right"], h2: ["ql-align-center"], h3: ["ql-align-center"], li: ["ql-indent-1", "ql-indent-2"] },
    allowedStyles: { span: { color: [/^#[0-9a-f]{3,6}$/i, /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/] } },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["https", "http"] },
    transformTags: { a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener" }) }
  }).trim();
  return html === "<p><br></p>" || html === "<p></p>" ? "" : html;
}

const DIWALI_CONSENT = `<p>I consent to Skåne Tamil Sangam photographing me and/or my children/family during this event and sharing these photos on Skåne Tamil Sangam’s social media channels and website.</p><p>Photos will first be uploaded to our shared drive. If I would like any specific photo of myself or my children/family to be removed, I can request its removal by sending a WhatsApp message to <strong>+46 73 057 91 31</strong>.</p>`;

function createEvents(pool) {
  let cache = new Map();
  let currentId = null;

  async function reload() {
    const q = await pool.query(`SELECT e.*, (SELECT json_object_agg(kind, extract(epoch FROM updated_at)::bigint) FROM event_images i WHERE i.event_id = e.id) AS images
      FROM events e ORDER BY e.event_date DESC NULLS LAST, e.id DESC`);
    cache = new Map(q.rows.map(r => [r.id, r]));
    currentId = (q.rows.find(r => r.is_current) || q.rows[0] || {}).id || null;
  }

  async function ensureTables() {
    await pool.query(`CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      short_name VARCHAR(60) NOT NULL,
      emoji VARCHAR(20) NOT NULL DEFAULT '🎉',
      event_date DATE NULL,
      time_text VARCHAR(100) NOT NULL DEFAULT '',
      venue VARCHAR(150) NOT NULL DEFAULT '',
      summary VARCHAR(500) NOT NULL DEFAULT '',
      adult_price INTEGER NOT NULL DEFAULT 0 CHECK (adult_price >= 0),
      child_price INTEGER NOT NULL DEFAULT 0 CHECK (child_price >= 0),
      intro_html TEXT NOT NULL DEFAULT '',
      consent_html TEXT NOT NULL DEFAULT '',
      thanks_html TEXT NOT NULL DEFAULT '',
      contacts_text TEXT NOT NULL DEFAULT '',
      partner_name VARCHAR(150) NOT NULL DEFAULT '',
      ask_volunteer BOOLEAN NOT NULL DEFAULT TRUE,
      ask_cultural BOOLEAN NOT NULL DEFAULT TRUE,
      registration_open BOOLEAN NOT NULL DEFAULT FALSE,
      food_open BOOLEAN NOT NULL DEFAULT FALSE,
      sweets_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      sweets_start_at TIMESTAMPTZ NULL,
      banner_fallback VARCHAR(200) NULL,
      partner_logo_fallback VARCHAR(200) NULL,
      is_current BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS events_one_current ON events ((TRUE)) WHERE is_current`);
    // What Click2Eat sells at this event: BOTH (food and snacks), FOOD only or SNACKS only.
    await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS menu_mode VARCHAR(10) NOT NULL DEFAULT 'BOTH'`);
    await pool.query(`CREATE TABLE IF NOT EXISTS event_images (
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      kind VARCHAR(20) NOT NULL,
      content_type VARCHAR(50) NOT NULL,
      image BYTEA NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (event_id, kind))`);

    // First start with events: everything so far was Diwali 2026, so it becomes that event.
    if (!(await pool.query("SELECT 1 FROM events LIMIT 1")).rows.length) {
      const s = await pool.query("SELECT key, value FROM site_settings").catch(() => ({ rows: [] }));
      const setting = (key, dflt) => { const r = s.rows.find(x => x.key === key); return r ? r.value : dflt; };
      await pool.query(`INSERT INTO events(name, short_name, emoji, event_date, time_text, venue, summary, adult_price, child_price,
          consent_html, contacts_text, partner_name, registration_open, food_open, sweets_enabled, sweets_start_at,
          banner_fallback, partner_logo_fallback, is_current)
        VALUES('Diwali Celebration 2026', 'Diwali 2026', '🪔', '2026-11-15', 'from 10:00 AM', 'Tryckeriet',
          'Join Skåne Tamil Sangam for our Festival of Lights celebration. Register your family, select adults and children, and complete the event payment through Swish.',
          100, 60, $1, 'Ajish: 0722199316\nPradeep: 0725283137', 'Prime Tone Productions', $2, $3, TRUE, $4,
          'diwali-2026-banner-1600.webp', 'prime-tone-logo.webp', TRUE)`,
        [DIWALI_CONSENT, setting("event_registration_enabled", true), setting("food_ordering_enabled", true),
         process.env.SWEETS_START_AT || "2026-11-15T16:00:00+01:00"]);
    }
    const first = (await pool.query("SELECT id FROM events ORDER BY is_current DESC, id LIMIT 1")).rows[0].id;

    // Tie the existing data to an event. Rows from before events existed belong to the first one (Diwali 2026).
    for (const table of ["event_registrations", "orders", "event_feedback"]) {
      await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS event_id INTEGER NULL REFERENCES events(id)`);
      await pool.query(`UPDATE ${table} SET event_id = $1 WHERE event_id IS NULL`, [first]);
      await pool.query(`CREATE INDEX IF NOT EXISTS ${table}_event_idx ON ${table}(event_id)`);
    }
    // One registration per phone number per event (it used to be one per phone number overall).
    const uniques = await pool.query(`SELECT conname FROM pg_constraint WHERE conrelid = 'event_registrations'::regclass AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (phone)'`);
    for (const { conname } of uniques.rows) await pool.query(`ALTER TABLE event_registrations DROP CONSTRAINT "${conname}"`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_event_phone ON event_registrations(event_id, phone)`);
    await reload();
  }

  const current = () => cache.get(currentId) || null;
  const get = id => cache.get(Number(id)) || null;
  const currentEventId = () => currentId;

  // Admin pages: the event chosen in the page's event picker, otherwise the current one.
  function adminEventId(req) {
    const id = Number(req.headers["x-event-id"] || req.query.event);
    return cache.has(id) ? id : currentId;
  }

  function dateText(ev, style = "long") {
    if (!ev || !ev.event_date) return "";
    const d = new Date(`${ev.event_date}T12:00:00Z`); // DATE columns are read as "YYYY-MM-DD" strings (db.js)
    const part = options => d.toLocaleDateString("en-GB", { timeZone: "UTC", ...options });
    return style === "long"
      ? `${part({ weekday: "long" })} ${part({ day: "numeric", month: "long", year: "numeric" })}`
      : `${part({ weekday: "short" })} ${part({ day: "numeric", month: "short" })}`;
  }
  // "Sunday 15 November 2026 at Tryckeriet, from 10:00 AM"
  function whenText(ev) {
    if (!ev) return "";
    return [dateText(ev), ev.venue && `at ${ev.venue}`].filter(Boolean).join(" ") + (ev.time_text ? `, ${ev.time_text}` : "");
  }
  // "Sun 15 Nov · 10:00 AM · Tryckeriet"
  function shortWhenText(ev) {
    if (!ev) return "";
    return [dateText(ev, "short"), String(ev.time_text || "").replace(/^from\s+/i, ""), ev.venue].filter(Boolean).join(" · ");
  }
  const isoDate = ev => (ev && ev.event_date) || null;

  // An event is over from the day after its date (Swedish time). Members and guests then no longer
  // see its bookings, QR codes or food orders; admin pages still show everything.
  function isOver(ev = current()) {
    let d = isoDate(ev);
    if (!d) return false;
    if (d instanceof Date) d = d.toISOString().slice(0, 10);
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
    return today > String(d).slice(0, 10);
  }

  function imageUrl(ev, kind) {
    const v = ev.images && ev.images[kind];
    if (v) return `/food-api/event/${ev.id}/image/${kind}?v=${v}`;
    const fallback = kind === "banner" ? ev.banner_fallback : ev.partner_logo_fallback;
    return fallback ? `/${fallback}` : null;
  }

  // What public pages need. No internal fields.
  function publicView(ev) {
    if (!ev) return null;
    return {
      id: ev.id, name: ev.name, shortName: ev.short_name, emoji: ev.emoji, date: isoDate(ev), timeText: ev.time_text, venue: ev.venue,
      whenText: whenText(ev), shortWhenText: shortWhenText(ev), summary: ev.summary,
      adultPrice: ev.adult_price, childPrice: ev.child_price,
      introHtml: ev.intro_html, consentHtml: ev.consent_html, thanksHtml: ev.thanks_html,
      partnerName: ev.partner_name, partnerLogoUrl: ev.partner_name ? imageUrl(ev, "partner") : null, bannerUrl: imageUrl(ev, "banner"),
      askVolunteer: ev.ask_volunteer, askCultural: ev.ask_cultural,
      isOver: isOver(ev),
      registrationOpen: ev.registration_open, foodOpen: ev.food_open, menuMode: ev.menu_mode || "BOTH",
      sweetsEnabled: ev.sweets_enabled, sweetsStartAt: ev.sweets_start_at
    };
  }
  function adminView(ev) {
    return { ...publicView(ev), partnerImageUrl: imageUrl(ev, "partner"), isCurrent: ev.is_current, contactsText: ev.contacts_text, hasBanner: !!(ev.images && ev.images.banner), hasPartnerLogo: !!(ev.images && ev.images.partner) };
  }

  // Reads the editor form. Returns { values } or { error }.
  function readForm(body) {
    const b = body || {};
    const v = {};
    const map = { name: "name", shortName: "short_name", emoji: "emoji", timeText: "time_text", venue: "venue", summary: "summary", contactsText: "contacts_text", partnerName: "partner_name" };
    for (const [from, to] of Object.entries(map)) v[to] = String(b[from] ?? "").trim().slice(0, TEXT_FIELDS[to]);
    if (!v.name) return { error: "Please give the event a name, e.g. Pongal Vizha 2027." };
    if (!v.short_name) v.short_name = v.name.slice(0, 60);
    if (!v.emoji) v.emoji = "🎉";
    if (b.date && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.date))) return { error: "Please choose the event date." };
    v.event_date = b.date || null;
    for (const [from, to] of [["adultPrice", "adult_price"], ["childPrice", "child_price"]]) {
      const n = Number(b[from] ?? 0);
      if (!Number.isInteger(n) || n < 0 || n > 100000) return { error: "Prices must be whole kronor (0 or more)." };
      v[to] = n;
    }
    v.intro_html = cleanHtml(b.introHtml);
    v.consent_html = cleanHtml(b.consentHtml);
    v.thanks_html = cleanHtml(b.thanksHtml);
    for (const [from, to] of [["askVolunteer", "ask_volunteer"], ["askCultural", "ask_cultural"], ["registrationOpen", "registration_open"], ["foodOpen", "food_open"], ["sweetsEnabled", "sweets_enabled"]]) v[to] = !!b[from];
    v.menu_mode = MENU_MODES.includes(b.menuMode) ? b.menuMode : "BOTH";
    if (b.sweetsStartAt) {
      const t = new Date(b.sweetsStartAt);
      if (isNaN(t)) return { error: "Please check the sweet box start time." };
      v.sweets_start_at = t.toISOString();
    } else v.sweets_start_at = null;
    return { values: v };
  }

  function register(app, { requirePerm, imageContentType, express }) {
    const requireEvents = requirePerm("settings");

    app.get("/event/current", (req, res) => {
      const ev = current();
      if (!ev) return res.status(404).json({ error: "No event yet." });
      res.set("Cache-Control", "no-store").json(publicView(ev));
    });

    // Admin "Preview page" link: the registration page shows any event's texts without taking bookings.
    app.get("/event/preview/:id", (req, res) => {
      const ev = get(req.params.id);
      if (!ev) return res.status(404).json({ error: "Event not found" });
      res.set("Cache-Control", "no-store").json(publicView(ev));
    });

    app.get("/event/:id/image/:kind", async (req, res) => {
      try {
        const q = await pool.query("SELECT content_type, image FROM event_images WHERE event_id = $1 AND kind = $2", [Number(req.params.id) || 0, req.params.kind]);
        if (!q.rows.length) return res.status(404).json({ error: "No image" });
        res.set("Content-Type", q.rows[0].content_type).set("Cache-Control", "public, max-age=604800").send(q.rows[0].image);
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // Every event with a few totals, newest first. Any staff member can read the list (the admin
    // pages' event picker uses it); only admins with Site controls can change events.
    app.get("/admin/events", requirePerm(...["registrations", "swish", "messages", "checkin", "sweets", "games", "food", "settings"]), async (req, res) => {
      try {
        const q = await pool.query(`SELECT e.id,
            (SELECT COUNT(*) FROM event_registrations r WHERE r.event_id = e.id AND r.registration_status <> 'CANCELLED')::int AS registrations,
            (SELECT COUNT(*) FROM orders o WHERE o.event_id = e.id)::int AS orders
          FROM events e`);
        const counts = new Map(q.rows.map(r => [r.id, r]));
        res.json([...cache.values()].map(ev => ({ ...adminView(ev), registrations: counts.get(ev.id)?.registrations || 0, orders: counts.get(ev.id)?.orders || 0 })));
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    const COLS = ["name", "short_name", "emoji", "event_date", "time_text", "venue", "summary", "adult_price", "child_price", "intro_html", "consent_html", "thanks_html",
      "contacts_text", "partner_name", "ask_volunteer", "ask_cultural", "registration_open", "food_open", "sweets_enabled", "sweets_start_at", "menu_mode"];

    app.post("/admin/events", requireEvents, async (req, res) => {
      const { values, error } = readForm(req.body);
      if (error) return res.status(400).json({ error });
      try {
        const q = await pool.query(`INSERT INTO events(${COLS.join(",")}) VALUES(${COLS.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`,
          COLS.map(c => values[c]));
        await reload();
        res.status(201).json(adminView(get(q.rows[0].id)));
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.put("/admin/events/:id", requireEvents, async (req, res) => {
      if (!get(req.params.id)) return res.status(404).json({ error: "Event not found" });
      const { values, error } = readForm(req.body);
      if (error) return res.status(400).json({ error });
      try {
        await pool.query(`UPDATE events SET ${COLS.map((c, i) => `${c} = $${i + 1}`).join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = $${COLS.length + 1}`,
          [...COLS.map(c => values[c]), Number(req.params.id)]);
        await reload();
        res.json(adminView(get(req.params.id)));
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // Makes this the event the public pages, Click2Eat and the scanner use.
    app.put("/admin/events/:id/current", requireEvents, async (req, res) => {
      if (!get(req.params.id)) return res.status(404).json({ error: "Event not found" });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("UPDATE events SET is_current = FALSE WHERE is_current");
        await client.query("UPDATE events SET is_current = TRUE WHERE id = $1", [Number(req.params.id)]);
        await client.query("COMMIT");
        await reload();
        res.json({ success: true });
      } catch (err) { await client.query("ROLLBACK"); res.status(500).json({ error: err.message }); }
      finally { client.release(); }
    });

    // Only an event nobody registered for or ordered at can be deleted (a draft made by mistake).
    app.delete("/admin/events/:id", requireEvents, async (req, res) => {
      const ev = get(req.params.id);
      if (!ev) return res.status(404).json({ error: "Event not found" });
      if (ev.is_current) return res.status(409).json({ error: "This is the current event. Make another event current first." });
      try {
        const used = await pool.query(`SELECT (SELECT COUNT(*) FROM event_registrations WHERE event_id = $1) + (SELECT COUNT(*) FROM orders WHERE event_id = $1)
          + (SELECT COUNT(*) FROM event_feedback WHERE event_id = $1) AS n`, [ev.id]);
        if (Number(used.rows[0].n) > 0) return res.status(409).json({ error: "This event has registrations, orders or feedback, so it is kept for the records." });
        await pool.query("DELETE FROM events WHERE id = $1", [ev.id]);
        await reload();
        res.json({ success: true });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.put("/admin/events/:id/image/:kind", requireEvents, express.raw({ type: "image/*", limit: "5mb" }), async (req, res) => {
      const ev = get(req.params.id);
      if (!ev || !IMAGE_KINDS.includes(req.params.kind)) return res.status(404).json({ error: "Event not found" });
      const image = Buffer.isBuffer(req.body) ? req.body : null;
      const contentType = image && imageContentType(image);
      if (!contentType) return res.status(400).json({ error: "Please choose a JPG, PNG or WebP image (up to 5 MB)." });
      try {
        await pool.query(`INSERT INTO event_images(event_id, kind, content_type, image) VALUES($1, $2, $3, $4)
          ON CONFLICT (event_id, kind) DO UPDATE SET content_type = EXCLUDED.content_type, image = EXCLUDED.image, updated_at = CURRENT_TIMESTAMP`,
          [ev.id, req.params.kind, contentType, image]);
        await reload();
        res.json(adminView(get(ev.id)));
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.delete("/admin/events/:id/image/:kind", requireEvents, async (req, res) => {
      const ev = get(req.params.id);
      if (!ev || !IMAGE_KINDS.includes(req.params.kind)) return res.status(404).json({ error: "Event not found" });
      try {
        await pool.query("DELETE FROM event_images WHERE event_id = $1 AND kind = $2", [ev.id, req.params.kind]);
        await pool.query(`UPDATE events SET ${req.params.kind === "banner" ? "banner_fallback" : "partner_logo_fallback"} = NULL WHERE id = $1`, [ev.id]);
        await reload();
        res.json(adminView(get(ev.id)));
      } catch (err) { res.status(500).json({ error: err.message }); }
    });
  }

  // Site Controls switches that belong to the current event.
  async function setCurrentSwitch(column, value) {
    if (!currentId || !["registration_open", "food_open"].includes(column)) return;
    await pool.query(`UPDATE events SET ${column} = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [!!value, currentId]);
    await reload();
  }

  // Menu categories guests can order at the current event.
  function menuCategories(ev = current()) {
    const mode = (ev && ev.menu_mode) || "BOTH";
    return mode === "BOTH" ? ["FOOD", "SNACKS"] : [mode];
  }
  const api = { isOver, menuCategories, ensureTables, reload, register, current, get, currentEventId, adminEventId, whenText, shortWhenText, publicView, setCurrentSwitch, cleanHtml };
  createEvents.instance = api;
  return api;
}

// The event a registration belongs to (email and WhatsApp templates use its name, date and venue).
createEvents.of = r => (createEvents.instance && (createEvents.instance.get(r && r.event_id) || createEvents.instance.current())) || {};
module.exports = createEvents;
