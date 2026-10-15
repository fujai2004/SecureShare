use crate::storage_client::StorageClient;
use rusqlite::{params, Connection};
use std::sync::{Arc, Mutex};

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMeta {
    pub id: String,
    pub name: String,
    pub size: usize,
    pub owner_id: String,
    pub wrapped_key: String,
}

#[derive(Clone)]
pub struct AppState {
    pub jwt_secret: String,
    pub db: Arc<Mutex<Connection>>,
    pub storage: StorageClient,
}

impl AppState {
    pub fn new(storage_url: String, path: &str, jwt_secret: String) -> Self {
        let db = Connection::open(path).expect("open metadata database");
        db.execute_batch("
            PRAGMA journal_mode=WAL;
            PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY, password_hash TEXT NOT NULL,
                public_key TEXT NOT NULL, encrypted_private_key TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS files (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, size INTEGER NOT NULL, owner_id TEXT NOT NULL REFERENCES users(username));
            CREATE TABLE IF NOT EXISTS grants (
                file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
                user_id TEXT NOT NULL REFERENCES users(username),
                wrapped_key TEXT NOT NULL, PRIMARY KEY(file_id,user_id));
            CREATE INDEX IF NOT EXISTS grants_user ON grants(user_id);
        ").expect("initialize metadata schema");
        Self {
            jwt_secret,
            db: Arc::new(Mutex::new(db)),
            storage: StorageClient::new(storage_url),
        }
    }
    pub fn file(&self, id: &str, user: &str) -> rusqlite::Result<FileMeta> {
        self.db.lock().unwrap().query_row(
            "SELECT f.id,f.name,f.size,f.owner_id,g.wrapped_key FROM files f JOIN grants g ON f.id=g.file_id WHERE f.id=?1 AND g.user_id=?2",
            params![id,user], file_row)
    }
}
pub fn file_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<FileMeta> {
    Ok(FileMeta {
        id: row.get(0)?,
        name: row.get(1)?,
        size: row.get(2)?,
        owner_id: row.get(3)?,
        wrapped_key: row.get(4)?,
    })
}
