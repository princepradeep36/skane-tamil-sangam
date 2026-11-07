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

    // Customer phone, read the same way as the event registration form: returns
    // +<country code><number>, or null. 07... is taken as Swedish, a bare 10-digit
    // number starting 6-9 as Indian.
    normalizePhone: function (value) {
        let phone = String(value || '').trim().replace(/[\s().-]/g, '');
        if (phone.startsWith('00')) phone = '+' + phone.slice(2);
        if (/^0\d{9}$/.test(phone)) phone = '+46' + phone.slice(1);
        else if (/^7\d{8}$/.test(phone)) phone = '+46' + phone;
        else if (/^[6-9]\d{9}$/.test(phone)) phone = '+91' + phone;
        return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
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
