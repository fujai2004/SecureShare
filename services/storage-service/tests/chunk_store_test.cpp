#include "chunk_store.hpp"
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <thread>
#include <vector>
void require(bool ok) { if (!ok) throw std::runtime_error("chunk store invariant failed"); }
int main() {
    auto root = std::filesystem::current_path() / ("secureshare-test-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    {
        secureshare::ChunkStore store(root);
        require(!store.put("../escape","bad"));
        const std::string payload(2 * 1024 * 1024,'x');
        std::vector<std::thread> writers;
        for (int i=0;i<16;i++) writers.emplace_back([&store,&payload,i] { require(store.put("file-"+std::to_string(i),payload)); });
        for (auto& t : writers) t.join();
        require(store.size() == 16);
        require(store.get("file-0") == payload);
        require(!store.put("file-0","replacement"));
        require(store.get("file-0") == payload);
    }
    { secureshare::ChunkStore reopened(root); require(reopened.size()==16); require(reopened.get("file-0")->size()==2*1024*1024); require(reopened.remove("file-0")); require(!reopened.get("file-0")); }
    std::filesystem::remove_all(root);
    std::cout << "concurrent writes, immutable IDs, traversal rejection, restart and deletion passed\n";
}
