// Personal links in emails and WhatsApp messages: the registration page opens that family's booking
// straight away. The key is an HMAC of the registration id, so links cannot be guessed and contain no
// phone number. Changing JWT_SECRET makes old links stop working (the page then asks for the phone number).
const crypto = require("crypto");

const SITE_URL = (process.env.SITE_URL || "https://skanetamilsangam.duckdns.org").replace(/\/$/, "");

function bookingKey(id) {
  return crypto.createHmac("sha256", process.env.JWT_SECRET || "").update(`booking:${id}`).digest("base64url").slice(0, 22);
}

function bookingUrl(r) {
  return `${SITE_URL}/event-registration.html?booking=${encodeURIComponent(r.id)}&key=${bookingKey(r.id)}`;
}

function validBookingKey(id, key) {
  const expected = bookingKey(id);
  return typeof key === "string" && key.length === expected.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(expected));
}

// Sweet boxes start at the event's "sweet boxes from" time (Events page). The counter opens 15 minutes
// earlier as a buffer; before that it needs an admin override. No time set means the counter is open.
const SWEETS_EARLY_MS = 15 * 60 * 1000;
const sweetsStartAt = ev => (ev && ev.sweets_start_at ? new Date(ev.sweets_start_at) : null);
const sweetsOpenAt = ev => { const t = sweetsStartAt(ev); return t ? new Date(t.getTime() - SWEETS_EARLY_MS) : null; };
const sweetsOpen = ev => { const t = sweetsOpenAt(ev); return !t || Date.now() >= t.getTime(); };
function sweetsStartText(ev) {
  const t = sweetsStartAt(ev);
  if (!t) return null;
  const part = options => t.toLocaleString("en-GB", { timeZone: "Europe/Stockholm", ...options });
  return { day: part({ weekday: "long", day: "numeric", month: "short" }), time: part({ hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase() };
}

// Event QR pass (entrance check-in and sweet boxes): "<id>-<signature>", shown as a QR code on sweets.html.
function sweetsPassCode(id) {
  const sig = crypto.createHmac("sha256", process.env.JWT_SECRET || "").update(`sweets:${id}`).digest("base64url").slice(0, 12);
  return `${id}-${sig}`;
}

function sweetsPassUrl(r) {
  return `${SITE_URL}/sweets.html?pass=${encodeURIComponent(sweetsPassCode(r.id))}`;
}

// Accepts the code itself or the whole link (what a scanner reads); returns the registration id or null.
function readSweetsPass(value) {
  let code = String(value || "").trim();
  const fromLink = code.match(/[?&]pass=([^&#\s]+)/);
  if (fromLink) code = decodeURIComponent(fromLink[1]);
  const m = code.match(/^(\d{1,9})-([A-Za-z0-9_-]{12})$/);
  if (!m) return null;
  const expected = sweetsPassCode(m[1]);
  return code.length === expected.length && crypto.timingSafeEqual(Buffer.from(code), Buffer.from(expected)) ? Number(m[1]) : null;
}

module.exports = { bookingUrl, validBookingKey, sweetsPassCode, sweetsPassUrl, readSweetsPass, sweetsStartAt, sweetsOpenAt, sweetsOpen, sweetsStartText };
