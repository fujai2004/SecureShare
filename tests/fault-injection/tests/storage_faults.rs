use tokio::io::AsyncWriteExt;
use uuid::Uuid;
fn base() -> String { std::env::var("STORAGE_URL").unwrap_or_else(|_| "http://127.0.0.1:9000".into()) }
#[tokio::test]
async fn concurrent_unique_uploads_round_trip_large_binary_payloads() {
    let client = reqwest::Client::new();
    client.get(format!("{}/health",base())).send().await.expect("start storage-service before these tests").error_for_status().unwrap();
    let mut tasks=Vec::new();
    for n in 0..16u8 {
        let c=client.clone();
        tasks.push(tokio::spawn(async move {
            let url=format!("{}/v1/chunks/{}",base(),Uuid::new_v4());
            let data=vec![n;256*1024];
            assert_eq!(c.put(&url).body(data.clone()).send().await.unwrap().status(),201);
            assert_eq!(c.get(&url).send().await.unwrap().bytes().await.unwrap().as_ref(),&data);
            assert_eq!(c.put(&url).body("replacement").send().await.unwrap().status(),409);
            assert_eq!(c.get(&url).send().await.unwrap().bytes().await.unwrap().as_ref(),&data);
            c.delete(url).send().await.unwrap().error_for_status().unwrap();
        }));
    }
    for task in tasks {task.await.unwrap();}
}
#[tokio::test]
async fn disconnected_writer_never_commits_partial_chunk() {
    let url=reqwest::Url::parse(&base()).unwrap();
    let id=Uuid::new_v4();
    let mut stream=tokio::net::TcpStream::connect((url.host_str().unwrap(),url.port_or_known_default().unwrap())).await.unwrap();
    stream.write_all(format!("PUT /v1/chunks/{id} HTTP/1.1\r\nHost: localhost\r\nContent-Length: 1048576\r\n\r\npartial").as_bytes()).await.unwrap();
    stream.shutdown().await.unwrap();
    drop(stream);
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert_eq!(reqwest::get(format!("{}/v1/chunks/{id}",base())).await.unwrap().status(),404);
}
