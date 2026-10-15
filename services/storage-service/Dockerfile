FROM debian:bookworm-slim AS build
RUN apt-get update && apt-get install -y g++ cmake make ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY CMakeLists.txt ./
COPY include ./include
COPY src ./src
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF && cmake --build build

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y libstdc++6 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/build/storage-service /usr/local/bin/storage-service
RUN mkdir -p /data
ENV STORAGE_DATA_DIR=/data
ENV STORAGE_PORT=9000
EXPOSE 9000
CMD ["storage-service"]
