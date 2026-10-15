# SecureShare

A portfolio MVP for encrypted file sharing across a React client, Rust API, and multithreaded C++ storage service.

Files are encrypted in the browser with a new AES-256-GCM key for each upload. That key is wrapped with RSA-OAEP separately for the owner and each recipient. A recipient signs in with their own account to decrypt; nobody needs to disclose their login password.

## Run locally

Install Docker Desktop and Node.js 22 for the test tools.

```sh
cp .env.example .env
# Replace JWT_SECRET in .env with a random value of at least 32 characters.
docker compose up --build -d
```

Open http://localhost:5173. Create an account with a 3-32 character username and a password of at least 12 characters. Upload a file up to 25 MiB. Create a second account in a private browser window. In the owner's window, choose the file, enter the recipient's username, and look up their key. Compare the fingerprint with the recipient's own displayed fingerprint over another channel, then share. The recipient can refresh and download.

The UI also supports revocation and deletion. Revocation prevents future server downloads; it cannot erase copies or keys someone already downloaded.

The frontend serves built assets through Nginx and proxies API requests on the same origin. The Rust API is also available locally on port 8080. Storage has no host port: only the API should access it.

## What persists

SQLite stores password hashes, encrypted private-key vaults, metadata, and per-recipient wrapped keys. A named volume stores that database; another holds ciphertext chunks. Restarting services preserves accounts, permissions, and files. `docker compose down -v` intentionally removes that state.

Old scaffold uploads are incompatible with the versioned SS01 encryption format. They did not have persistent metadata or transferable file keys; re-upload demo files using fresh accounts.

## Validation

```sh
cd frontend
npm ci
npm test
npm run build
npm run test:e2e
# To include actual Compose service restarts:
COMPOSE_RESTART=1 npm run test:e2e
```

PowerShell: `$env:COMPOSE_RESTART='1'; npm run test:e2e`.

```sh
cargo test --locked --manifest-path services/crypto-service/Cargo.toml
cargo clippy --locked --manifest-path services/crypto-service/Cargo.toml --all-targets -- -D warnings
cmake -S services/storage-service -B storage-build -DCMAKE_BUILD_TYPE=Release
cmake --build storage-build
ctest --test-dir storage-build --output-on-failure
```

With a native storage process listening on localhost:9000:
```sh
node tests/storage-smoke.mjs
cargo test --manifest-path tests/fault-injection/Cargo.toml
```

Tests cover real browser cryptographic primitives, wrong keys/passwords, tampering, API access control, persistent metadata, failed uploads, concurrent storage, incomplete HTTP bodies, and a full cross-account flow with service restarts. The fault harness fails if storage is unavailable; it never silently skips.

See [architecture](docs/architecture.md), [MVP status](docs/mvp-status.md), and [Kubernetes instructions](deploy/k8s/README.md).

## Native development

Use Node.js 22+, a current stable Rust toolchain, CMake 3.20+, and a C++20 compiler. CMake fetches the pinned cpp-httplib release for HTTP parsing. Build and start storage with `STORAGE_DATA_DIR` pointing to a writable directory; the default is /data. Set `JWT_SECRET`, `DATABASE_PATH`, and optionally `STORAGE_SERVICE_URL` before `cargo run` in services/crypto-service. Run `npm run dev` in frontend; Vite proxies same-origin /v1 requests to http://localhost:8080. Set VITE_CRYPTO_API only when deliberately using another API origin.

## Security boundaries

Passwords and unwrapped private keys stay in browser memory. Authentication uses a separate, domain-separated PBKDF2-derived secret, which the API hashes with Argon2. The private-key vault uses AES-GCM and a random salt. Public keys come from an authenticated directory; fingerprint comparison detects substitution only when users actually compare them through a trusted channel.

The API still sees filenames, sizes, account names, and sharing relationships. It cannot cryptographically prevent a recipient from resharing plaintext. There is no password reset, key rotation, forward secrecy, malware scanning, global disk quota, or rate limit on account creation. HTTPS is required outside localhost; the origin serving the application must be trusted. This is a learning MVP, not an audited security product.

Storage is an unauthenticated internal service. Network isolation is part of its access boundary. See the Kubernetes manifests for explicit API-to-storage policy.

MIT license.
