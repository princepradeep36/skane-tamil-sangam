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

module.exports = { bookingUrl, validBookingKey };
