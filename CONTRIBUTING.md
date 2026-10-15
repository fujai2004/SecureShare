# Contributing
Read README.md and docs/architecture.md before changing encryption, permission or persistence behavior.
Copy .env.example to .env, choose a local JWT secret and run docker compose up --build.
Use npm test and npm run build in frontend; npm run format formats TypeScript.
Run cargo fmt --check, cargo clippy --all-targets -- -D warnings and cargo test in services/crypto-service.
Build storage with CMake and run CTest. C++20 native builds work on Windows with Visual Studio 2022 and on Linux; the HTTP library is fetched by CMake.
Run the full-stack and fault checks from the README when changing service boundaries. Fault tests require a running storage service and fail if it is unavailable.
Source files are UTF-8. Do not commit secrets, local data, dependencies or build output.
Keep changes focused. Describe their purpose and the checks actually run.
Kubernetes secrets are created outside source control; see deploy/k8s/README.md. Deployment and node-failure claims require real cluster validation.
