const CryptoJS = require("crypto-js");
const SECRET_KEY = "SKANE_TAMIL_SANGAM_KEY_2026"; // In production, move to .env

const encryptData = (text) => {
    if (!text) return "";
    return CryptoJS.AES.encrypt(text, SECRET_KEY).toString();
};

const decryptData = (ciphertext) => {
    if (!ciphertext) return "";
    const bytes = CryptoJS.AES.decrypt(ciphertext, SECRET_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
};

module.exports = { encryptData, decryptData };