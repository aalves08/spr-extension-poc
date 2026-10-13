import { DETAIL_ROUTES, REGISTRY_QUERY, ROUTE_PARAMS } from '../config/constants';
import {
  HarborAccessory, HarborArtifact, SCAN_STATUS, SCAN_TYPE, ScanType
} from '../types/harbor';
import { firstScanReport } from './severity';

export const ARTIFACT_KIND = {
  IMAGE: 'image',
  CHART: 'chart',
  MODEL: 'model',
  OTHER: 'other',
} as const;

export type ArtifactKind = typeof ARTIFACT_KIND[keyof typeof ARTIFACT_KIND];

export function artifactKind(artifact?: HarborArtifact): ArtifactKind {
  switch ((artifact?.type || '').toUpperCase()) {
  case 'IMAGE':
    return ARTIFACT_KIND.IMAGE;
  case 'CHART':
    return ARTIFACT_KIND.CHART;
  case 'MODEL':
  case 'CNAI':
    return ARTIFACT_KIND.MODEL;
  default:
    return ARTIFACT_KIND.OTHER;
  }
}

export function signatures(artifact?: HarborArtifact): HarborAccessory[] {
  return (artifact?.accessories || []).filter((a) => a.type?.startsWith('signature.'));
}

export function isSigned(artifact?: HarborArtifact): boolean {
  return signatures(artifact).length > 0;
}

export function hasSbom(artifact?: HarborArtifact): boolean {
  return artifact?.sbom_overview?.scan_status === 'Success' || (artifact?.accessories || []).some((a) => a.type === 'harbor.sbom');
}

export function isIndex(artifact?: HarborArtifact): boolean {
  return (artifact?.references || []).length > 0;
}

export function platform(artifact?: HarborArtifact): string {
  const os = artifact?.extra_attrs?.os;
  const arch = artifact?.extra_attrs?.architecture;

  return os || arch ? [os, arch].filter(Boolean).join('/') : '';
}

export function scanSummary(artifact?: HarborArtifact) {
  return firstScanReport(artifact?.scan_overview);
}

const ACTIVE_SCAN_STATUSES: string[] = [SCAN_STATUS.PENDING, SCAN_STATUS.RUNNING, SCAN_STATUS.SCHEDULED];

/** `scan_status` of the vulnerability scan or SBOM generation, undefined if never run */
export function scanStatus(artifact: HarborArtifact | undefined, type: ScanType): string | undefined {
  return type === SCAN_TYPE.SBOM ? artifact?.sbom_overview?.scan_status : scanSummary(artifact)?.scan_status;
}

export function isScanActive(artifact: HarborArtifact | undefined, type: ScanType): boolean {
  return ACTIVE_SCAN_STATUSES.includes(scanStatus(artifact, type) || '');
}

/** Scanners only handle images; Harbor rejects charts and other OCI artifacts */
export function isScannable(artifact?: HarborArtifact): boolean {
  return artifactKind(artifact) === ARTIFACT_KIND.IMAGE;
}

export function tagNames(artifact?: HarborArtifact): string[] {
  return (artifact?.tags || []).map((t) => t.name);
}

export function artifactRoute(connectionId: string, project: string, repo: string, digest: string) {
  return {
    name:   DETAIL_ROUTES.ARTIFACT,
    params: {
      ...ROUTE_PARAMS, project, repo, digest
    },
    query: { [REGISTRY_QUERY]: connectionId },
  };
}

export function repositoryRoute(connectionId: string, project: string, repo: string) {
  return {
    name:   DETAIL_ROUTES.REPOSITORY,
    params: {
      ...ROUTE_PARAMS, project, repo
    },
    query: { [REGISTRY_QUERY]: connectionId },
  };
}

export function projectRoute(connectionId: string, project: string) {
  return {
    name:   DETAIL_ROUTES.PROJECT,
    params: { ...ROUTE_PARAMS, project },
    query:  { [REGISTRY_QUERY]: connectionId },
  };
}
