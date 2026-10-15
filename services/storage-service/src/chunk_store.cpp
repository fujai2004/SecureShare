#include "chunk_store.hpp"
#include <algorithm>
#include <cctype>
#include <fstream>
namespace secureshare {
namespace {
bool valid(const std::string& id) {
    return !id.empty() && id.size() <= 128 && std::all_of(id.begin(),id.end(),
        [](unsigned char c) { return std::isalnum(c) || c == '-'; });
}
}
ChunkStore::ChunkStore(std::filesystem::path root) : root_(std::move(root)) {
    std::filesystem::create_directories(root_);
    for (const auto& e : std::filesystem::directory_iterator(root_)) {
        if (e.path().extension() == ".chunk") index_[e.path().stem().string()] = e.file_size();
        else if (e.path().extension() == ".tmp") std::filesystem::remove(e.path());
    }
}
std::filesystem::path ChunkStore::path_for(const std::string& id) const { return root_ / (id + ".chunk"); }
bool ChunkStore::put(const std::string& id,const std::string& data) {
    if (!valid(id)) return false;
    std::lock_guard lock(mutex_);
    const auto target = path_for(id);
    if (std::filesystem::exists(target)) return false; // Immutable chunk IDs.
    auto temp = target; temp += ".tmp";
    {
        std::ofstream out(temp,std::ios::binary | std::ios::trunc);
        if (!out) return false;
        out.write(data.data(),static_cast<std::streamsize>(data.size()));
        out.flush();
        if (!out) { out.close(); std::filesystem::remove(temp); return false; }
    }
    std::error_code ec;
    std::filesystem::rename(temp,target,ec);
    if (ec) { std::filesystem::remove(temp); return false; }
    index_[id] = data.size();
    return true;
}
std::optional<std::string> ChunkStore::get(const std::string& id) const {
    if (!valid(id)) return std::nullopt;
    std::lock_guard lock(mutex_);
    std::ifstream in(path_for(id),std::ios::binary);
    if (!in) return std::nullopt;
    return std::string{std::istreambuf_iterator<char>(in), {}};
}
bool ChunkStore::remove(const std::string& id) {
    if (!valid(id)) return false;
    std::lock_guard lock(mutex_);
    std::error_code ec;
    bool ok = std::filesystem::remove(path_for(id),ec);
    if (ok) index_.erase(id);
    return ok;
}
std::size_t ChunkStore::size() const { std::lock_guard lock(mutex_); return index_.size(); }
}
