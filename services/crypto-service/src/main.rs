mod auth;
mod routes;
mod state;
mod storage_client;
#[cfg(test)] mod tests;
use axum::Router;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing_subscriber::EnvFilter;
#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into())).init();
    let secret = std::env::var("JWT_SECRET").expect("set JWT_SECRET to at least 32 characters");
    assert!(secret.len() >= 32, "JWT_SECRET must have at least 32 characters");
    let path = std::env::var("DATABASE_PATH").unwrap_or_else(|_| "secureshare.db".into());
    let storage = std::env::var("STORAGE_SERVICE_URL").unwrap_or_else(|_| "http://127.0.0.1:9000".into());
    let origin: axum::http::HeaderValue = std::env::var("FRONTEND_ORIGIN").unwrap_or_else(|_| "http://localhost:5173".into()).parse().expect("valid frontend origin");
    let state = state::AppState::new(storage, &path, secret);
    let app = Router::new().merge(routes::router())
        .layer(CorsLayer::new().allow_origin(origin)
            .allow_methods([axum::http::Method::GET,axum::http::Method::POST,axum::http::Method::DELETE])
            .allow_headers([axum::http::header::AUTHORIZATION,axum::http::header::CONTENT_TYPE,
                "x-file-name".parse().unwrap(),"x-wrapped-key".parse().unwrap()]))
        .layer(TraceLayer::new_for_http()).with_state(state);
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await.unwrap();
    tracing::info!("crypto-service listening on 8080");
    axum::serve(listener,app).await.unwrap();
}
