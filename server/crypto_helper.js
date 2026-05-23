const crypto = require('crypto');

// Derives a secure 32-byte (256-bit) buffer key from the environment secret
const masterSecret = process.env.ENCRYPTION_SECRET || 'fallback-vouch-ai-secret-default-key-32b';
const MASTER_KEY = crypto.createHash('sha256').update(masterSecret).digest();

/**
 * Symmetrically encrypts clear text using AES-256-CBC with the master key.
 * Stored format is 'hex_iv:hex_ciphertext'
 */
function encryptText(text) {
  if (text === null || text === undefined) return text;
  const str = String(text);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', MASTER_KEY, iv);
  let encrypted = cipher.update(str, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * Symmetrically decrypts hex-encoded ciphertexts back into clear text.
 */
function decryptText(ciphertext) {
  if (!ciphertext || !String(ciphertext).includes(':')) return ciphertext;
  try {
    const parts = String(ciphertext).split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = Buffer.from(parts[1], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', MASTER_KEY, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error("Decryption failed. Returning original ciphertext.", err);
    return ciphertext;
  }
}

/**
 * Wraps (encrypts) a hex-encoded file-specific symmetric key (DEK) using the master key.
 */
function wrapKey(clearKeyHex) {
  if (!clearKeyHex) return clearKeyHex;
  return encryptText(clearKeyHex);
}

/**
 * Unwraps (decrypts) a wrapped key back to its original clear hex string.
 */
function unwrapKey(wrappedKeyHex) {
  if (!wrappedKeyHex) return wrappedKeyHex;
  return decryptText(wrappedKeyHex);
}

/**
 * Generates a random cryptographically secure 256-bit (32 bytes) symmetric key
 * and a 96-bit (12 bytes) Initialization Vector suitable for AES-GCM.
 * Returns hex strings.
 */
function generateSecureKeyIV() {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12); // standard 96-bit IV for AES-GCM
  return {
    key: key.toString('hex'),
    iv: iv.toString('hex')
  };
}

/**
 * Decrypts a binary buffer that was encrypted via client-side Web Crypto AES-GCM.
 * Web Crypto API appends the 16-byte authentication tag at the end of the ciphertext.
 */
function decryptBuffer(encryptedBuffer, keyHex, ivHex) {
  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  
  // Split GCM ciphertext and the 16-byte authentication tag from the end
  const ciphertext = encryptedBuffer.subarray(0, encryptedBuffer.length - 16);
  const tag = encryptedBuffer.subarray(encryptedBuffer.length - 16);
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  
  let decrypted = decipher.update(ciphertext);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted;
}

/**
 * Encrypts a binary buffer using AES-256-GCM.
 * Appends the 16-byte authentication tag at the end to match Web Crypto standards.
 */
function encryptBuffer(buffer, keyHex, ivHex) {
  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(buffer);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const tag = cipher.getAuthTag();
  
  return Buffer.concat([encrypted, tag]);
}

module.exports = {
  encryptText,
  decryptText,
  wrapKey,
  unwrapKey,
  generateSecureKeyIV,
  decryptBuffer,
  encryptBuffer
};
