/**
 * Authentication Helper
 * Handles session validation and logout.
 */

function checkAuth(requiredRole) {
    // Handle Page Show (Back Button Cache)
    window.addEventListener('pageshow', function (event) {
        if (event.persisted || window.performance && window.performance.navigation.type === 2) {
            validateSession(requiredRole);
        }
    });

    // Initial check
    validateSession(requiredRole);
}

function validateSession(requiredRole) {
    const role = sessionStorage.getItem("user_role");
    const vendorId = sessionStorage.getItem("vendor_id");

    if (!role) {
        window.location.replace("login.html");
        return;
    }

    if (requiredRole && role !== requiredRole) {
        // Allow Admin to access Vendor pages? Usually yes, but depends.
        // For now strict check unless role is 'any'
        if (requiredRole !== 'any' && role !== 'admin') {
            // If I am admin, I can usually access everything. 
            // If I am vendor, I can only access vendor stuff.
            if (requiredRole === 'admin' && role !== 'admin') {
                window.location.replace("login.html");
            }
        }
    }
}

function logout() {
    sessionStorage.clear();
    window.location.replace("login.html");
}
