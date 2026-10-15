FROM rust:1-bookworm AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --locked --release
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates libssl3 && rm -rf /var/lib/apt/lists/* && mkdir /metadata
COPY --from=builder /app/target/release/secureshare-crypto-service /usr/local/bin/crypto-service
EXPOSE 8080
CMD ["crypto-service"]
