# MVP status

## Implemented and locally verified

- Browser AES-256-GCM file encryption and RSA-OAEP recipient envelopes.
- Encrypted private-key vaults; separate login secrets.
- Persistent SQLite accounts, file records and per-user permissions.
- Owner-only grant, revoke and delete operations.
- Real React encryption code -> Rust -> C++ round trip of a 2 MiB binary file.
- Both native services restarted mid-test; login, grants and original bytes survived.
- Crypto rejection of wrong keys, wrong vault passwords and changed ciphertext.
- API denial for strangers and non-owner changes; no metadata committed on storage failure.
- C++ concurrent immutable writes, restart/index rebuild, path validation and deletion.
- Large binary HTTP transfer and disconnected writer rejection.
- Frontend production build, Rust tests and strict Clippy checks.
- Browser registration and vault opening through the development proxy.
- Owner public/private key matching; a substituted owner public key is rejected.

## Prepared, requiring deployment verification

- Compose services, same-origin frontend proxy, persistent volumes and full-stack CI.
- Kubernetes PVCs, single-replica Recreate strategy and explicit network policies.
- CI includes an actual Compose restart test.

Docker Desktop's engine was unavailable in the implementation environment. A Kubernetes cluster was not available. Native service restart tests establish process-level recovery; they do not establish Kubernetes node-failure consistency.

## Remaining beyond a rough MVP

- Shared object storage and PostgreSQL before adding replicas.
- Key rotation/recovery and stronger identity verification.
- Cleanup/reconciliation for orphaned chunks and disk quotas.
- TLS termination, account abuse controls, operational backups.
- Verified Kubernetes pod/node fault experiments.

## Resume alignment

The code supports discussing browser AES-256-GCM, RSA key wrapping with recipient fingerprint verification, Rust API authorization and persistence, multithreaded C++ storage, and regression/failure tests. Keep Kubernetes deployment and node-failure results qualified until those experiments have actually run. Avoid claiming zero data loss under host or disk failure.
