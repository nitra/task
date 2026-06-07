# k8s — Teleport deployment

Доступ розробників до dev pods через [Teleport](https://goteleport.com) — identity-aware SSH proxy.
Розробник не має прямого доступу до kubectl або k8s API; бекенд `nitra/task` спавнить dev pods і контролює доступ.

## Архітектура

```
Developer (Zed / VS Code / Cursor)
        │
        │ SSH (tsh ProxyCommand)
        ▼
Teleport Proxy  ←──── Teleport Auth (GitHub SSO, RBAC)
        │
        ▼
Dev Pod (workspace + teleport-node sidecar)
        │
        └── /tasks  ←── tasks-pvc (той самий PVC що у worker pods)
```

## Структура

```
k8s/
  namespace.yaml              — namespace teleport
  teleport/
    configmap.yaml            — teleport.yaml конфіг + GitHub connector шаблон
    deployment.yaml           — Auth + Proxy в одному поді (SQLite backend)
    service.yaml              — web (ClusterIP), ssh (LoadBalancer), auth (ClusterIP)
    ingress.yaml              — HTTPS ingress з SSL passthrough
    pvc.yaml                  — 10Gi storage для Teleport даних
    rbac.yaml                 — ServiceAccount + ClusterRole для Teleport
    roles.yaml                — Teleport RBAC ролі (developer, admin)
  dev-pod/
    template.yaml             — шаблон Pod що бекенд застосовує on demand
    rbac.yaml                 — SA для dev pods + SA для task-backend API
```

## Передумови

- k8s кластер з nginx ingress controller
- DNS запис `teleport.nitra.com` → LoadBalancer IP
- DNS запис `*.teleport.nitra.com` → той самий IP (для ACME wildcard або node subdomains)
- GitHub OAuth App у nitralabs org (Client ID + Secret)
- PVC `tasks-pvc` вже існує (монтується у dev pods і worker pods)

## Розгортання

### 1. Namespace і базові ресурси

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/teleport/pvc.yaml
kubectl apply -f k8s/teleport/rbac.yaml
kubectl apply -f k8s/teleport/configmap.yaml
kubectl apply -f k8s/teleport/service.yaml
kubectl apply -f k8s/teleport/ingress.yaml
kubectl apply -f k8s/dev-pod/rbac.yaml
```

### 2. GitHub OAuth credentials

```bash
kubectl create secret generic teleport-github \
  --namespace teleport \
  --from-literal=client_id=<GITHUB_CLIENT_ID> \
  --from-literal=client_secret=<GITHUB_CLIENT_SECRET>
```

### 3. Запуск Teleport

```bash
kubectl apply -f k8s/teleport/deployment.yaml
kubectl rollout status deployment/teleport -n teleport
```

### 4. Перший адмін (одноразово)

```bash
# Зайти у под
kubectl exec -it -n teleport deploy/teleport -- bash

# Створити першого адміна
tctl users add vitaliytv --roles=admin --logins=dev

# Застосувати RBAC ролі
tctl create -f /etc/teleport/roles.yaml
```

### 5. GitHub SSO connector

Замінити `GITHUB_CLIENT_ID` і `GITHUB_CLIENT_SECRET` у `teleport/configmap.yaml`
або застосувати через tctl:

```bash
kubectl exec -it -n teleport deploy/teleport -- \
  tctl create -f /etc/teleport/github-connector.yaml
```

## Підключення розробника (одноразово)

```bash
# Встановити tsh
brew install teleport

# Логін через GitHub SSO
tsh login --proxy=teleport.nitra.com

# Додати до ~/.ssh/config
cat >> ~/.ssh/config <<'EOF'
Host *.teleport.nitra.com
  ProxyCommand tsh proxy ssh --cluster=nitra %h:%p
  User dev
EOF
```

Після цього Zed, VS Code, Cursor підключаються до dev pod через стандартний SSH.

## Dev pod lifecycle

Бекенд `nitra/task` керує dev pods:

| Подія | Дія |
|---|---|
| Розробник натискає "Open in Editor" | `kubectl apply` dev pod з template.yaml |
| Pod Ready | Teleport node-agent реєструється автоматично |
| SSH-сесія закрита | grace period 30 хвилин |
| Timeout без активності | `kubectl delete pod dev-<task-id>` |
| Task node → `resolved` | UI попередження → auto-delete |
| Максимальний час | `activeDeadlineSeconds: 28800` (8 год) |

## Оновлення Teleport

```bash
# Змінити image tag у deployment.yaml, потім:
kubectl rollout restart deployment/teleport -n teleport
```

SQLite backend: downtime ~30с під час рестарту. Для zero-downtime перейти на PostgreSQL/etcd.
