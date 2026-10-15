const enc = new TextEncoder();
const RSA = { name: "RSA-OAEP", hash: "SHA-256" };
export function toBase64(data: ArrayBuffer | Uint8Array): string {
  return btoa(Array.from(new Uint8Array(data instanceof Uint8Array ? data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength) : data), b => String.fromCharCode(b)).join(""));
}
export function fromBase64(value: string): ArrayBuffer {
  return Uint8Array.from(atob(value), c => c.charCodeAt(0)).buffer;
}
async function passwordKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveKey"]);
  return crypto.subtle.deriveKey({ name:"PBKDF2",salt:new Uint8Array(salt).buffer,iterations:600_000,hash:"SHA-256" },
    material,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
// Separate authentication material from the password that protects the private key.
export async function authPassword(username: string,password: string): Promise<string> {
  const material = await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveBits"]);
  return toBase64(await crypto.subtle.deriveBits({name:"PBKDF2",salt:enc.encode("SecureShare auth v1:"+username),iterations:600_000,hash:"SHA-256"},material,256));
}
export async function createIdentity(password: string) {
  const pair = await crypto.subtle.generateKey({...RSA,modulusLength:3072,publicExponent:new Uint8Array([1,0,1])},true,["wrapKey","unwrapKey"]);
  const publicKey = toBase64(await crypto.subtle.exportKey("spki",pair.publicKey));
  const privateBytes = await crypto.subtle.exportKey("pkcs8",pair.privateKey);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await passwordKey(password,salt);
  const cipher = await crypto.subtle.encrypt({name:"AES-GCM",iv},key,privateBytes);
  const encryptedPrivateKey = JSON.stringify({version:1,salt:toBase64(salt),iv:toBase64(iv),ciphertext:toBase64(cipher)});
  return {publicKey,encryptedPrivateKey};
}
export async function unlockIdentity(payload: string,password: string): Promise<CryptoKey> {
  const vault = JSON.parse(payload);
  if (vault.version !== 1) throw new Error("Unsupported key vault");
  const key = await passwordKey(password,new Uint8Array(fromBase64(vault.salt)));
  const raw = await crypto.subtle.decrypt({name:"AES-GCM",iv:fromBase64(vault.iv)},key,fromBase64(vault.ciphertext));
  return crypto.subtle.importKey("pkcs8",raw,RSA,false,["unwrapKey"]);
}
export async function wrapFileKey(key: CryptoKey, publicKey: string): Promise<string> {
  const recipient = await crypto.subtle.importKey("spki",fromBase64(publicKey),RSA,false,["wrapKey"]);
  return toBase64(await crypto.subtle.wrapKey("raw",key,recipient,"RSA-OAEP"));
}
export async function unwrapFileKey(wrappedKey: string, privateKey: CryptoKey): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey("raw",fromBase64(wrappedKey),privateKey,"RSA-OAEP",{name:"AES-GCM",length:256},true,["encrypt","decrypt"]);
}
export async function encryptFile(file: Blob,publicKey: string) {
  const key = await crypto.subtle.generateKey({name:"AES-GCM",length:256},true,["encrypt","decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({name:"AES-GCM",iv},key,await file.arrayBuffer());
  const payload = new Uint8Array(4+12+ciphertext.byteLength);
  payload.set(enc.encode("SS01")); payload.set(iv,4); payload.set(new Uint8Array(ciphertext),16);
  return {ciphertext:payload.buffer,wrappedKey:await wrapFileKey(key,publicKey)};
}
export async function decryptFile(encrypted: ArrayBuffer,wrappedKey: string,privateKey: CryptoKey): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(encrypted);
  if (bytes.length < 32 || new TextDecoder().decode(bytes.slice(0,4)) !== "SS01") throw new Error("Unsupported encrypted file");
  const key = await unwrapFileKey(wrappedKey,privateKey);
  return crypto.subtle.decrypt({name:"AES-GCM",iv:bytes.slice(4,16)},key,bytes.slice(16));
}
export async function fingerprint(publicKey: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256",fromBase64(publicKey));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,"0")).join(":");
}
