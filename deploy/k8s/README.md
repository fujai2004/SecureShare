# Kubernetes demo

This is a persistent single-replica MVP, using a cluster with a default StorageClass and a CNI that enforces NetworkPolicy. It is not a replicated storage system.

Build and load these image tags into your cluster (or replace them with registry tags):

```sh
docker build -t secureshare/frontend:latest frontend
docker build -t secureshare/crypto-service:latest services/crypto-service
docker build -t secureshare/storage-service:latest services/storage-service
# For kind:
kind load docker-image secureshare/frontend:latest secureshare/crypto-service:latest secureshare/storage-service:latest
kubectl apply -f deploy/k8s/base/namespace.yaml
kubectl -n secureshare-system create secret generic secureshare-secrets --from-literal=jwt-secret=YOUR_RANDOM_SECRET_OF_AT_LEAST_32_CHARACTERS
kubectl apply -k deploy/k8s/base
kubectl -n secureshare-system rollout status deployment/crypto-service
kubectl -n secureshare-system rollout status deployment/storage-service
kubectl -n secureshare-system rollout status deployment/frontend
kubectl -n secureshare-system port-forward service/frontend 5173:80
```

The browser uses the same-origin frontend proxy. Kubernetes internal DNS names are never sent to the browser.

Upload and share a file, restart API/storage pods, wait for rollout, reconnect the port-forward if needed, and verify both users can still log in and authorized downloads match the original bytes.

```sh
kubectl -n secureshare-system rollout restart deployment/crypto-service deployment/storage-service
kubectl -n secureshare-system rollout status deployment/crypto-service
kubectl -n secureshare-system rollout status deployment/storage-service
```

Do not scale replicas: SQLite and the local chunk directory require one writer process each. Persistent volumes retain data across pod restarts, but their availability on node loss depends on the cluster's storage provider. This setup has not established host-failure durability.

The tenant/ directory contains an earlier namespace experiment. It is not an automatic tenant provisioning system and is not needed for this MVP.
