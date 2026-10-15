use crate::{
    auth::{hash_password, issue_token, verify_password, verify_token},
    state::{file_row, AppState, FileMeta},
};
use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

const MAX_UPLOAD: usize = 25 * 1024 * 1024 + 64;
type ApiError = (StatusCode, &'static str);
fn internal(_: rusqlite::Error) -> ApiError {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        "metadata operation failed",
    )
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/v1/auth/register", post(register))
        .route("/v1/auth/login", post(login))
        .route("/v1/users/:username/key", get(public_key))
        .route("/v1/files", get(list_files).post(upload_file))
        .route("/v1/files/:id", get(download_file).delete(delete_file))
        .route("/v1/files/:id/grant", post(grant_access))
        .route(
            "/v1/files/:id/grants/:user",
            axum::routing::delete(revoke_access),
        )
        .layer(DefaultBodyLimit::max(MAX_UPLOAD))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthRequest {
    username: String,
    password: String,
    public_key: Option<String>,
    encrypted_private_key: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthResponse {
    token: String,
    user_id: String,
    public_key: String,
    encrypted_private_key: String,
}

async fn register(
    State(s): State<AppState>,
    Json(b): Json<AuthRequest>,
) -> Result<Json<AuthResponse>, ApiError> {
    if b.username.len() < 3
        || b.username.len() > 32
        || !b
            .username
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
        || b.password.len() < 32
        || b.password.len() > 256
    {
        return Err((
            StatusCode::BAD_REQUEST,
            "username must be 3-32 letters, digits, _ or -; use the browser client to register",
        ));
    }
    let public_key = b
        .public_key
        .filter(|v| v.len() >= 256 && v.len() <= 2048)
        .ok_or((StatusCode::BAD_REQUEST, "public key required"))?;
    let encrypted_private_key = b
        .encrypted_private_key
        .filter(|v| v.len() >= 256 && v.len() <= 16384)
        .ok_or((StatusCode::BAD_REQUEST, "encrypted private key required"))?;
    let password = b.password;
    let hash = tokio::task::spawn_blocking(move || hash_password(&password))
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "password hashing failed"))?;
    {
        let db = s.db.lock().unwrap();
        let inserted = db
            .execute(
                "INSERT OR IGNORE INTO users VALUES (?1,?2,?3,?4)",
                params![b.username, hash, public_key, encrypted_private_key],
            )
            .map_err(internal)?;
        if inserted == 0 {
            return Err((StatusCode::CONFLICT, "username already exists"));
        }
    }
    Ok(Json(AuthResponse {
        token: issue_token(&b.username, &s.jwt_secret),
        user_id: b.username,
        public_key,
        encrypted_private_key,
    }))
}
async fn login(
    State(s): State<AppState>,
    Json(b): Json<AuthRequest>,
) -> Result<Json<AuthResponse>, ApiError> {
    if b.password.len() > 256 {
        return Err((StatusCode::BAD_REQUEST, "invalid credentials"));
    }
    let record = s
        .db
        .lock()
        .unwrap()
        .query_row(
            "SELECT password_hash,public_key,encrypted_private_key FROM users WHERE username=?1",
            [&b.username],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(internal)?;
    let (hash, public_key, encrypted_private_key) =
        record.ok_or((StatusCode::UNAUTHORIZED, "invalid credentials"))?;
    let valid = tokio::task::spawn_blocking(move || verify_password(&b.password, &hash))
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "password verification failed",
            )
        })?;
    if !valid {
        return Err((StatusCode::UNAUTHORIZED, "invalid credentials"));
    }
    Ok(Json(AuthResponse {
        token: issue_token(&b.username, &s.jwt_secret),
        user_id: b.username,
        public_key,
        encrypted_private_key,
    }))
}
fn user(s: &AppState, h: &HeaderMap) -> Result<String, ApiError> {
    let token = h
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or((StatusCode::UNAUTHORIZED, "sign in required"))?;
    verify_token(token, &s.jwt_secret).ok_or((StatusCode::UNAUTHORIZED, "session expired"))
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicKey {
    public_key: String,
}
async fn public_key(
    State(s): State<AppState>,
    h: HeaderMap,
    Path(username): Path<String>,
) -> Result<Json<PublicKey>, ApiError> {
    user(&s, &h)?;
    let key =
        s.db.lock()
            .unwrap()
            .query_row(
                "SELECT public_key FROM users WHERE username=?1",
                [username],
                |r| r.get(0),
            )
            .optional()
            .map_err(internal)?
            .ok_or((StatusCode::NOT_FOUND, "recipient not found"))?;
    Ok(Json(PublicKey { public_key: key }))
}
async fn list_files(
    State(s): State<AppState>,
    h: HeaderMap,
) -> Result<Json<Vec<FileMeta>>, ApiError> {
    let u = user(&s, &h)?;
    let db = s.db.lock().unwrap();
    let mut q = db.prepare("SELECT f.id,f.name,f.size,f.owner_id,g.wrapped_key FROM files f JOIN grants g ON f.id=g.file_id WHERE g.user_id=?1 ORDER BY f.rowid DESC").map_err(internal)?;
    let rows = q
        .query_map([u], file_row)
        .map_err(internal)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(internal)?;
    Ok(Json(rows))
}
fn header(h: &HeaderMap, key: &str) -> Result<String, ApiError> {
    h.get(key)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
        .ok_or((StatusCode::BAD_REQUEST, "missing file headers"))
}
async fn upload_file(
    State(s): State<AppState>,
    h: HeaderMap,
    body: Bytes,
) -> Result<Json<FileMeta>, ApiError> {
    let u = user(&s, &h)?;
    let encoded_name = header(&h, "x-file-name")?;
    let name = percent_encoding::percent_decode_str(&encoded_name)
        .decode_utf8()
        .map_err(|_| (StatusCode::BAD_REQUEST, "invalid filename"))?
        .into_owned();
    let key = header(&h, "x-wrapped-key")?;
    if name.is_empty()
        || name.len() > 1024
        || key.len() > 2048
        || key.len() < 256
        || body.len() < 32
    {
        return Err((StatusCode::BAD_REQUEST, "invalid encrypted file"));
    }
    let id = uuid::Uuid::new_v4().to_string();
    s.storage
        .put_chunk(&id, &body)
        .await
        .map_err(|_| (StatusCode::BAD_GATEWAY, "storage unavailable"))?;
    let inserted = (|| -> rusqlite::Result<()> {
        let mut db = s.db.lock().unwrap();
        let tx = db.transaction()?;
        tx.execute(
            "INSERT INTO files VALUES (?1,?2,?3,?4)",
            params![id, name, body.len(), u],
        )?;
        tx.execute("INSERT INTO grants VALUES (?1,?2,?3)", params![id, u, key])?;
        tx.commit()
    })();
    if let Err(e) = inserted {
        let _ = s.storage.delete_chunk(&id).await;
        return Err(internal(e));
    }
    Ok(Json(FileMeta {
        id,
        name,
        size: body.len(),
        owner_id: u,
        wrapped_key: key,
    }))
}
async fn download_file(
    State(s): State<AppState>,
    h: HeaderMap,
    Path(id): Path<String>,
) -> Result<([(String, String); 1], Vec<u8>), ApiError> {
    let u = user(&s, &h)?;
    s.file(&id, &u)
        .map_err(|_| (StatusCode::FORBIDDEN, "access denied"))?;
    let data = s
        .storage
        .get_chunk(&id)
        .await
        .map_err(|_| (StatusCode::BAD_GATEWAY, "storage unavailable"))?;
    Ok((
        [("Content-Type".into(), "application/octet-stream".into())],
        data,
    ))
}
fn require_owner(s: &AppState, id: &str, u: &str) -> Result<(), ApiError> {
    let owner: Option<String> =
        s.db.lock()
            .unwrap()
            .query_row("SELECT owner_id FROM files WHERE id=?1", [id], |r| r.get(0))
            .optional()
            .map_err(internal)?;
    if owner.as_deref() != Some(u) {
        return Err((StatusCode::FORBIDDEN, "only the owner can change access"));
    }
    Ok(())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GrantRequest {
    recipient_user_id: String,
    wrapped_key: String,
}
async fn grant_access(
    State(s): State<AppState>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(b): Json<GrantRequest>,
) -> Result<StatusCode, ApiError> {
    let u = user(&s, &h)?;
    if b.wrapped_key.len() < 256 || b.wrapped_key.len() > 2048 {
        return Err((StatusCode::BAD_REQUEST, "invalid wrapped key"));
    }
    // Check ownership and write the grant under one lock to avoid racing deletion.
    let db = s.db.lock().unwrap();
    let owner: Option<String> = db
        .query_row("SELECT owner_id FROM files WHERE id=?1", [&id], |r| {
            r.get(0)
        })
        .optional()
        .map_err(internal)?;
    if owner.as_deref() != Some(&u) {
        return Err((StatusCode::FORBIDDEN, "only the owner can share"));
    }
    if b.recipient_user_id == u {
        return Err((StatusCode::BAD_REQUEST, "owner already has access"));
    }
    if !db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM users WHERE username=?1)",
            [&b.recipient_user_id],
            |r| r.get::<_, bool>(0),
        )
        .map_err(internal)?
    {
        return Err((StatusCode::NOT_FOUND, "recipient not found"));
    }
    db.execute("INSERT INTO grants VALUES (?1,?2,?3) ON CONFLICT(file_id,user_id) DO UPDATE SET wrapped_key=excluded.wrapped_key",
        params![id,b.recipient_user_id,b.wrapped_key]).map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}
async fn revoke_access(
    State(s): State<AppState>,
    h: HeaderMap,
    Path((id, target)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let u = user(&s, &h)?;
    require_owner(&s, &id, &u)?;
    if target == u {
        return Err((StatusCode::BAD_REQUEST, "cannot revoke owner"));
    }
    s.db.lock()
        .unwrap()
        .execute(
            "DELETE FROM grants WHERE file_id=?1 AND user_id=?2",
            params![id, target],
        )
        .map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}
async fn delete_file(
    State(s): State<AppState>,
    h: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let u = user(&s, &h)?;
    require_owner(&s, &id, &u)?;
    // Revoke metadata first. A failed chunk deletion leaves only unreachable ciphertext.
    s.db.lock()
        .unwrap()
        .execute("DELETE FROM files WHERE id=?1", [&id])
        .map_err(internal)?;
    if let Err(e) = s.storage.delete_chunk(&id).await {
        tracing::warn!(file_id=%id, error=%e, "orphaned ciphertext requires cleanup");
    }
    Ok(StatusCode::NO_CONTENT)
}
