/** JWT authentication helper for staff pages. */
function checkAuth(requiredRole) {
  window.addEventListener("pageshow", e => { if (e.persisted) validateSession(requiredRole); });
  validateSession(requiredRole);
}
function validateSession(requiredRole) {
  const role=sessionStorage.getItem("user_role");
  const token=sessionStorage.getItem("auth_token");
  if (!role || !token) return logout();
  if (requiredRole === "admin" && role !== "admin") return logout();
  if (requiredRole === "vendor" && !["vendor","admin"].includes(role)) return logout();
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
function logout(){ sessionStorage.clear(); window.location.replace("login.html"); }
