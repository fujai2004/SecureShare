# Ciphertext storage
C++20 immutable chunk storage with a bounded HTTP worker pool.
Build with CMake; run storage-service with STORAGE_DATA_DIR (default /data) and STORAGE_PORT (default 9000).
PUT /v1/chunks/:id creates a chunk; existing IDs return 409. GET reads it; DELETE removes it.
IDs contain up to 128 letters/digits/hyphens. Payloads are bounded to 25 MiB plus encryption overhead.
This service has no user authentication: expose it only to the Rust API on a private network.
Run CTest and the root tests/storage-smoke.mjs harness against the running service.
