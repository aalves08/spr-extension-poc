// Subset of the Harbor v2.0 API responses used by the extension (Harbor 2.13 - 2.15)
// Property names mirror the Harbor JSON wire format, hence snake_case
/* eslint-disable camelcase */

export interface HarborSystemInfo {
  harbor_version?: string;
  auth_mode?: string;
  external_url?: string;
  read_only?: boolean;
  primary_auth_mode?: boolean;
  self_registration?: boolean;
  has_ca_root?: boolean;
  registry_url?: string;
  with_chartmuseum?: boolean;
}

export interface HarborStorage {
  total: number;
  free: number;
}

export interface HarborVolumes {
  storage?: HarborStorage[];
}

export interface HarborComponentHealth {
  name: string;
  status: string;
  error?: string;
}

export interface HarborHealth {
  status: string;
  components?: HarborComponentHealth[];
}

export interface HarborStatistics {
  private_project_count?: number;
  private_repo_count?: number;
  public_project_count?: number;
  public_repo_count?: number;
  total_project_count?: number;
  total_repo_count?: number;
  total_storage_consumption?: number;
}

export interface HarborDangerousCve {
  cve_id: string;
  severity: string;
  cvss_score_v3?: number;
  desc?: string;
  package?: string;
  version?: string;
}

export interface HarborDangerousArtifact {
  project_id: number;
  repository_name: string;
  digest: string;
  critical_cnt: number;
  high_cnt: number;
  medium_cnt: number;
}

export interface HarborVulSummary {
  critical_cnt?: number;
  high_cnt?: number;
  medium_cnt?: number;
  low_cnt?: number;
  none_cnt?: number;
  unknown_cnt?: number;
  total_vuls?: number;
  scanned_cnt?: number;
  total_artifact?: number;
  fixable_cnt?: number;
  dangerous_cves?: HarborDangerousCve[];
  dangerous_artifacts?: HarborDangerousArtifact[];
}

export interface HarborReplicationExecution {
  id: number;
  policy_id: number;
  status: string;
  trigger: string;
  start_time?: string;
  end_time?: string;
  total?: number;
  failed?: number;
  succeed?: number;
}

export interface HarborGcHistory {
  id: number;
  job_status: string;
  job_kind?: string;
  creation_time?: string;
  update_time?: string;
}

export interface HarborSchedule {
  schedule?: {
    type?: string;
    cron?: string;
    next_scheduled_time?: string;
  };
}

export interface HarborScanner {
  uuid: string;
  name: string;
  description?: string;
  url?: string;
  disabled?: boolean;
  is_default?: boolean;
  health?: string;
  vendor?: string;
  version?: string;
}

export interface HarborProject {
  project_id: number;
  name: string;
  registry_id?: number | null;
  repo_count?: number;
  creation_time?: string;
  update_time?: string;
  metadata?: {
    public?: string;
    auto_scan?: string;
    prevent_vul?: string;
    severity?: string;
    enable_content_trust_cosign?: string;
    reuse_sys_cve_allowlist?: string;
    auto_sbom_generation?: string;
    proxy_speed_kb?: string;
    retention_id?: string;
  };
  current_user_role_id?: number;
}

export interface HarborQuota {
  hard?: { storage?: number };
  used?: { storage?: number };
}

export interface HarborRegistry {
  id: number;
  name: string;
  url: string;
  type: string;
}

export interface HarborProjectSummary {
  repo_count?: number;
  project_admin_count?: number;
  maintainer_count?: number;
  developer_count?: number;
  guest_count?: number;
  limited_guest_count?: number;
  quota?: HarborQuota;
  registry?: HarborRegistry;
}

export interface HarborRepository {
  id: number;
  project_id: number;
  name: string;
  description?: string;
  artifact_count?: number;
  pull_count?: number;
  creation_time?: string;
  update_time?: string;
}

/** Repository row for tables: the project and the name without it (`<project>/<repo>`, repo can contain slashes) */
export type HarborRepositoryRow = HarborRepository & { project: string; shortName: string };

/** Security Hub finding (`/security/vul`): one row per artifact and affected package */
export interface HarborVulnerabilityItem {
  project_id: number;
  /** `<project>/<repo>` */
  repository_name: string;
  digest: string;
  tags?: string[];
  cve_id: string;
  severity?: string;
  package?: string;
  version?: string;
  fixed_version?: string;
}

/** Proxy-cache project and the image host its upstream registry serves */
export interface HarborProxyCache {
  project: string;
  /** e.g. `docker.io`, `quay.io` */
  host: string;
  registryName?: string;
}

export interface HarborTag {
  id: number;
  name: string;
  push_time?: string;
  pull_time?: string;
  immutable?: boolean;
}

export interface HarborVulnerabilitySummary {
  total?: number;
  fixable?: number;
  summary?: Record<string, number>;
}

export interface HarborNativeReportSummary {
  report_id?: string;
  scan_status?: string;
  severity?: string;
  duration?: number;
  summary?: HarborVulnerabilitySummary;
  start_time?: string;
  end_time?: string;
  complete_percent?: number;
  scanner?: { name?: string; vendor?: string; version?: string };
}

export interface HarborSbomOverview {
  start_time?: string;
  end_time?: string;
  scan_status?: string;
  sbom_digest?: string;
  report_id?: string;
  duration?: number;
  scanner?: { name?: string; vendor?: string; version?: string };
}

export interface HarborAccessory {
  id: number;
  artifact_id?: number;
  subject_artifact_id?: number;
  subject_artifact_digest?: string;
  subject_artifact_repo?: string;
  size?: number;
  digest: string;
  type: string;
  icon?: string;
  creation_time?: string;
}

export interface HarborReference {
  parent_id?: number;
  child_id?: number;
  child_digest: string;
  platform?: { architecture?: string; os?: string; variant?: string };
  annotations?: Record<string, string>;
  urls?: string[];
}

export interface HarborArtifact {
  id: number;
  type: string;
  media_type?: string;
  manifest_media_type?: string;
  artifact_type?: string;
  project_id: number;
  repository_id: number;
  repository_name?: string;
  digest: string;
  size?: number;
  icon?: string;
  push_time?: string;
  pull_time?: string;
  extra_attrs?: {
    architecture?: string;
    os?: string;
    config?: Record<string, any>;
    [key: string]: any;
  };
  annotations?: Record<string, string>;
  references?: HarborReference[];
  tags?: HarborTag[] | null;
  labels?: { id: number; name: string; color?: string }[] | null;
  accessories?: HarborAccessory[] | null;
  scan_overview?: Record<string, HarborNativeReportSummary>;
  sbom_overview?: HarborSbomOverview;
}

export interface HarborVulnerability {
  id: string;
  package: string;
  version: string;
  fix_version?: string;
  severity: string;
  description?: string;
  links?: string[];
  preferred_cvss?: {
    score_v3?: number;
    score_v2?: number;
    vector_v3?: string;
  };
  cwe_ids?: string[];
}

export interface HarborVulnerabilityReport {
  generated_at?: string;
  scanner?: { name?: string; vendor?: string; version?: string };
  severity?: string;
  vulnerabilities?: HarborVulnerability[];
}

export const SCAN_TYPE = {
  VULNERABILITY: 'vulnerability',
  SBOM:          'sbom',
} as const;

export type ScanType = typeof SCAN_TYPE[keyof typeof SCAN_TYPE];

/** `scan_status` values of scan and SBOM overviews */
export const SCAN_STATUS = {
  PENDING:   'Pending',
  RUNNING:   'Running',
  SCHEDULED: 'Scheduled',
  SUCCESS:   'Success',
  ERROR:     'Error',
  STOPPED:   'Stopped',
} as const;

export const HARBOR_ERROR = {
  UNAUTHORIZED:      'unauthorized',
  FORBIDDEN:         'forbidden',
  NOT_FOUND:         'notFound',
  PROXY_NOT_ALLOWED: 'proxyNotAllowed',
  TLS:               'tls',
  UNREACHABLE:       'unreachable',
  UNKNOWN:           'unknown',
} as const;

export type HarborErrorKind = typeof HARBOR_ERROR[keyof typeof HARBOR_ERROR];
