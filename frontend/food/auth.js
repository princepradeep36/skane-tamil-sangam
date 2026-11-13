/** JWT authentication helper for staff pages. */
// Admin areas a staff account can be given (see backend/food/staff.js). Full admins can open all of them.
const STAFF_AREAS = ["registrations", "swish", "messages", "checkin", "sweets", "scan", "scan_override", "games", "food", "settings"];

function userPerms() {
  try { return JSON.parse(sessionStorage.getItem("user_perms") || "[]") || []; } catch (e) { return []; }
}
// True when the logged-in user may use this admin area.
// "scan" means the QR scanner page: allowed with either scanner function.
function hasAccess(area) {
  const role = sessionStorage.getItem("user_role");
  if (role === "admin") return true;
  if (area === "scan") return hasAccess("checkin") || hasAccess("sweets");
  if (role === "scanner") return area === "checkin" || area === "sweets";
  return role === "staff" && userPerms().includes(area);
}

function checkAuth(requiredRole) {
  window.addEventListener("pageshow", e => { if (e.persisted) validateSession(requiredRole); });
  validateSession(requiredRole);
}
function validateSession(requiredRole) {
  const role=sessionStorage.getItem("user_role");
  const token=sessionStorage.getItem("auth_token");
  if (!role || !token) return logout();
  if (requiredRole === "admin" && role !== "admin") return logout();
  if (requiredRole === "vendor" && !["vendor","admin"].includes(role) && !hasAccess("food")) return logout();
  // Admin Home: full admins and staff accounts.
  if (requiredRole === "staff" && !["admin","staff","scanner"].includes(role)) return logout();
  // A page for one admin area: staff without that area go back to Admin Home.
  if (STAFF_AREAS.includes(requiredRole) && !hasAccess(requiredRole)) {
    if (["staff","scanner"].includes(role)) return window.location.replace("admin.html");
    return logout();
  }
}
async function authFetch(url, options={}) {
  const token=sessionStorage.getItem("auth_token");
  if (!token) { logout(); throw new Error("Authentication required"); }
  const headers=new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  const response=await fetch(url,{...options,headers});
  if (response.status===401 || response.status===403) { sessionStorage.clear(); window.location.replace("login.html"); throw new Error("Session expired or access denied"); }
  return response;
}
// Re-reads the staff member's areas from the server (an admin may have changed them), then runs done().
async function refreshAccess(done) {
  try {
    const r = await fetch("/food-api/staff/me", { headers: { Authorization: `Bearer ${sessionStorage.getItem("auth_token")}` }, cache: "no-store" });
    if (r.ok) { const d = await r.json(); if (Array.isArray(d.permissions)) sessionStorage.setItem("user_perms", JSON.stringify(d.permissions)); }
  } catch (e) { /* keep what we have */ }
  if (done) done();
}
function logout(){ sessionStorage.clear(); window.location.replace("login.html"); }

// WhatsApp links. "app" opens the WhatsApp app on this computer/phone straight away (whatsapp://);
// "web" goes through the api.whatsapp.com page in a new browser tab. The choice is remembered here.
function waMode(){ try { return localStorage.getItem("wa_open") === "web" ? "web" : "app"; } catch (e) { return "app"; } }
function setWaMode(m){ try { localStorage.setItem("wa_open", m === "web" ? "web" : "app"); } catch (e) {} }
function waUrl(digits, text){
  const q = `${digits ? `phone=${digits}&` : ""}text=${encodeURIComponent(text)}`;
  return waMode() === "app" ? `whatsapp://send?${q}` : `https://api.whatsapp.com/send?${q}`;
}
// target attribute for an <a href="waUrl(...)">: the app link must not open an empty tab.
function waTarget(){ return waMode() === "app" ? "" : ' target="_blank" rel="noopener"'; }
function openWa(digits, text){
  const u = waUrl(digits, text);
  if (waMode() === "app") location.href = u; else window.open(u, "_blank", "noopener");
}
// A small "Open WhatsApp in: app / browser" picker; onChange re-renders links.
function waModePicker(onChange){
  const l = document.createElement("label");
  l.className = "check"; l.style.cssText = "display:inline-flex;gap:6px;align-items:center;margin:6px 0";
  l.innerHTML = 'Open WhatsApp in: <select><option value="app">WhatsApp app (direct)</option><option value="web">Browser tab (WhatsApp Web)</option></select>';
  const sel = l.querySelector("select"); sel.value = waMode();
  sel.addEventListener("change", () => { setWaMode(sel.value); if (onChange) onChange(); });
  return l;
}
