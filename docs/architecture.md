# Architecture and tradeoffs

## Data flow

1. Registration creates a 3072-bit RSA-OAEP key pair in Web Crypto. The browser encrypts the PKCS8 private key using AES-256-GCM and a PBKDF2 key (600,000 SHA-256 iterations, random 16-byte salt).
2. An independent domain-separated PBKDF2 derivation produces the authentication secret. The server stores an Argon2 hash of that value. The password itself is not sent.
3. Login returns a JWT, public key, and encrypted private-key vault. The browser unlocks the vault in memory.
4. Upload generates a random AES-256-GCM file key and 96-bit IV. A versioned binary payload contains SS01 + IV + authenticated ciphertext. The browser wraps the file key with its own RSA public key.
5. Rust writes the complete ciphertext to storage, then transactionally inserts file metadata and the owner's grant in SQLite. A storage failure cannot make a file visible.
6. Sharing unwraps the file key in the owner's browser and wraps it for the recipient after public-key fingerprint verification. Rust stores only the wrapped key and authorizes future reads.
7. Download returns ciphertext plus a user-specific key envelope from the file listing. The recipient decrypts locally.

## Persistence and concurrency

The API shares one SQLite connection across request-state clones. WAL mode and SQL transactions provide durable metadata and atomic file/grant insertion. Unique usernames avoid the scaffold's check-then-insert registration race. Password hashing runs on a blocking worker so it does not occupy an async executor thread.

The C++ service uses cpp-httplib's complete-body parser, a bounded eight-worker thread pool and queue, 10-second I/O timeouts, and a 25 MiB payload bound. IDs are validated before filesystem use. Chunks are immutable. Writes flush a temporary file and rename it while holding the store mutex. Readers observe complete chunks. Restart rebuilds the index and removes abandoned temporary files.

This provides process-restart recovery and atomic visibility. It does not promise storage replication, availability during host loss, or power-loss durability: the file write does not fsync the containing directory. A process crash between chunk creation and metadata commit can orphan ciphertext. Deletion removes metadata first so failed physical cleanup cannot retain API access; failed cleanup is logged. A production version needs an orphan reconciler and storage/database backups.

The MVP intentionally uses one API replica and one storage replica. Scaling these pods before moving metadata to a shared database and chunks to shared object storage would break consistency.

## Access and revocation

All file routes require a valid JWT. Only the owner can grant, revoke, or delete. Listings return each user's own wrapped key, never all recipients' envelopes. Revocation blocks subsequent API reads. A download already in progress may complete, and a downloaded key/ciphertext pair remains decryptable.

The Kubernetes deployment has persistent volumes, Recreate rollouts, a default-deny network policy, and explicit frontend -> API -> storage and DNS traffic. These manifests describe single-node demo operation; host loss, failover, and tenant provisioning are not implemented.

## Why these choices matter

The project demonstrates Rust async request handling, relational transactions, concurrent C++ I/O, complete HTTP message handling, browser envelope encryption, and deployment state boundaries. Keep the distinction between encryption, authentication, authorization, and durability clear when explaining it.
