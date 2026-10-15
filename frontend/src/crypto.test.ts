import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createIdentity,
  unlockIdentity,
  verifyIdentity,
  encryptFile,
  decryptFile,
  unwrapFileKey,
  wrapFileKey,
  authPassword,
} from "./crypto";
test("recipient decrypts with their own key; strangers, tampering and wrong passwords fail", async () => {
  const alice = await createIdentity("alice private password");
  const bob = await createIdentity("bob private password");
  const a = await unlockIdentity(
    alice.encryptedPrivateKey,
    "alice private password",
  );
  const b = await unlockIdentity(
    bob.encryptedPrivateKey,
    "bob private password",
  );
  const file = new Blob([new Uint8Array(512 * 1024).fill(37)]);
  await verifyIdentity(a, alice.publicKey);
  await assert.rejects(verifyIdentity(a, bob.publicKey));
  const encrypted = await encryptFile(file, alice.publicKey);
  assert.deepEqual(
    await decryptFile(encrypted.ciphertext, encrypted.wrappedKey, a),
    await file.arrayBuffer(),
  );
  await assert.rejects(
    decryptFile(encrypted.ciphertext, encrypted.wrappedKey, b),
  );
  const shared = await wrapFileKey(
    await unwrapFileKey(encrypted.wrappedKey, a),
    bob.publicKey,
  );
  assert.deepEqual(
    await decryptFile(encrypted.ciphertext, shared, b),
    await file.arrayBuffer(),
  );
  const modified = encrypted.ciphertext.slice(0);
  new Uint8Array(modified)[50] ^= 1;
  await assert.rejects(decryptFile(modified, shared, b));
  await assert.rejects(
    unlockIdentity(alice.encryptedPrivateKey, "wrong password"),
  );
  const second = await encryptFile(file, alice.publicKey);
  assert.notDeepEqual(second.ciphertext, encrypted.ciphertext);
  assert.notEqual(
    await authPassword("alice", "password"),
    await authPassword("bobby", "password"),
  );
  const empty = await encryptFile(new Blob([]), alice.publicKey);
  assert.equal(
    (await decryptFile(empty.ciphertext, empty.wrappedKey, a)).byteLength,
    0,
  );
});
