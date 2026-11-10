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
