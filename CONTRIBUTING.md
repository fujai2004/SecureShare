# Contributing to SecureShare

Thanks for your interest in this project. SecureShare is a learning and portfolio codebase. Contributions, issues, and feedback are welcome.

## Getting started

1. Fork the repository and clone your fork.
2. Run the stack locally:

   ```bash
   docker compose up --build
   ```

3. Open http://localhost:5173 and verify register, upload, share, and download flows.

## Project layout

| Path | Description |
|------|-------------|
| `frontend/` | React client (Web Crypto AES-256-GCM) |
| `services/crypto-service/` | Rust API: auth, ACLs, file metadata |
| `services/storage-service/` | C++ multithreaded chunk store |
| `deploy/k8s/` | Kubernetes manifests |
| `tests/fault-injection/` | Storage reliability tests |

## Code guidelines

- Match existing style in each language (Rust, C++, TypeScript).
- Keep changes focused. Avoid unrelated refactors in the same PR.
- Do not commit secrets, `.env` files, or `node_modules/`.
- Prefer plain punctuation in user-facing copy (no em dashes).

## Windows notes

Source files should be **UTF-8** (not UTF-16). If Docker builds fail with CMake or Cargo parse errors, re-save affected files as UTF-8.

Native C++ builds target Linux (Docker/WSL). Use Docker Compose on Windows for the easiest path.

## Pull requests

1. Describe what changed and why.
2. Note how you tested (e.g. `docker compose up --build`, manual UI test).
3. Link any related issue.

## Production deployments

For Kubernetes, set a strong `JWT_SECRET` and replace default secrets in `deploy/k8s/base/secrets.yaml` before deploying publicly.
