import { Store, useStore } from 'vuex';
import { useShell } from '@shell/apis';
import { ProxyApi } from '@shell/apis/intf/shell-api/proxy';
import { base64Encode } from '@shell/utils/crypto';
import { HARBOR_API_PREFIX, HARBOR_PAGE_SIZE, HARBOR_VULN_ACCEPT, SECRET_KEYS } from '../config/constants';
import { Connection } from '../types/connection';
import {
  HARBOR_ERROR,
  HarborArtifact,
  HarborErrorKind,
  HarborGcHistory,
  HarborHealth,
  HarborProject,
  HarborProjectSummary,
  HarborProxyCache,
  HarborReplicationExecution,
  HarborRepository,
  HarborScanner,
  HarborSchedule,
  HarborStatistics,
  HarborSystemInfo,
  HarborVolumes,
  HarborVulnerabilityItem,
  HarborVulnerabilityReport,
  HarborVulSummary,
  ScanType,
} from '../types/harbor';
import { encodeRepoName, encodeSegment } from '../utils/harbor-encoding';
import { registryImageHost } from '../utils/image-ref';

const CACHE_TTL_MS = 30 * 1000;
const MAX_PAGES = 50;

export class HarborError extends Error {
  kind: HarborErrorKind;
  status?: number;

  constructor(kind: HarborErrorKind, message: string, status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

function errorMessage(e: any): string {
  if (!e) {
    return '';
  }

  if (Array.isArray(e.errors) && e.errors.length) {
    return e.errors.map((x: any) => x?.message || x?.code).filter(Boolean).join(', ');
  }

  if (typeof e.data === 'string') {
    return e.data;
  }

  return e.message || e._statusText || `${ e }`;
}

/**
 * Map errors from `/meta/proxy` and Harbor to a small set of kinds the UI can show.
 */
export function normaliseHarborError(e: any): HarborError {
  if (e instanceof HarborError) {
    return e;
  }

  const status: number | undefined = e?._status ?? e?.status ?? e?.response?.status;
  const message = errorMessage(e);
  const lower = message.toLowerCase();

  if (lower.includes('x509') || lower.includes('certificate') || lower.includes('tls:')) {
    return new HarborError(HARBOR_ERROR.TLS, message, status);
  }

  switch (status) {
  case 401:
    return new HarborError(HARBOR_ERROR.UNAUTHORIZED, message, status);
  case 403:
    return new HarborError(HARBOR_ERROR.FORBIDDEN, message, status);
  case 404:
    return new HarborError(HARBOR_ERROR.NOT_FOUND, message, status);
  case 503:
    // Rancher answers 503 for hosts that are not in any ProxyEndpoint. Harbor's own errors carry an `errors` array.
    if (!Array.isArray(e?.errors)) {
      return new HarborError(HARBOR_ERROR.PROXY_NOT_ALLOWED, message, status);
    }

    return new HarborError(HARBOR_ERROR.UNREACHABLE, message, status);
  case 502:
  case 504:
    return new HarborError(HARBOR_ERROR.UNREACHABLE, message, status);
  default:
    break;
  }

  if (!status || ['dial tcp', 'no such host', 'connection refused', 'timeout', 'network error', 'eof'].some((s) => lower.includes(s))) {
    return new HarborError(HARBOR_ERROR.UNREACHABLE, message, status);
  }

  return new HarborError(HARBOR_ERROR.UNKNOWN, message, status);
}

/** Errors that mean "this card/feature isn't available with these credentials or this version" */
export function isUnavailable(e: any): boolean {
  const kind = normaliseHarborError(e).kind;

  return kind === HARBOR_ERROR.FORBIDDEN || kind === HARBOR_ERROR.NOT_FOUND || kind === HARBOR_ERROR.UNAUTHORIZED;
}

type Query = Record<string, string | number | boolean | undefined>;

interface RequestOptions {
  /** Skip authentication (e.g. `/ping`, `/systeminfo` before saving) */
  anonymous?: boolean;
  /** Basic auth from the browser, only used by "Test connection" before a Secret exists */
  basic?: { username: string; password: string };
  headers?: Record<string, string>;
  /** Bypass the in-memory cache */
  force?: boolean;
}

const cache = new Map<string, { at: number; promise: Promise<any> }>();

export function invalidateHarborCache(connectionId?: string): void {
  if (!connectionId) {
    cache.clear();

    return;
  }

  [...cache.keys()].filter((k) => k.startsWith(`${ connectionId }|`)).forEach((k) => cache.delete(k));
}

export interface HarborTarget {
  id?: string;
  url: string;
  credentialId?: string;
}

export class HarborClient {
  private proxy: ProxyApi;
  private store: Store<unknown>;
  readonly target: HarborTarget;

  constructor(proxy: ProxyApi, store: Store<unknown>, target: HarborTarget) {
    this.proxy = proxy;
    this.store = store;
    this.target = target;
  }

  private buildUrl(path: string, query?: Query): URL {
    const url = new URL(`${ this.target.url.replace(/\/+$/, '') }${ HARBOR_API_PREFIX }${ path }`);

    Object.entries(query || {}).forEach(([k, v]) => {
      if (v !== undefined) {
        url.searchParams.set(k, `${ v }`);
      }
    });

    return url;
  }

  private authentication(opts: RequestOptions) {
    if (opts.anonymous) {
      return undefined;
    }

    if (opts.basic) {
      return { token: base64Encode(`${ opts.basic.username }:${ opts.basic.password }`), authSigner: 'basic' as const };
    }

    if (this.target.credentialId) {
      return {
        id:            this.target.credentialId,
        authSigner:    'basic' as const,
        usernameField: SECRET_KEYS.USERNAME,
        passwordField: SECRET_KEYS.PASSWORD,
      };
    }

    return undefined;
  }

  async get<T = any>(path: string, query?: Query, opts: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, query);
    const cacheable = !!this.target.id && !opts.basic && !opts.anonymous;
    const key = `${ this.target.id }|${ url.toString() }`;

    if (cacheable && !opts.force) {
      const hit = cache.get(key);

      if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
        return hit.promise;
      }
    }

    const promise = this.proxy.request({
      url,
      headers:        { 'X-Accept-Vulnerabilities': HARBOR_VULN_ACCEPT, ...(opts.headers || {}) },
      authentication: this.authentication(opts),
    }).catch((e: any) => {
      cache.delete(key);
      throw normaliseHarborError(e);
    });

    if (cacheable) {
      cache.set(key, { at: Date.now(), promise });
    }

    return promise;
  }

  /**
   * Write request; drops the connection's cache so the next reads see the change.
   *
   * Not sent with `proxy.request()`: shell 3.0.x passes the payload on as `body`, which axios ignores, so the request
   * arrives without one (Harbor then treats e.g. an SBOM scan as a vulnerability scan). Same URL and auth headers.
   */
  async post<T = any>(path: string, data?: any, opts: RequestOptions = {}): Promise<T> {
    const { url, headers } = this.proxy.prepareRequest({
      url:            this.buildUrl(path),
      headers:        { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      authentication: this.authentication(opts),
    });

    try {
      return await this.store.dispatch('management/request', {
        url,
        method:               'POST',
        headers,
        data,
        redirectUnauthorized: false,
      });
    } catch (e: any) {
      throw normaliseHarborError(e);
    } finally {
      if (this.target.id) {
        invalidateHarborCache(this.target.id);
      }
    }
  }

  /**
   * Harbor paginates with `page`/`page_size` and reports the total in `X-Total-Count`.
   */
  async list<T = any>(path: string, query?: Query, opts: RequestOptions = {}): Promise<T[]> {
    const out: T[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const res: any = await this.get(path, {
        ...query, page, page_size: HARBOR_PAGE_SIZE
      }, opts);
      const items: T[] = Array.isArray(res) ? res : [];

      out.push(...items);

      const total = parseInt(res?._headers?.['x-total-count'], 10);

      if (items.length < HARBOR_PAGE_SIZE || (!Number.isNaN(total) && out.length >= total)) {
        break;
      }
    }

    return out;
  }

  // ---- System -------------------------------------------------------------------------------------------------------

  ping(): Promise<string> {
    return this.get('/ping', undefined, { anonymous: true, force: true });
  }

  systemInfo(opts: RequestOptions = {}): Promise<HarborSystemInfo> {
    return this.get('/systeminfo', undefined, opts);
  }

  /**
   * Validate credentials. Robot accounts can't call `/users/current`, so fall back to a project list.
   */
  async validateCredentials(opts: RequestOptions = {}): Promise<{ username?: string; robot?: boolean }> {
    try {
      const user = await this.get('/users/current', undefined, { ...opts, force: true });

      return { username: user?.username };
    } catch (e: any) {
      const err = normaliseHarborError(e);

      if (err.kind !== HARBOR_ERROR.UNAUTHORIZED && err.kind !== HARBOR_ERROR.FORBIDDEN) {
        throw err;
      }

      // Robot accounts get 401/403 on /users/current but can list projects
      await this.get('/projects', { page_size: 1 }, { ...opts, force: true });

      return { robot: true };
    }
  }

  volumes(): Promise<HarborVolumes> {
    return this.get('/systeminfo/volumes');
  }

  health(opts: RequestOptions = {}): Promise<HarborHealth> {
    return this.get('/health', undefined, opts);
  }

  statistics(): Promise<HarborStatistics> {
    return this.get('/statistics');
  }

  /** Security Hub summary, registry-wide (`/vul/summary` doesn't exist) */
  vulSummary(): Promise<HarborVulSummary> {
    return this.get('/security/summary', { with_dangerous_cve: true, with_dangerous_artifact: true });
  }

  /** Security Hub: every scanned artifact affected by a CVE */
  cveFindings(cveId: string): Promise<HarborVulnerabilityItem[]> {
    return this.list('/security/vul', {
      q: `cve_id=${ cveId }`, with_tag: true, tune_count: true
    });
  }

  replicationExecutions(): Promise<HarborReplicationExecution[]> {
    return this.get('/replication/executions', { page_size: 10, sort: '-start_time' });
  }

  replicationPolicy(id: number): Promise<{ id: number; name: string }> {
    return this.get(`/replication/policies/${ id }`);
  }

  gcHistory(): Promise<HarborGcHistory[]> {
    return this.get('/system/gc', { page_size: 1 });
  }

  gcSchedule(): Promise<HarborSchedule> {
    return this.get('/system/gc/schedule');
  }

  scanners(): Promise<HarborScanner[]> {
    return this.get('/scanners');
  }

  /** The list leaves `health` empty; like Harbor's portal, treat a metadata response as healthy */
  scannerMetadata(uuid: string): Promise<unknown> {
    return this.get(`/scanners/${ encodeSegment(uuid) }/metadata`);
  }

  // ---- Projects / repositories / artifacts --------------------------------------------------------------------------

  projects(): Promise<HarborProject[]> {
    return this.list('/projects', { with_detail: true });
  }

  project(name: string): Promise<HarborProject> {
    return this.get(`/projects/${ encodeSegment(name) }`, undefined, { headers: { 'X-Is-Resource-Name': 'true' } });
  }

  projectSummary(projectNameOrId: string | number): Promise<HarborProjectSummary> {
    const byName = typeof projectNameOrId === 'string';

    return this.get(`/projects/${ encodeSegment(`${ projectNameOrId }`) }/summary`, undefined, byName ? { headers: { 'X-Is-Resource-Name': 'true' } } : {});
  }

  /** Proxy-cache projects with their upstream image host (one summary request per proxy project) */
  async proxyCaches(): Promise<HarborProxyCache[]> {
    const proxies = (await this.projects()).filter((p) => !!p.registry_id);
    const found = await Promise.all(proxies.map(async(p): Promise<HarborProxyCache | undefined> => {
      const registry = (await this.projectSummary(p.name).catch(() => undefined))?.registry;
      const host = registry ? registryImageHost(registry) : '';

      return host ? {
        project: p.name, host, registryName: registry?.name
      } : undefined;
    }));

    return found.filter((p): p is HarborProxyCache => !!p);
  }

  repositories(project: string): Promise<HarborRepository[]> {
    return this.list(`/projects/${ encodeSegment(project) }/repositories`);
  }

  /** Repositories of every project the account can see */
  allRepositories(): Promise<HarborRepository[]> {
    return this.list('/repositories');
  }

  repository(project: string, repo: string): Promise<HarborRepository> {
    return this.get(`/projects/${ encodeSegment(project) }/repositories/${ encodeRepoName(repo) }`);
  }

  artifacts(project: string, repo: string): Promise<HarborArtifact[]> {
    return this.list(`/projects/${ encodeSegment(project) }/repositories/${ encodeRepoName(repo) }/artifacts`, {
      with_tag:           true,
      with_scan_overview: true,
      with_sbom_overview: true,
      with_label:         true,
      with_accessory:     true,
    });
  }

  /** Most recently pushed artifact, with tags and scan overview */
  async latestArtifact(project: string, repo: string): Promise<HarborArtifact | undefined> {
    const res = await this.get<HarborArtifact[]>(`/projects/${ encodeSegment(project) }/repositories/${ encodeRepoName(repo) }/artifacts`, {
      page:               1,
      page_size:          1,
      sort:               '-push_time',
      with_tag:           true,
      with_scan_overview: true,
    });

    return res?.[0];
  }

  /**
   * `reference` is a digest (`sha256:...`) or a tag.
   */
  artifact(project: string, repo: string, reference: string): Promise<HarborArtifact> {
    return this.get(`/projects/${ encodeSegment(project) }/repositories/${ encodeRepoName(repo) }/artifacts/${ encodeSegment(reference) }`, {
      with_tag:           true,
      with_scan_overview: true,
      with_accessory:     true,
      with_sbom_overview: true,
      with_label:         true,
    });
  }

  /**
   * The report is keyed by MIME type; return the first one.
   */
  async vulnerabilities(project: string, repo: string, digest: string): Promise<HarborVulnerabilityReport | undefined> {
    const res: Record<string, HarborVulnerabilityReport> = await this.get(
      `/projects/${ encodeSegment(project) }/repositories/${ encodeRepoName(repo) }/artifacts/${ encodeSegment(digest) }/additions/vulnerabilities`
    );

    return res ? Object.values(res).find((r) => r && typeof r === 'object') : undefined;
  }

  /**
   * SBOM document of an artifact. `sbomDigest` is `sbom_overview.sbom_digest` (the SBOM accessory).
   * NOTE: endpoint shape not verified against a live SPR yet (spike).
   */
  sbom(project: string, repo: string, sbomDigest: string): Promise<any> {
    return this.get(
      `/projects/${ encodeSegment(project) }/repositories/${ encodeRepoName(repo) }/artifacts/${ encodeSegment(sbomDigest) }/additions/sbom`,
      undefined,
      { force: true }
    );
  }

  // ---- Scans ----------------------------------------------------------------------------------------------------------

  /** Start a vulnerability scan or SBOM generation (202, runs async; poll the artifact's overview) */
  scan(project: string, repo: string, digest: string, scanType: ScanType): Promise<void> {
    return this.post(`${ this.artifactPath(project, repo, digest) }/scan`, { scan_type: scanType });
  }

  stopScan(project: string, repo: string, digest: string, scanType: ScanType): Promise<void> {
    return this.post(`${ this.artifactPath(project, repo, digest) }/scan/stop`, { scan_type: scanType });
  }

  /** `resource:action` pairs the account has in a project, e.g. `scan:create` */
  async projectPermissions(projectId: number): Promise<Set<string>> {
    const perms: { resource: string; action: string }[] = await this.get('/users/current/permissions', { scope: `/project/${ projectId }`, relative: true });

    return new Set((Array.isArray(perms) ? perms : []).map((p) => `${ p.resource }:${ p.action }`));
  }

  private artifactPath(project: string, repo: string, digest: string): string {
    return `/projects/${ encodeSegment(project) }/repositories/${ encodeRepoName(repo) }/artifacts/${ encodeSegment(digest) }`;
  }
}

/**
 * Harbor client over the shell Proxy API (`/meta/proxy`). Must be called from `setup()`.
 */
export function useHarbor() {
  const shell = useShell();
  const store = useStore();

  function clientFor(connection: Connection | HarborTarget): HarborClient {
    return new HarborClient(shell.proxy, store, {
      id:           connection.id,
      url:          connection.url,
      credentialId: connection.credentialId,
    });
  }

  return { clientFor };
}
