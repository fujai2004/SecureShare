const IV_LENGTH = 12;
const TAG_LENGTH = 128;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const saltBytes = new Uint8Array(salt);
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations: 120_000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptFile(
  file: File,
  password: string
): Promise<ArrayBuffer> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt);
  const plaintext = await file.arrayBuffer();

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv), tagLength: TAG_LENGTH },
    key,
    plaintext
  );

  const payload = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
  payload.set(salt, 0);
  payload.set(iv, salt.length);
  payload.set(new Uint8Array(ciphertext), salt.length + iv.length);
  return payload.buffer;
}

export async function decryptFile(
  encrypted: ArrayBuffer,
  password: string
): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(encrypted);
  const salt = bytes.slice(0, 16);
  const iv = bytes.slice(16, 16 + IV_LENGTH);
  const ciphertext = bytes.slice(16 + IV_LENGTH);
  const key = await deriveKey(password, salt);

  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv), tagLength: TAG_LENGTH },
    key,
    new Uint8Array(ciphertext)
  );
}

export function fingerprintKeyMaterial(password: string): string {
  return toBase64(new TextEncoder().encode(password).buffer);
}

export { toBase64, fromBase64 };
