/**
 * Validation & Safety Utilities
 */

const Validation = {
    // Phone Number Validation
    isValidPhone: function (phone) {
        if (!phone || typeof phone !== 'string') return false;

        // 1. Basic format: 10 digits
        if (!/^\d{10}$/.test(phone)) return false;

        // 2. Check for all same digits (e.g., 0000000000, 1111111111)
        if (/^(\d)\1{9}$/.test(phone)) return false;

        // 3. Check for specific sequential patterns
        const sequences = ['0123456789', '1234567890', '9876543210'];
        if (sequences.includes(phone)) return false;

        return true;
    },

    // Escape for HTML Attributes (e.g., value="...")
    escapeHtml: function (str) {
        if (!str) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    },

    // Escape for Inline JS (e.g., onclick="func('...')")
    escapeJs: function (str) {
        if (!str) return "";
        return String(str).replace(/'/g, "\\'");
    }
};

// Expose globally if not using modules (simplest for this app)
window.Validation = Validation;
