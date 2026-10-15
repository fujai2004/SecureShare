use reqwest::Client;

#[derive(Clone)]
pub struct StorageClient {
    base_url: String,
    http: Client,
}

impl StorageClient {
    pub fn new(base_url: String) -> Self {
        Self {
            base_url,
            http: Client::builder().timeout(std::time::Duration::from_secs(30)).build().expect("HTTP client"),
        }
    }

    pub async fn put_chunk(&self, file_id: &str, data: &[u8]) -> Result<(), reqwest::Error> {
        let url = format!("{}/v1/chunks/{}", self.base_url, file_id);
        self.http.put(url).body(data.to_vec()).send().await?.error_for_status()?;
        Ok(())
    }

    pub async fn get_chunk(&self, file_id: &str) -> Result<Vec<u8>, reqwest::Error> {
        let url = format!("{}/v1/chunks/{}", self.base_url, file_id);
        let res = self.http.get(url).send().await?.error_for_status()?;
        Ok(res.bytes().await?.to_vec())
    }

    pub async fn delete_chunk(&self, file_id: &str) -> Result<(), reqwest::Error> {
        let url = format!("{}/v1/chunks/{}", self.base_url, file_id);
        self.http.delete(url).send().await?.error_for_status()?;
        Ok(())
    }
}
