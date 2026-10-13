import { HarborVulnerabilityItem } from '../types/harbor';
import { mapLimit } from '../utils/async';
import { splitProjectRepo } from '../utils/image-ref';
import { tagNames } from '../utils/artifact';
import { HarborClient } from './useHarbor';

// Concurrent artifact listings while mapping platform manifests to their index
const REPO_CONCURRENCY = 5;

export interface CveAffectedArtifact {
  key: string;
  project: string;
  repo: string;
  digest: string;
  tags: string[];
  /** Highest severity reported for the CVE in this artifact */
  severity?: string;
  packages: string[];
}

export interface CveExposureTargets {
  artifacts: CveAffectedArtifact[];
  /** Digests a pod can report for the affected artifacts: their own plus the index (multi-arch) digests that contain them */
  digests: string[];
}

function group(findings: HarborVulnerabilityItem[]): CveAffectedArtifact[] {
  const byKey = new Map<string, CveAffectedArtifact>();

  findings.forEach((f) => {
    const split = splitProjectRepo(f.repository_name || '');

    if (!split || !f.digest) {
      return;
    }

    const key = `${ f.repository_name }@${ f.digest }`;
    const existing = byKey.get(key);

    if (existing) {
      if (f.package && !existing.packages.includes(f.package)) {
        existing.packages.push(f.package);
      }

      return;
    }

    byKey.set(key, {
      key,
      ...split,
      digest:   f.digest,
      tags:     f.tags || [],
      severity: f.severity,
      packages: f.package ? [f.package] : [],
    });
  });

  return [...byKey.values()];
}

/**
 * Artifacts affected by a CVE (Security Hub) and the digests to look for in running pods.
 *
 * Harbor scans platform manifests, but a pod that pulled a multi-arch image by tag reports the index digest, so each
 * affected repository's artifacts are listed to find the indexes that reference an affected manifest.
 */
export async function cveExposureTargets(client: HarborClient, cveId: string): Promise<CveExposureTargets> {
  const artifacts = group(await client.cveFindings(cveId));
  const digests = new Set(artifacts.map((a) => a.digest));
  const repos = [...new Set(artifacts.map((a) => `${ a.project }/${ a.repo }`))];

  await mapLimit(repos, REPO_CONCURRENCY, async(name) => {
    const { project, repo } = splitProjectRepo(name) as { project: string; repo: string };
    const affected = new Set(artifacts.filter((a) => a.project === project && a.repo === repo).map((a) => a.digest));
    const list = await client.artifacts(project, repo);

    list.forEach((index) => {
      if ((index.references || []).some((r) => affected.has(r.child_digest))) {
        digests.add(index.digest);

        // Platform manifests are usually untagged, show the index tags instead
        artifacts
          .filter((a) => a.project === project && a.repo === repo && !a.tags.length && index.references?.some((r) => r.child_digest === a.digest))
          .forEach((a) => {
            a.tags = tagNames(index);
          });
      }
    });
  });

  return { artifacts, digests: [...digests] };
}
