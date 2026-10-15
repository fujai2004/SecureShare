#include "chunk_store.hpp"
#include "http_server.hpp"

#include <cstdlib>
#include <algorithm>
#include <cctype>
#include <iostream>
#include <sstream>
#include <string>
#include <string_view>

namespace {

std::string http_response(int status, std::string_view status_text, const std::string& body,
                          const char* content_type = "text/plain") {
    std::ostringstream out;
    out << "HTTP/1.1 " << status << ' ' << status_text << "\r\n"
        << "Content-Type: " << content_type << "\r\n"
        << "Content-Length: " << body.size() << "\r\n"
        << "Connection: close\r\n\r\n"
        << body;
    return out.str();
}

std::string chunk_id_from_path(const std::string& path) {
    constexpr std::string_view prefix = "/v1/chunks/";
    if (path.rfind(prefix, 0) != 0) return {};
    return path.substr(prefix.size());
}

}  // namespace

int main() {
    const char* data_dir = std::getenv("STORAGE_DATA_DIR");
    const std::string root = data_dir ? data_dir : "/data";
    secureshare::ChunkStore store(root);

    const char* port_env = std::getenv("STORAGE_PORT");
    const int port = port_env ? std::stoi(port_env) : 9000;

    secureshare::HttpServer server(
        port, [&store](const std::string& method, const std::string& path, const std::string& body) {
            if (path == "/health") {
                return http_response(200, "OK", "ok");
            }

            const std::string id = chunk_id_from_path(path);
            if (id.empty() || id.size() > 128 || !std::all_of(id.begin(), id.end(), [](unsigned char c) { return std::isalnum(c) || c == '-'; })) {
                return http_response(404, "Not Found", "not found");
            }

            if (method == "PUT") {
                if (!store.put(id, body)) {
                    if (store.get(id)) return http_response(409, "Conflict", "chunk already exists");
                    return http_response(500, "Internal Server Error", "write failed");
                }
                return http_response(201, "Created", "");
            }

            if (method == "GET") {
                const auto data = store.get(id);
                if (!data) {
                    return http_response(404, "Not Found", "missing chunk");
                }
                return http_response(200, "OK", *data, "application/octet-stream");
            }

            if (method == "DELETE") {
                if (!store.remove(id)) {
                    return http_response(404, "Not Found", "missing chunk");
                }
                return http_response(204, "No Content", "");
            }

            return http_response(405, "Method Not Allowed", "method not allowed");
        });

    server.run();
    return 0;
}
