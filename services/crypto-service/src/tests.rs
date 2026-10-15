use axum::{body::{Body,Bytes}, http::{Request,StatusCode}, Router};
use http_body_util::BodyExt;
use serde_json::{json,Value};
use tower::ServiceExt;
use crate::{routes,state::AppState};
use std::sync::{Arc,Mutex};
use std::collections::HashMap;

async fn call(app: &Router, method: &str,path: &str,token: Option<&str>,body: Value) -> (StatusCode,Value) {
    let mut req = Request::builder().method(method).uri(path).header("content-type","application/json");
    if let Some(t)=token { req=req.header("authorization",format!("Bearer {t}")); }
    let res=app.clone().oneshot(req.body(Body::from(body.to_string())).unwrap()).await.unwrap();
    let status=res.status();
    let bytes=res.into_body().collect().await.unwrap().to_bytes();
    (status,serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}
async fn register(app:&Router,name:&str)->String {
    let (status,v)=call(app,"POST","/v1/auth/register",None,json!({"username":name,"password":"a".repeat(44),"publicKey":"p".repeat(600),"encryptedPrivateKey":"v".repeat(2500)})).await;
    assert_eq!(status,StatusCode::OK);
    v["token"].as_str().unwrap().to_string()
}
#[tokio::test]
async fn upload_permissions_revocation_and_restart() {
    type Chunks = Arc<Mutex<HashMap<String,Vec<u8>>>>;
    let chunks:Chunks=Arc::new(Mutex::new(HashMap::new()));
    let storage=Router::new().route("/v1/chunks/:id",axum::routing::put(
        |axum::extract::State(c):axum::extract::State<Chunks>,axum::extract::Path(id):axum::extract::Path<String>,body:Bytes|async move {c.lock().unwrap().insert(id,body.to_vec()); StatusCode::CREATED}
    ).get(|axum::extract::State(c):axum::extract::State<Chunks>,axum::extract::Path(id):axum::extract::Path<String>|async move {
        c.lock().unwrap().get(&id).cloned().ok_or(StatusCode::NOT_FOUND)
    }).delete(|axum::extract::State(c):axum::extract::State<Chunks>,axum::extract::Path(id):axum::extract::Path<String>|async move {
        c.lock().unwrap().remove(&id);StatusCode::NO_CONTENT
    })).with_state(chunks);
    let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url=format!("http://{}",listener.local_addr().unwrap());
    let server=tokio::spawn(async move { axum::serve(listener,storage).await.unwrap(); });
    let temp=tempfile::tempdir().unwrap();
    let path=temp.path().join("metadata.db").to_str().unwrap().to_owned();
    let secret="a-test-secret-with-more-than-32-characters".to_string();
    let state=AppState::new(url.clone(),&path,secret.clone());
    let app=routes::router().with_state(state);
    let alice=register(&app,"alice").await;
    let bob=register(&app,"bobby").await;
    let eve=register(&app,"eve").await;
    assert_eq!(call(&app,"GET","/v1/files",None,json!(null)).await.0,StatusCode::UNAUTHORIZED);
    assert_eq!(call(&app,"POST","/v1/auth/register",None,json!({"username":"alice","password":"a".repeat(44),"publicKey":"p".repeat(600),"encryptedPrivateKey":"v".repeat(2500)})).await.0,StatusCode::CONFLICT);
    let encrypted=vec![17u8;2*1024*1024];
    let upload=app.clone().oneshot(Request::builder().method("POST").uri("/v1/files")
        .header("authorization",format!("Bearer {alice}")).header("x-file-name","notes%20%C3%A9.txt")
        .header("x-wrapped-key","k".repeat(512)).body(Body::from(encrypted.clone())).unwrap()).await.unwrap();
    assert_eq!(upload.status(),StatusCode::OK);
    let meta:Value=serde_json::from_slice(&upload.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(meta["name"],"notes é.txt");
    let id=meta["id"].as_str().unwrap();
    let path_file=format!("/v1/files/{id}");
    assert_eq!(call(&app,"GET",&path_file,Some(&bob),json!(null)).await.0,StatusCode::FORBIDDEN);
    assert_eq!(call(&app,"POST",&format!("{path_file}/grant"),Some(&bob),json!({"recipientUserId":"eve","wrappedKey":"e".repeat(512)})).await.0,StatusCode::FORBIDDEN);
    assert_eq!(call(&app,"POST",&format!("{path_file}/grant"),Some(&alice),json!({"recipientUserId":"bobby","wrappedKey":"b".repeat(512)})).await.0,StatusCode::NO_CONTENT);
    let (_,listed)=call(&app,"GET","/v1/files",Some(&bob),json!(null)).await;
    assert_eq!(listed[0]["wrappedKey"],"b".repeat(512));
    assert_eq!(call(&app,"GET",&path_file,Some(&eve),json!(null)).await.0,StatusCode::FORBIDDEN);
    // Reopen metadata through a fresh state and router, like a process restart.
    drop(app);
    let app=routes::router().with_state(AppState::new(url,&path,secret));
    assert_eq!(call(&app,"POST","/v1/auth/login",None,json!({"username":"alice","password":"a".repeat(44)})).await.0,StatusCode::OK);
    let download=app.clone().oneshot(Request::builder().uri(&path_file).header("authorization",format!("Bearer {bob}")).body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(download.status(),StatusCode::OK);
    assert_eq!(&download.into_body().collect().await.unwrap().to_bytes()[..],&encrypted[..]);
    assert_eq!(call(&app,"DELETE",&format!("{path_file}/grants/bobby"),Some(&alice),json!(null)).await.0,StatusCode::NO_CONTENT);
    assert_eq!(call(&app,"GET",&path_file,Some(&bob),json!(null)).await.0,StatusCode::FORBIDDEN);
    assert_eq!(call(&app,"DELETE",&path_file,Some(&bob),json!(null)).await.0,StatusCode::FORBIDDEN);
    assert_eq!(call(&app,"DELETE",&path_file,Some(&alice),json!(null)).await.0,StatusCode::NO_CONTENT);
    assert_eq!(call(&app,"GET","/v1/files",Some(&alice),json!(null)).await.1,json!([]));
    server.abort();
}
#[tokio::test]
async fn storage_failure_does_not_commit_file_metadata() {
    let state=AppState::new("http://127.0.0.1:1".into(),":memory:","test-secret".into());
    let app=routes::router().with_state(state);
    let token=register(&app,"alice").await;
    let res=app.clone().oneshot(Request::builder().method("POST").uri("/v1/files")
        .header("authorization",format!("Bearer {token}")).header("x-file-name","test.txt")
        .header("x-wrapped-key","k".repeat(512)).body(Body::from(vec![0;32])).unwrap()).await.unwrap();
    assert_eq!(res.status(),StatusCode::BAD_GATEWAY);
    assert_eq!(call(&app,"GET","/v1/files",Some(&token),json!(null)).await.1,json!([]));
}
