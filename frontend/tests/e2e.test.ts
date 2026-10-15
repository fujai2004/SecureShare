import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { once } from "node:events";
import * as crypto from "../src/crypto";
const api = process.env.API_URL ?? "http://localhost:8080";
async function ready(url: string) {
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch(url + "/health")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Service did not become healthy: " + url);
}
async function stop(child: ChildProcess | undefined) {
  if (child && child.exitCode === null) {
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }
}
test(
  "full stack encrypted upload, cross-account share, restart, revoke and delete",
  { timeout: 180_000 },
  async () => {
    const native = Boolean(process.env.CRYPTO_BIN && process.env.STORAGE_BIN);
    const dir = mkdtempSync(resolve("test-data-"));
    let storage: ChildProcess | undefined, server: ChildProcess | undefined;
    const startApi = () =>
      spawn(process.env.CRYPTO_BIN!, [], {
        cwd: dir,
        env: {
          ...process.env,
          JWT_SECRET: "test-secret-abcdefghijklmnopqrstuvwxyz",
          DATABASE_PATH: resolve(dir, "metadata.db"),
          STORAGE_SERVICE_URL: "http://localhost:9000",
        },
        stdio: "inherit",
      });
    async function req(
      method: string,
      path: string,
      token?: string,
      body?: unknown,
      extra: Record<string, string> = {},
    ) {
      return fetch(api + path, {
        method,
        headers: {
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...(body instanceof ArrayBuffer
            ? {}
            : { "Content-Type": "application/json" }),
          ...extra,
        },
        body:
          body === undefined
            ? undefined
            : body instanceof ArrayBuffer
              ? body
              : JSON.stringify(body),
      });
    }
    try {
      if (native) {
        storage = spawn(process.env.STORAGE_BIN!, [], {
          cwd: dir,
          env: { ...process.env, STORAGE_DATA_DIR: resolve(dir, "chunks") },
          stdio: "inherit",
        });
        await ready("http://localhost:9000");
        server = startApi();
      }
      await ready(api);
      const suffix = Date.now().toString(36);
      async function account(prefix: string) {
        const name = prefix + suffix,
          password = "private password " + name;
        const identity = await crypto.createIdentity(password);
        const res = await req("POST", "/v1/auth/register", undefined, {
          username: name,
          password: await crypto.authPassword(name, password),
          ...identity,
        });
        assert.equal(res.status, 200, await res.clone().text());
        const session = await res.json();
        return {
          name,
          password,
          ...session,
          key: await crypto.unlockIdentity(
            session.encryptedPrivateKey,
            password,
          ),
        };
      }
      const alice = await account("alice"),
        bob = await account("bob"),
        eve = await account("eve");
      const bytes = new Uint8Array(2 * 1024 * 1024);
      for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
      const file = await crypto.encryptFile(new Blob([bytes]), alice.publicKey);
      const upload = await req(
        "POST",
        "/v1/files",
        alice.token,
        file.ciphertext,
        {
          "Content-Type": "application/octet-stream",
          "X-File-Name": encodeURIComponent("sample é.bin"),
          "X-Wrapped-Key": file.wrappedKey,
        },
      );
      assert.equal(upload.status, 200, await upload.clone().text());
      const meta = await upload.json();
      const path = "/v1/files/" + meta.id;
      assert.equal((await req("GET", path, bob.token)).status, 403);
      const recipient = await (
        await req("GET", "/v1/users/" + bob.name + "/key", alice.token)
      ).json();
      const wrappedKey = await crypto.wrapFileKey(
        await crypto.unwrapFileKey(meta.wrappedKey, alice.key),
        recipient.publicKey,
      );
      assert.equal(
        (
          await req("POST", path + "/grant", alice.token, {
            recipientUserId: bob.name,
            wrappedKey,
          })
        ).status,
        204,
      );
      if (native) {
        await stop(server);
        await stop(storage);
        storage = spawn(process.env.STORAGE_BIN!, [], {
          cwd: dir,
          env: { ...process.env, STORAGE_DATA_DIR: resolve(dir, "chunks") },
          stdio: "inherit",
        });
        await ready("http://localhost:9000");
        server = startApi();
        await ready(api);
      } else if (process.env.COMPOSE_RESTART === "1") {
        execFileSync(
          "docker",
          ["compose", "restart", "crypto-service", "storage-service"],
          { cwd: resolve(".."), stdio: "inherit" },
        );
        await ready(api);
      }
      const login = await req("POST", "/v1/auth/login", undefined, {
        username: alice.name,
        password: await crypto.authPassword(alice.name, alice.password),
      });
      assert.equal(login.status, 200, "account survives restart");
      const listed = await (await req("GET", "/v1/files", bob.token)).json();
      const shared = listed.find((f: { id: string }) => f.id === meta.id);
      assert.equal(shared.name, "sample é.bin");
      const downloaded = await (
        await req("GET", path, bob.token)
      ).arrayBuffer();
      assert.deepEqual(
        new Uint8Array(
          await crypto.decryptFile(downloaded, shared.wrappedKey, bob.key),
        ),
        bytes,
      );
      assert.equal((await req("GET", path, eve.token)).status, 403);
      assert.equal((await req("DELETE", path, bob.token)).status, 403);
      assert.equal(
        (await req("DELETE", path + "/grants/" + bob.name, alice.token)).status,
        204,
      );
      assert.equal((await req("GET", path, bob.token)).status, 403);
      assert.equal((await req("DELETE", path, alice.token)).status, 204);
      assert(
        !(await (await req("GET", "/v1/files", alice.token)).json()).some(
          (f: { id: string }) => f.id === meta.id,
        ),
      );
    } finally {
      await stop(server);
      await stop(storage);
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
