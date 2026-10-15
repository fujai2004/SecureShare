#include "http_server.hpp"
#include "httplib.h"
#include <stdexcept>
namespace secureshare {
HttpServer::HttpServer(int port, HttpHandler handler) : port_(port), handler_(std::move(handler)) {}
void HttpServer::run() {
    httplib::Server server;
    server.new_task_queue = [] { return new httplib::ThreadPool(8, 128); };
    server.set_payload_max_length(25 * 1024 * 1024 + 64);
    server.set_read_timeout(10, 0);
    server.set_write_timeout(10, 0);
    auto dispatch = [this](const httplib::Request& req, httplib::Response& res) {
        // The parser invokes this only after receiving the complete declared body.
        const auto raw = handler_(req.method, req.path, req.body);
        const auto split = raw.find("\r\n\r\n");
        const auto first_space = raw.find(' ');
        res.status = std::stoi(raw.substr(first_space + 1, 3));
        res.set_content(raw.substr(split + 4), req.method == "GET" && req.path != "/health"
            ? "application/octet-stream" : "text/plain");
    };
    server.Get("/health", dispatch);
    server.Get(R"(/v1/chunks/.*)", dispatch);
    server.Put(R"(/v1/chunks/.*)", dispatch);
    server.Delete(R"(/v1/chunks/.*)", dispatch);
    if (!server.listen("0.0.0.0", port_)) throw std::runtime_error("storage listen failed");
}
void HttpServer::stop() {}
}
