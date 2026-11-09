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

// Diwali sweet-box pass: "<id>-<signature>", shown as a QR code on sweets.html.
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

module.exports = { bookingUrl, validBookingKey, sweetsPassCode, sweetsPassUrl, readSweetsPass };
