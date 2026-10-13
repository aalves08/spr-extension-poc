# Phase 2: "Install SPR" wizard and in-cluster gateway

Status: **design, not started**. Phase 2 starts only when Phase 1 is declared complete.
Scope and decisions: [SPR-EXTENSION-PLAN.md](SPR-EXTENSION-PLAN.md) (D10 to D12). Research done on 2026-10-09.

Labels used below:
- **Verified**: seen in source code or SUSE docs (file or URL given).
- **Inferred**: reasoned from code or docs, not tested.
- **Upstream**: seen in upstream Harbor (`goharbor/harbor-helm` v1.19.2 = Harbor 2.15.2 = SPR 1.2.x), not checked in the SPR chart.
- **Unknown**: needs the SPR chart (see [Open questions](#11-open-questions-and-spikes)).

---

## 1. Goal

Installing SPR today needs a default StorageClass, an ingress controller, a hostname with DNS, a TLS certificate that Rancher trusts, an image pull secret, a proxy allow-list entry, and SPR credentials typed into the extension.

Goal: on a Rancher-provisioned RKE2/K3s cluster, the user enters **only their SCC credentials** and picks a cluster. The extension does everything else and saves the connection itself.

## 2. Decisions

| # | Decision | Notes |
|---|---|---|
| D10 | Phase 2 includes an **"Install SPR" wizard** | Phase 1 stays read-only. The wizard also covers "Connect" for installs found by discovery |
| D11 | The extension deploys a small **gateway** next to SPR | Lets the extension reach SPR through Rancher's cluster proxy: no ingress, DNS, trusted certificate or `ProxyEndpoint` entry needed for the extension. SPRs outside Rancher-managed clusters keep `/meta/proxy` |
| D12 | The extension **creates its own CA** and server certificate | No cert-manager dependency (cert-manager is only in SUSE Application Collection, which needs separate credentials). The chart's `certSource: auto` is not used (see 6.2) |

## 3. Wizard flow

| # | Step | What the extension does | User input |
|---|---|---|---|
| 1 | Pre-flight | Reads the target cluster and shows green/amber/red per check (section 4) | Picks the cluster |
| 2 | Storage | K3s: `local-path` is already default. Classes exist but none default: offer to mark one default. No classes: offer SUSE Storage (Longhorn) from Rancher's built-in charts, or stop | Confirms |
| 3 | Chart repo | Creates a basic-auth Secret and an OCI `ClusterRepo` in the target cluster, hidden from the Apps list (section 7.1) | SCC username and token (once) |
| 4 | Namespace and pull secret | Creates the namespace, then a `dockerconfigjson` Secret for `registry.suse.com` from the same SCC credentials (section 7.2) | None |
| 5 | Hostname | Defaults to `spr.<ip-with-dashes>.<ingress-ip-domain>` (section 5.2) | Can override; must in air-gapped sites |
| 6 | Certificate | Creates CA and server cert, stores them as Secrets (section 6) | None |
| 7 | Install | Installs the chart with hostname, `externalURL`, ingress class, size preset, cert Secret and pull secret, then shows the operation log (section 7.3) | Size preset (evaluation / production) |
| 8 | Gateway | Deploys the gateway Deployment and Service (section 8) | None |
| 9 | Connection | Reads the generated admin password, creates a read-only robot account through the gateway, saves the connection (section 9) | None |
| 10 | Optional: pull from SPR | Rancher-provisioned clusters only: adds the CA to `spec.rkeConfig.registries` so nodes trust SPR (section 6.3) | Confirms; **restarts every node, one at a time** |

Optional extra in step 7: on RKE2 ≥ 1.36 / K3s (Traefik), offer to raise Traefik's 60s read timeout so large pushes don't fail (section 5.1). This is a cluster-wide change, so ask.

The same steps 8 and 9 give a no-typing **"Connect"** for installs found by "Detect SPR installations", provided the user can read the admin Secret.

## 4. Pre-flight checks

All read-only, through `/k8s/clusters/<id>/v1/...`.

| Check | How | Pass / warn |
|---|---|---|
| Kubernetes version | Cluster version | 1.33 to 1.35 supported by SPR docs. Warn outside that range |
| Nodes | Node list: count, `status.allocatable` CPU / memory | 3+ workers with 4 vCPU / 16 GiB (production preset). Warn only |
| Default StorageClass | `storage.k8s.io.storageclasses`, annotation `storageclass.kubernetes.io/is-default-class: "true"` (also the legacy `storageclass.beta.kubernetes.io/...`) | See step 2 |
| Ingress controller | Section 5.1 | Warn if none |
| Provisioned by Rancher | `provisioning.cattle.io.clusters` in `fleet-default` with `spec.rkeConfig` | Imported/hosted: node trust (step 10) unavailable |
| Permissions | `canCreate` on clusterrepo, secret, namespace schemas in the target cluster | Hide the wizard or explain what's missing |
| Rancher version | ≥ 2.9 for OCI repos (already covered by our ≥ 2.15 target) | |

## 5. Cluster facts

### 5.1 Ingress controllers (verified, late 2026)

| Distro | Controller | IngressClass | Default class? | Ingress `status.loadBalancer` |
|---|---|---|---|---|
| RKE2 ≤ 1.35, and clusters upgraded to 1.36 | `rke2-ingress-nginx` DaemonSet, hostPort 80/443 | `nginx` | No annotation, but watches class-less Ingresses (`--watch-ingress-without-class`) | Node IPs (inferred) |
| New RKE2 ≥ 1.36 | `rke2-traefik` DaemonSet, hostPort, ClusterIP Service | `traefik` | Yes | **Empty**: use node IPs |
| K3s | `traefik` Deployment + ServiceLB | `traefik` | Yes | Node IPs |

- RKE2 1.36 makes Traefik the default for new clusters. 1.37 removes ingress-nginx. Rancher 2.15 defaults new clusters to 1.36.
- Detection order: IngressClass with the default annotation; else the only IngressClass; else `helm.cattle.io` HelmCharts in `kube-system` (`rke2-ingress-nginx`, `rke2-traefik`, `traefik`, value `global.systemDefaultIngressClass`); ignore `rke2-ingress-nginx-migration`.
- **Always set `expose.ingress.className` explicitly** (upstream value; unknown whether SPR kept it).
- Traefik ignores the chart's `nginx.ingress.kubernetes.io/*` annotations. Body size is unlimited in Traefik anyway.
- **Traefik `readTimeout` defaults to 60s**, which cuts off slow large pushes. Fix with a `HelmChartConfig` named `rke2-traefik` (K3s: `traefik`) in `kube-system` setting `ports.websecure.transport.respondingTimeouts.readTimeout` (key path inferred from chart values).
- Imported / EKS / AKS / GKE: often no controller, or a cloud class.

Sources: [RKE2 networking services](https://docs.rke2.io/networking/networking_services), [RKE2 ingress migration](https://docs.rke2.io/reference/ingress_migration), [rke2#10037](https://github.com/rancher/rke2/pull/10037), [K3s traefik manifest](https://github.com/k3s-io/k3s/blob/master/manifests/traefik.yaml), [Rancher v2.15.2 notes](https://github.com/rancher/rancher/releases/tag/v2.15.2).

### 5.2 Hostname without DNS

- Rancher has a global setting **`ingress-ip-domain`**, default `sslip.io` (`pkg/settings/setting.go`, verified). Admins can point it at their own wildcard DNS, so read it instead of hard-coding sslip.io.
- sslip.io and nip.io are the same service now. Use **dashes**: `spr.10-0-0-5.sslip.io` (required for IPv6).
- Finding the IP: Ingress or controller Service `status.loadBalancer.ingress[].ip`; for hostPort DaemonSets, the nodes running the controller pods, `status.addresses` ExternalIP then InternalIP. Prefer a load balancer or VIP IP; a single node IP is a single point of failure.
- Don't rely on Rancher's `ingresshostgen` controller, which rewrites Ingress hosts equal to the domain. It would drift from Helm and break `externalURL` and the certificate.
- Needs public DNS resolution from browsers, Rancher and nodes. Some resolvers block answers with private IPs (DNS-rebinding protection).

### 5.3 Storage

- K3s ships `local-path` as default. RKE2 ships no StorageClass.
- **Retroactive default assignment is GA since Kubernetes 1.28** (verified): PVCs without `storageClassName` bind once a default class exists. The Harbor chart omits `storageClassName` when the value is empty, so storage can be fixed after install.
- SUSE Storage (Longhorn) is in rancher/charts (`longhorn` 109.4.0+up1.12.1 on release-v2.14/2.15). Node prerequisites: open-iscsi with `iscsid` running, NFSv4 client, cryptsetup, dmsetup and more. `longhornctl check|install preflight` automates most of it.
- `local-path-provisioner` is in SUSE Application Collection (needs Application Collection credentials). Node-local, so evaluation only.
- **Volume sizes must be right at install.** The database, Valkey and Trivy volumes come from StatefulSet templates, which can't change. `storageClass` and `accessMode` are documented as immutable.
- S3 for image data is supported and recommended by SPR for production, but database, Valkey and Trivy still need PVCs. Offer "bring your own S3" as an advanced option only. MinIO upstream is archived; Application Collection has a MinIO build.

Sources: [K8s retroactive default StorageClass](https://kubernetes.io/blog/2023/08/18/retroactive-default-storage-class-ga/), [Longhorn install](https://longhorn.io/docs/latest/deploy/install/).

## 6. Certificates (D12)

### 6.1 Generation

- The shell already depends on **`jsrsasign` 11.1.1** (`@rancher/shell/package.json`, used in `models/secret.js`). Use it to build the X.509 certificates. Generate keys with WebCrypto (ECDSA P-256 is fast in the browser) or jsrsasign. Choice to confirm in a spike.
- Create:
  - a CA (long validity, for example 10 years), stored in Secret `<release>-spr-ca` (keys `ca.crt`, `ca.key`) in the SPR namespace;
  - a server certificate signed by that CA, SAN = the hostname (and the IP if an IP is used), stored as a `kubernetes.io/tls` Secret with `tls.crt`, `tls.key` and `ca.crt`.
- Chart values: `expose.tls.certSource: secret`, `expose.tls.secret.secretName: <tls secret>`. Optionally `caSecretName` so SPR serves the CA at `GET /api/v2.0/systeminfo/getcert` (upstream; only when `externalURL` is https).
- Offer the CA as a download in the extension, for browsers and `docker` on developer machines.
- Re-issuing (hostname change, expiry) reuses the stored CA, so node trust doesn't break.

### 6.2 Why not `certSource: auto`

Upstream `templates/ingress/secret.yaml` calls `genCA "harbor-ca" 365` on every render without a `lookup`. So **every `helm upgrade` creates a new CA**, which breaks node trust, and the certificate expires after 365 days. Not yet checked in the SPR chart.

### 6.3 Node trust (Rancher-provisioned clusters only)

Verified in `rancher/rancher` `pkg/apis/rke.cattle.io/v1/cluster_configuration_types.go` and `pkg/capr/planner`:

- `provisioning.cattle.io/v1 Cluster` → `spec.rkeConfig.registries.configs["<host[:port]>"]`:
  - `caBundle`: `[]byte`, so base64-encoded PEM
  - `tlsSecretName` (type `kubernetes.io/tls`), `authConfigSecretName`, `insecureSkipVerify`
- `spec.rkeConfig.registries.mirrors["<registry>"].endpoint` / `.rewrite`.
- Referenced Secrets live in **`fleet-default` on the Rancher local cluster**. Add label `fleet.cattle.io/managed=true` so Rancher Backups includes them.
- **Any change restarts rke2/k3s on every node** (registries files are hashed into `RESTART_STAMP` and `DRAIN_HASH`), following `upgradeStrategy`, draining if enabled.
- Imported clusters: not possible (Rancher doesn't manage their node config). Manual `/etc/rancher/{rke2,k3s}/registries.yaml` on every node.
- Needs update rights on the provisioning Cluster and create rights on Secrets in `fleet-default`.

Not chosen: node-wide `registry.suse.com` credentials via `authConfigSecretName`. That would let every workload on every node pull with the SCC credentials. We use a namespaced pull secret instead.

## 7. Rancher APIs for install (verified in `@rancher/shell` 3.0.13 and rancher/rancher)

Key rule: a `ClusterRepo` exists **per cluster**. For a downstream install, the auth Secret, the `ClusterRepo` and the install call all go to `/k8s/clusters/<downstreamId>/v1/...`. The `cluster/*` store only targets the current cluster, so use `management/request` with explicit URLs.

### 7.1 OCI ClusterRepo

Rancher ≥ 2.9. Basic auth only, charts ≤ 20 MB.

```http
POST /k8s/clusters/<id>/v1/secrets
{ "type": "secret", "_type": "kubernetes.io/basic-auth",
  "metadata": { "generateName": "clusterrepo-auth-", "namespace": "cattle-system" },
  "data": { "username": "<b64>", "password": "<b64>" } }

POST /k8s/clusters/<id>/v1/catalog.cattle.io.clusterrepos
{ "type": "catalog.cattle.io.clusterrepo",
  "metadata": { "name": "suse-private-registry",
                "annotations": { "clusterrepo.cattle.io/hidden": "true" } },
  "spec": { "url": "oci://registry.suse.com/private-registry/1.2/private-registry-helm",
            "insecurePlainHttp": false,
            "clientSecret": { "namespace": "cattle-system", "name": "clusterrepo-auth-xxxxx" } } }
```

- Wait for `metadata.state.name === 'active'`, then load the index (`catalog/loadRepo`).
- Dashboard references: `edit/catalog.cattle.io.clusterrepo.vue:158-189`, `components/form/SelectOrCreateAuthSecret.vue:636-751`, `models/catalog.cattle.io.clusterrepo.js:62-80, 110-116, 173`.
- Not checked: whether rancher-webhook restricts `clientSecret.namespace`.

### 7.2 Namespace and pull secret

- Rancher only injects pull secrets for the `rancher-charts` repo (`helmop/pull_secrets.go:42`), so create it ourselves.
- Create the namespace first (`install.vue:1205-1227` does the same), then the Secret:
  `kubernetes.io/dockerconfigjson`, `.dockerconfigjson = {"auths":{"registry.suse.com":{"username":...,"password":...}}}`. Template: `install.vue:1601-1642` (App Collection flow).
- SPR docs name it `suse-registry`. Values: `imagePullSecrets` and `global.imagePullSecrets` both exist in SPR (verified in docs). Exact default: unknown.
- SPR's Rancher UI guide says to create an **HTTP Basic Auth** Secret named `suse-registry`. Kubelet can't use that type as a pull secret (inferred). Use `dockerconfigjson`.

### 7.3 Install

```http
POST /k8s/clusters/<id>/v1/catalog.cattle.io.clusterrepos/suse-private-registry?action=install
{
  "charts": [{
    "chartName": "suse-private-registry",
    "version": "<chart version>",
    "releaseName": "spr",
    "annotations": {
      "catalog.cattle.io/ui-source-repo-type": "cluster",
      "catalog.cattle.io/ui-source-repo": "suse-private-registry"
    },
    "values": { /* only values that differ from chart defaults */ }
  }],
  "namespace": "spr",
  "projectId": "<cluster>/<project>",
  "wait": true,
  "timeout": "600s",
  "noHooks": false,
  "disableOpenAPIValidation": false
}
```

- Body built in `install.vue:1416-1557`, defaults at 62-72. Backend schema: `pkg/api/steve/catalog/types/rest.go`.
- **Keep the two `ui-source-repo*` annotations**: uninstall and the Apps UI use them to find the repo again.
- Response `{ operationName, operationNamespace }`. Track with `repo.waitForOperation(id)`, then the `catalog.cattle.io.operation`, `waitForLink('logs')`, `openLogs()`. For completion, watch `catalog.cattle.io.apps/<ns>/<release>` until `spec.info.status` is `deployed` or `failed` (inferred).
- Chart info (values, questions, readme): `GET .../clusterrepos/<repo>?link=info&chartName=<n>&version=<v>`, wrapped by `catalog/getVersionInfo`.
- No install without a `ClusterRepo` (verified).
- No shell `installChart` helper exists. Copy `actionInput`, `addGlobalValuesTo` and `finish` from `install.vue`. Shortcut alternative: route to the stock wizard `c-cluster-apps-charts-install` with `repo`, `repo-type=cluster`, `chart`, `version`, `namespace`, `name`.

### 7.4 Upgrade (hostname or certificate change later)

- `action=upgrade`, same shape plus `force`, `historyMax`, `cleanupOnFail`, per-chart `resetValues`.
- Rancher runs `helm upgrade --install` without `--reuse-values`. With non-empty values, Helm **replaces** the previous user values.
- **So always send the full set of user values**, merged with the change. The dashboard does: load existing values, strip `global.cattle.*`, merge onto new chart defaults, send `diff(defaults, merged)` (`install.vue:325-349`).
- Current user values live on the Helm release Secret, not the App CR: `app.fetchValues(true)` → `secret.data.release.config` (`models/catalog.cattle.io.app.js:391-481`). `spec.values` on the App is not filled in (`pkg/catalogv2/helm/helm4.go:41-122`).

### 7.5 Permissions

- Helm runs in a pod impersonating the user, so the user's own RBAC applies to everything the chart creates.
- Needs: `create` clusterrepos (cluster-scoped), `create` secrets in `cattle-system`, `create` namespaces (or an existing namespace in their project), plus every resource the SPR chart renders. In practice: Cluster Owner.
- The dashboard doesn't pre-check install rights. Gate our UI on `canCreate` for the clusterrepo, secret and namespace schemas.

## 8. Gateway (D11)

### 8.1 Why it's needed

Rancher's cluster proxy can't carry Harbor's Basic auth (verified):
- Rancher reads `Authorization` **before** the `R_SESS` cookie (`pkg/auth/tokens/token_util.go:64-94`) and treats `Basic` as a Rancher API key → 401.
- If a request gets through, Rancher overwrites `Authorization` with its impersonation token (`pkg/clusterrouter/proxy/proxy_server.go:259-301`) and kube-apiserver deletes it after authenticating (`apiserver/pkg/endpoints/filters/authentication.go:89-90`).
- Harbor has no other header for Basic auth (`src/server/middleware/security/security.go:30-39`). Session cookies don't work for robot accounts or OIDC users.

Kube-apiserver's service proxy does **not** verify backend TLS (`pkg/controlplane/apiserver/config.go:433-442`, `InsecureSkipVerify: true`). Precedent for the route: Monitoring (Grafana, Alertmanager), Longhorn, NeuVector, Kiali (`@rancher/shell` `models/service.js:232-256`, `utils/grafana.js`).

### 8.2 Design

- Deployment + ClusterIP Service in the SPR namespace, for example `spr-gateway` on port 8080. No Ingress.
- nginx config (sketch):

  ```nginx
  server {
    listen 8080;
    location / {
      proxy_pass http://<core service>:80;               # upstream: <release>-harbor-core; confirm in SPR chart
      proxy_set_header Authorization $http_x_harbor_authorization;
      proxy_set_header X-Harbor-Authorization "";
      proxy_set_header Cookie "";                       # drop Rancher's R_SESS
    }
  }
  ```

- Extension URL: `/k8s/clusters/<id>/api/v1/namespaces/<ns>/services/http:spr-gateway:8080/proxy/api/v2.0/...` with header `X-Harbor-Authorization: Basic <standard base64>`.
- The gateway **must not inject credentials** itself. Otherwise any pod in the cluster, and anyone with `services/proxy` there, gets registry access.
- Credentials therefore come from the connection Secret, read by the browser. This is no weaker than today: `/meta/proxy` signing already requires `get` on that Secret, which also lets the user read it through Steve.
- Image: SUSE BCI nginx from `registry.suse.com` (inferred public, to confirm). Small resource requests.
- Connection model: add `transport: gateway` plus cluster, namespace, service, port to the connection Secret annotations. `/meta/proxy` stays for external SPRs.

### 8.3 Behaviour through the proxy (verified)

- Verb follows HTTP method (GET = `get`, POST = `create`, ...) on resource `services/proxy`. Rancher impersonates the user downstream.
- Non-owners need a role like Rancher's "View Monitoring": `services/proxy` `get`/`create` with `resourceNames: ["http:spr-gateway:8080"]` (`pkg/data/management/role_data.go:365-379`). Ties into the deferred RBAC decision (D8).
- `proxy` is long-running, so no 60s timeout. Methods GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS.
- `Location` headers and HTML bodies are rewritten; JSON isn't. **Harbor's `Link` pagination header is not rewritten**: build page URLs ourselves (we already page by `page`/`page_size`). `X-Total-Count` is kept.
- Empty path redirects to a trailing slash.
- The SPR web portal can't be embedded this way (absolute `/api` paths). API only.
- Inferred: needs the apiserver to reach the pod network (some managed/CNI setups can't).
- To test: Harbor's double-encoded repo names (`%252F`) through this path.

## 9. Automatic connection

- Admin password: generated if `harborAdminPassword` is not set (SPR 1.1.2 release notes, CVE-2026-4404). Stored in Secret `<release>-harbor-core`, key `HARBOR_ADMIN_PASSWORD` (from install NOTES; the Velero doc says `<release>-core`, so confirm). `existingSecretAdminPassword` exists upstream.
- Through the gateway, with the admin credentials once: create a **system robot account** with read permissions on all projects (`POST /api/v2.0/robots`, level `system`, namespace `*`). Exact permission list to confirm.
- Robot secrets are alphanumeric, so they never hit the Rancher base64 issue (section 10).
- Save the connection with the robot credentials. Don't store the admin password.
- Robot accounts can't be created through chart values (none in docs or upstream).

## 10. Findings from this research that affect Phase 1

Fixed in Phase 1 (`spr-phase1-fixes.patch`, 2026-10-09):
- **Chart name**: Rancher shows the chart as `suse-private-registry` (`Chart.yaml` name per SPR air-gap docs, `install-airgap-environment.adoc:241`). Discovery now matches both `suse-private-registry` and `private-registry-helm`.
- **Base64 signing bug**: Rancher's `/meta/proxy` `basic` signer uses `base64.URLEncoding` (`rancher/rancher` `pkg/httpproxy/sign.go:50`, verified). Harbor decodes with standard base64. Credentials whose standard encoding contains `+` or `/` (passwords with characters like `?`, `>`, `~`) get a 401 once saved, while "Test connection" with the typed password passes. The form now blocks saving such credentials. Worth reporting upstream to rancher/rancher.
- Discovery no longer reads `externalURL` from chart defaults (placeholder `https://core.harbor.domain`).

Other notes:
- From SPR 1.2, the OCI path includes the version: `oci://registry.suse.com/private-registry/<app version>/private-registry-helm`.
- `/meta/proxy` honours Rancher's `additionalTrustedCAs` (`tls-ca-additional` Secret, mounted and trusted at startup; needs a Rancher restart). `ProxyEndpoint` has no per-endpoint CA or insecure flag.
- Basic-auth API calls work on any Host (no Host check, CSRF skipped without a session; upstream code, not run).

## 11. Open questions and spikes

Needs the SPR chart (`helm registry login registry.suse.com`, then `helm pull oci://registry.suse.com/private-registry/1.2/private-registry-helm --untar`):
1. Default of `imagePullSecrets` / `global.imagePullSecrets`.
2. Whether `certSource: auto` regenerates the CA on upgrade.
3. Whether `expose.ingress.className`, `existingSecretAdminPassword` and `expose.tls.caSecretName` exist.
4. Core service name and port, and the admin password Secret name.
5. Whether the chart ships `questions.yaml` or `catalog.cattle.io/*` annotations.

Other spikes:
6. Gateway image: public BCI nginx tag, size, FIPS variant.
7. Certificate generation: jsrsasign vs WebCrypto keys; bundle size impact.
8. Robot account permission list for read-only access to all projects.
9. Double-encoded repository names through the service proxy.
10. rancher-webhook validation of `ClusterRepo` `clientSecret`.
11. Behaviour for SPR in the Rancher local cluster (dashboard builds no `/k8s/clusters/local` prefix for Grafana; check our URL builder).

## 12. What stays manual

- SCC credentials, once.
- Imported or hosted clusters: node trust for pulling images; maybe an ingress controller.
- RKE2 with no storage: choosing Longhorn or a cloud provider's storage (and Longhorn's node packages).
- Browsers and `docker` on developer machines must trust the CA (download offered).
- Air-gapped or no public DNS: a real hostname, or a custom `ingress-ip-domain`.

## 13. Sources

SPR docs:
- [Requirements](https://documentation.suse.com/cloudnative/suse-private-registry/html/private-registry/pr-requirements.html)
- [Helm chart override reference](https://documentation.suse.com/en-us/cloudnative/suse-private-registry/html/private-registry/pr-helm-chart-override.html)
- [Install with CLI](https://documentation.suse.com/cloudnative/suse-private-registry/html/private-registry/pr-deployment.html)
- [Install with Rancher UI](https://documentation.suse.com/cloudnative/suse-private-registry/html/private-registry/pr-install-rancher.html)
- [HA setup](https://documentation.suse.com/en-us/cloudnative/suse-private-registry/html/private-registry/pr-deployment-ha.html)
- Docs source: `rancher/private-registry-product-docs`

Code:
- Upstream chart: [goharbor/harbor-helm v1.19.2](https://github.com/goharbor/harbor-helm/tree/v1.19.2)
- Harbor: [goharbor/harbor](https://github.com/goharbor/harbor) (`src/server/middleware/security`, `src/server/middleware/csrf`, `src/controller/systeminfo`)
- Rancher: [rancher/rancher](https://github.com/rancher/rancher) (`pkg/httpproxy`, `pkg/auth/tokens`, `pkg/clusterrouter/proxy`, `pkg/catalogv2`, `pkg/capr/planner`, `pkg/apis/rke.cattle.io/v1`)
- Dashboard: `@rancher/shell` 3.0.13 (`pages/c/_cluster/apps/charts/install.vue`, `store/catalog.js`, `models/catalog.cattle.io.*`, `models/service.js`)
- Kubernetes: `pkg/controlplane/apiserver/config.go`, `pkg/registry/core/service/storage/storage.go`, `staging/src/k8s.io/apiserver/pkg/endpoints/filters/authentication.go`
