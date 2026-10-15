#pragma once
#include <functional>
#include <string>
namespace secureshare {
using HttpHandler = std::function<std::string(const std::string&,const std::string&,const std::string&)>;
class HttpServer {
public:
    HttpServer(int port, HttpHandler handler);
    void run();
private:
    int port_;
    HttpHandler handler_;
};
}
