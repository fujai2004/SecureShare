const API = import.meta.env.VITE_CRYPTO_API ?? "";
export type UserSession = {
  token: string;
  userId: string;
  publicKey: string;
  encryptedPrivateKey: string;
};
export type FileMeta = {
  id: string;
  name: string;
  size: number;
  ownerId: string;
  wrappedKey: string;
};
async function request(path: string, token?: string, init: RequestInit = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok)
    throw new Error(
      (await res.text()).trim() || `Request failed (${res.status})`,
    );
  return res;
}
export async function authenticate(
  mode: "login" | "register",
  username: string,
  password: string,
  identity?: { publicKey: string; encryptedPrivateKey: string },
): Promise<UserSession> {
  return (
    await request("/v1/auth/" + mode, undefined, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, ...identity }),
    })
  ).json();
}
export async function listFiles(token: string): Promise<FileMeta[]> {
  return (await request("/v1/files", token)).json();
}
export async function publicKey(
  token: string,
  username: string,
): Promise<string> {
  return (
    await (
      await request("/v1/users/" + encodeURIComponent(username) + "/key", token)
    ).json()
  ).publicKey;
}
export async function uploadEncryptedFile(
  token: string,
  name: string,
  ciphertext: ArrayBuffer,
  wrappedKey: string,
): Promise<FileMeta> {
  return (
    await request("/v1/files", token, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(name),
        "X-Wrapped-Key": wrappedKey,
      },
      body: ciphertext,
    })
  ).json();
}
export async function downloadEncryptedFile(
  token: string,
  id: string,
): Promise<ArrayBuffer> {
  return (await request("/v1/files/" + id, token)).arrayBuffer();
}
export async function grantAccess(
  token: string,
  id: string,
  recipientUserId: string,
  wrappedKey: string,
) {
  await request("/v1/files/" + id + "/grant", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipientUserId, wrappedKey }),
  });
}
export async function revokeAccess(
  token: string,
  id: string,
  username: string,
) {
  await request(
    "/v1/files/" + id + "/grants/" + encodeURIComponent(username),
    token,
    { method: "DELETE" },
  );
}
export async function deleteFile(token: string, id: string) {
  await request("/v1/files/" + id, token, { method: "DELETE" });
}
