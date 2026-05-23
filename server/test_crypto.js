const { generateSecureKeyIV, encryptBuffer, decryptBuffer, encryptText, decryptText } = require('./crypto_helper');

try {
  console.log("=== CRYPTO HELPER SELF-TEST ===");

  // 1. Test Text Cryptography
  const secretText = "HSBC Bank - 90,000,000 INR";
  console.log("Original Text:", secretText);
  const cipherText = encryptText(secretText);
  console.log("CipherText (hex):", cipherText);
  const clearText = decryptText(cipherText);
  console.log("Decrypted Text:", clearText);
  
  if (secretText !== clearText) throw new Error("Text encryption/decryption failed!");
  console.log("✔ Text cryptography self-test passed.");

  // 2. Test Buffer Cryptography (GCM)
  const credentials = generateSecureKeyIV();
  console.log("\nGenerated Ephemeral File Key:", credentials.key);
  console.log("Generated Ephemeral File IV:", credentials.iv);

  const fileData = Buffer.from("VouchAI Premium Zero-Trust Audit Document Payload text");
  console.log("Original Buffer Text:", fileData.toString());
  
  const encryptedBuf = encryptBuffer(fileData, credentials.key, credentials.iv);
  console.log("Encrypted Buffer Size:", encryptedBuf.length, "bytes (Tag appended)");
  
  const decryptedBuf = decryptBuffer(encryptedBuf, credentials.key, credentials.iv);
  console.log("Decrypted Buffer Text:", decryptedBuf.toString());
  
  if (fileData.toString() !== decryptedBuf.toString()) throw new Error("GCM buffer encryption/decryption failed!");
  console.log("✔ AES-256-GCM buffer cryptography self-test passed.");
  
  console.log("=== ALL CRYPTO TESTS PASSED SUCCESSFULLY ===");
} catch (err) {
  console.error("Crypto self-test failed:", err);
}
