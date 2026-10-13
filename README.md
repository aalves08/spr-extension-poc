# SUSE Private Registry extension for Rancher (POC)

A Rancher UI extension that brings [SUSE Private Registry](https://documentation.suse.com/cloudnative/suse-private-registry/) (SPR, based on Harbor) into Rancher. It shows what is in your registries, how vulnerable it is, and where those images are running in the clusters Rancher manages.

> This is an independent proof of concept. It is not a SUSE product and is not supported.

- Rancher **2.15 or later** (uses the Product Registration API and the `ProxyEndpoint` allow-list)
- UI extensions API 3.x (`@rancher/shell` 3.x, Vue 3)
- SPR 1.0 to 1.2
- Admin users only for now. Per-user access is planned.

## What it does

The extension is **read-only towards SPR**. The only requests that change anything in SPR are "Scan" and "Generate SBOM". Anything else that writes goes to Kubernetes, never to the registry.

It adds a top-level **SUSE Private Registry** product with these pages:

| Page | What you get |
|---|---|
| **Settings** | Add, edit, test and remove connections to SPR instances. Credentials are stored in a Secret in `cattle-global-data`, and Rancher signs the requests to SPR on the server side. A banner offers to add the registry host to Rancher's proxy allow-list (`ProxyEndpoint`) when it is missing. "Detect SPR installations" finds SPR Helm releases in your clusters, so you can link a connection to its installation. |
| **SPR Registries** | All connections with status, version and counts. |
| **Registry Overview** | Dashboard for one registry: health of the linked installation's components, inventory and disk use, vulnerability totals, scan coverage, the most vulnerable artifacts and the most severe CVEs. |
| **Projects / Repositories** | Browse projects, repositories and artifacts (tags, digests, size, scan status). |
| **Artifact detail** | CVE list with fixed versions, SBOM download, signatures, pull command, and **Running in**: every workload in every cluster that runs this exact image. |

Things you can do from those pages:

- **Who's exposed?** Use the icon in the *Exposure* column next to a CVE. It lists the workloads, in any cluster, that run an image affected by that CVE.
- **Find package.** Answers "who runs package X?". The extension reads the SBOMs SPR generated for the images running in your clusters and lists the workloads that contain the package. You can give a version or a version prefix, for example `openssl 3.0`. Package names in the CVE list link straight to it. Images with no SBOM are listed separately, so you know what wasn't checked.
- **Deploy image.** Creates a Deployment from an artifact in a cluster and namespace you pick. It uses an existing `dockerconfigjson` pull secret.

It also adds an **Image security** tab to Deployments, StatefulSets, DaemonSets, Jobs, CronJobs and Pods. The tab shows the scan results for each container image that comes from a connected SPR. It can also fix the workload in one of three ways:

- pin a tag to its digest
- switch to a less vulnerable tag
- pull through an existing proxy-cache project

## Running it locally

Requirements:

- Node 24 (see `.nvmrc`)
- Yarn 1.22
- A Rancher 2.15+ instance you can log in to as an admin

```sh
nvm use
yarn install
```

`.yarnrc` turns on `--frozen-lockfile`, so `yarn install` installs exactly what `yarn.lock` pins. To change dependencies, run `yarn install --no-default-rc` and commit the updated `yarn.lock`.

### Dev server

```sh
API=https://<your-rancher-host> yarn dev
```

Open <https://localhost:8005> and log in with your Rancher credentials. Your browser will warn about the dev server's self-signed certificate; accept it. The extension is built into the dev UI, and changes hot-reload.

### Load a build into a real Rancher

```sh
yarn build-pkg suse-private-registry
yarn serve-pkgs
```

`serve-pkgs` prints a URL. In Rancher:

1. Go to *Preferences* and turn on **Enable Extension developer features**.
2. Open *Extensions*, then **⋮ › Developer Load**, and paste the URL.

The extension stays loaded until you reload the page, unless you tick "Persist". For a permanent install, publish it as a Helm chart through the workflows in `.github/workflows`. See [Publishing](https://extensions.rancher.io/extensions/next/publishing).

### Checks

Run all of these before opening a PR:

```sh
./node_modules/@rancher/shell/scripts/lint --ext .ts,.vue pkg/suse-private-registry
npx tsc --noEmit -p pkg/suse-private-registry/tsconfig.json
yarn build-pkg suse-private-registry
```

There are no unit tests yet.

## Connecting a registry

1. Open **SUSE Private Registry › Settings** and click **Add connection**.
2. Enter the SPR URL, for example `https://spr.example.com`, and a username and password. Click **Test connection**, then save.
3. If the banner says the host is not allowed, click its button. This adds the host to Rancher's proxy allow-list.

**Use a robot account, not `admin`.** In the SPR portal, go to *Administration › Robot Accounts › New Robot Account*. Create a system-level account that can read projects, repositories, artifacts, scans and SBOMs in all projects. To use the Scan and Generate SBOM buttons, also give it scan and SBOM *create* permissions.

Robot accounts also avoid a Rancher bug. Rancher's proxy encodes Basic auth with URL-safe base64, which Harbor can't decode. Some passwords encode to a string containing `+` or `/`. Those credentials pass "Test connection" but fail with a 401 once saved. The form refuses to save them. If it refuses yours, generate a new secret for the robot account.

**The registry's certificate must be trusted by Rancher.** Rancher calls SPR from the server side, so a certificate that only your browser accepts is not enough. With a private CA, add it to Rancher's additional trusted CAs: the `tls-ca-additional` Secret in `cattle-system`, plus `additionalTrustedCAs=true` on the Rancher chart. Then restart Rancher. See [Rancher: custom CA](https://ranchermanager.docs.rancher.com/getting-started/installation-and-upgrade/resources/add-tls-secrets#using-a-private-ca-signed-certificate).

## Installing SUSE Private Registry (recommended setup)

SPR is installed with Helm from SUSE's OCI registry. You need an SCC organisation with an active SPR subscription. The mirroring credentials are in SCC under **Proxies**.

### Before you start

| | Recommendation |
|---|---|
| **Where** | A dedicated **downstream** cluster managed by Rancher, not the Rancher `local` cluster |
| **Kubernetes** | 1.33, 1.34 or 1.35. Other versions are not validated. |
| **Nodes** | At least 3 workers with 4 vCPU / 16 GiB each. Use 8 vCPU / 32 GiB if you scan or push a lot. |
| **Storage** | A **default StorageClass**. On RKE2 that's usually SUSE Storage (Longhorn), because RKE2 ships none. On K3s, `local-path` is fine for evaluation only, because it is node-local. For production image storage, prefer S3-compatible object storage. |
| **Ingress** | An ingress controller in the cluster. New RKE2 1.36+ and K3s clusters use Traefik, and older RKE2 clusters use ingress-nginx. |
| **Hostname** | A DNS name pointing at the ingress. Without DNS, use sslip.io with dashes: `spr.10-0-0-5.sslip.io`. |
| **TLS** | Your own certificate, ideally from a CA that Rancher and your container runtimes trust. Avoid the chart's default `certSource: auto`. It creates a self-signed certificate that nothing trusts, so pulls and the Rancher connection both fail. |
| **Helm** | 3.2+. Use Helm 4 if you want to install by digest. |

The chart's default volume sizes (5 GiB for images, 1 GiB for everything else) are for trying it out only. Changing sizes later is painful, so set them at install time.

### Install with the Helm CLI (recommended)

```sh
NS=private-registry
VERSION=1.2   # SPR app version, part of the chart path

# 1. Log in to registry.suse.com with your SCC mirroring credentials
head -1 ./password.txt | helm registry login registry.suse.com \
  --username <SCC_USERNAME> --password-stdin

# 2. Namespace and image pull secret (the chart expects the name "suse-registry")
kubectl create namespace $NS
kubectl create secret docker-registry suse-registry -n $NS \
  --docker-server=registry.suse.com \
  --docker-username=<SCC_USERNAME> \
  --docker-password="$(head -1 ./password.txt)"

# 3. TLS certificate for the registry hostname
kubectl create secret tls suse-registry-tls -n $NS \
  --cert=spr.example.com.pem --key=spr.example.com-key.pem
```

Create `spr-values.yaml`. The keys follow the upstream Harbor chart. Check them against `helm show values oci://registry.suse.com/private-registry/$VERSION/private-registry-helm`.

```yaml
externalURL: https://spr.example.com

expose:
  type: ingress
  ingress:
    className: traefik        # or nginx; set it explicitly
    hosts:
      core: spr.example.com
  tls:
    enabled: true
    certSource: secret
    secret:
      secretName: suse-registry-tls

persistence:
  persistentVolumeClaim:
    registry:
      size: 500Gi             # or use persistence.imageChartStorage.type: s3
    jobservice:
      jobLog:
        size: 10Gi
    database:
      size: 20Gi
    redis:
      size: 20Gi
    trivy:
      size: 20Gi
```

Install:

```sh
helm install spr oci://registry.suse.com/private-registry/$VERSION/private-registry-helm \
  -n $NS -f spr-values.yaml --wait
```

Get the generated admin password. The secret is normally `<release>-harbor-core`; run `kubectl get secrets -n $NS` if the name differs.

```sh
kubectl get secret spr-harbor-core -n $NS \
  -o jsonpath='{.data.HARBOR_ADMIN_PASSWORD}' | base64 -d
```

Log in to `https://spr.example.com` as `admin`, then create the robot account for the extension. See [Connecting a registry](#connecting-a-registry).

**Large pushes on Traefik.** Traefik closes requests after 60 seconds by default, so slow pushes of large images fail. To raise the limit, add a `HelmChartConfig` in `kube-system` that sets `ports.websecure.transport.respondingTimeouts.readTimeout`. Name it `rke2-traefik` on RKE2 or `traefik` on K3s. This is a cluster-wide change.

### Install from the Rancher UI

This works too, but you get fewer checks.

1. On the target cluster, go to *Apps › Repositories › Create*.
2. Choose **OCI Repository** with the URL `oci://registry.suse.com/private-registry/private-registry-helm`. Add an HTTP Basic Auth secret with your SCC credentials.
3. Create the `suse-registry` pull secret in the target namespace. Use the **Registry** secret type for `registry.suse.com`. The SUSE docs say *HTTP Basic Auth* here, but Kubernetes can't pull images with that type.
4. Go to *Apps › Charts*, open the chart, and set the same values as above in *Edit Options › YAML*. Then install.

A guided "Install SPR" wizard inside this extension is planned. It will check the cluster, storage, ingress, hostname and certificate first, then create the connection for you.

### SUSE documentation

- [Requirements](https://documentation.suse.com/cloudnative/suse-private-registry/html/private-registry/pr-requirements.html)
- [Install from the command line](https://documentation.suse.com/cloudnative/suse-private-registry/html/private-registry/pr-deployment.html)
- [Install from Rancher](https://documentation.suse.com/cloudnative/suse-private-registry/html/private-registry/pr-install-rancher.html)
- [Helm chart overrides](https://documentation.suse.com/en-us/cloudnative/suse-private-registry/html/private-registry/pr-helm-chart-override.html)
- [High availability](https://documentation.suse.com/en-us/cloudnative/suse-private-registry/html/private-registry/pr-deployment-ha.html)

## Project layout

```
pkg/suse-private-registry/
  index.ts         product registration, Image security tab
  config/          product, routes, constants
  pages/           top-level pages (Settings, Registries, Overview, ...)
  components/      tables, dialogs, banners, overview cards
  composables/     data loading (SPR API, cluster scans, SBOM search)
  utils/           image references, k8s helpers, SBOM parsing
  l10n/en-us.yaml  all UI strings (prefixed `spr.`)
```

Design notes and the roadmap are in `SPR-EXTENSION-PLAN.md`, `SPR-PHASE-1-IMPLEMENTATION-PLAN.md` and `SPR-PHASE-2-INSTALL-WIZARD.md`.
