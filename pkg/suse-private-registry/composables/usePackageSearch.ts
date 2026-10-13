import { ref, Ref } from 'vue';
import { useStore } from 'vuex';
import { CLUSTER_CONCURRENCY } from '../config/constants';
import { Connection } from '../types/connection';
import { mapLimit } from '../utils/async';
import { parseImageRef, splitProjectRepo } from '../utils/image-ref';
import { SbomPackage, packageMatches, sbomPackages } from '../utils/sbom';
import { HarborClient, useHarbor } from './useHarbor';
import { RunningInRow, ownerWorkload } from './useImageMatching';
import { readyClusters, steveList } from './useSprDiscovery';

// Concurrent artifact / SBOM requests against SPR
const SBOM_CONCURRENCY = 5;

export const SEARCH_PHASE = {
  CLUSTERS: 'clusters',
  SBOMS:    'sboms',
} as const;

export type SearchPhase = typeof SEARCH_PHASE[keyof typeof SEARCH_PHASE];

export interface PackageRunningRow extends RunningInRow {
  /** Matched packages with their versions, e.g. `liblzma5 5.2.2-1.2` */
  packages: string;
}

/** A running SPR image whose packages couldn't be checked */
export interface UncoveredImage {
  key: string;
  project: string;
  repo: string;
  digest: string;
  reason: 'noSbom' | 'error';
}

interface RunningImage {
  key: string;
  project: string;
  repo: string;
  digest: string;
}

// SBOM accessories are immutable: `<connection>|<project>/<repo>@<sbom digest>` -> packages
const sbomCache = new Map<string, Promise<SbomPackage[]>>();

function cachedPackages(client: HarborClient, project: string, repo: string, sbomDigest: string): Promise<SbomPackage[]> {
  const key = `${ client.target.id }|${ project }/${ repo }@${ sbomDigest }`;
  let hit = sbomCache.get(key);

  if (!hit) {
    hit = client.sbom(project, repo, sbomDigest).then(sbomPackages);
    hit.catch(() => sbomCache.delete(key));
    sbomCache.set(key, hit);
  }

  return hit;
}

/**
 * Packages of a running image, or undefined when it has no SBOM. Pods of multi-arch images report the index digest:
 * use the SBOMs of its platform images then (the platform a pod runs isn't known here, so any of them counts).
 */
async function imagePackages(client: HarborClient, image: RunningImage): Promise<SbomPackage[] | undefined> {
  const artifact = await client.artifact(image.project, image.repo, image.digest);
  const own = artifact.sbom_overview?.sbom_digest;

  if (own) {
    return cachedPackages(client, image.project, image.repo, own);
  }

  const lists = await Promise.all((artifact.references || []).map(async(r) => {
    const child = await client.artifact(image.project, image.repo, r.child_digest);
    const digest = child.sbom_overview?.sbom_digest;

    return digest ? cachedPackages(client, image.project, image.repo, digest) : undefined;
  }));
  const found = lists.filter((l): l is SbomPackage[] => !!l);

  return found.length ? found.flat() : undefined;
}

/**
 * "Who runs package X?": list the SPR images running in every ready cluster, read their SBOMs and keep the workloads
 * whose image contains the package. Read-only, on demand; SBOMs are cached for the session.
 */
export function usePackageSearch() {
  const store = useStore();
  const { clientFor } = useHarbor();

  const running = ref(false);
  const searched = ref(false);
  const phase = ref<SearchPhase>(SEARCH_PHASE.CLUSTERS);
  const progress = ref({ done: 0, total: 0 });
  const rows: Ref<PackageRunningRow[]> = ref([]);
  const failedClusters: Ref<string[]> = ref([]);
  const uncovered: Ref<UncoveredImage[]> = ref([]);
  /** Distinct running images from this SPR, and how many of them had an SBOM */
  const coverage = ref({
    checked: 0, total: 0, external: 0
  });

  async function search(connection: Connection, name: string, version?: string): Promise<void> {
    running.value = true;
    rows.value = [];
    failedClusters.value = [];
    uncovered.value = [];
    coverage.value = {
      checked: 0, total: 0, external: 0
    };

    try {
      // 1. Containers running SPR images, grouped by workload + container + image
      const clusters = await readyClusters(store);
      const images = new Map<string, RunningImage>();
      const external = new Set<string>();
      const grouped = new Map<string, PackageRunningRow & { image: string }>();

      phase.value = SEARCH_PHASE.CLUSTERS;
      progress.value = { done: 0, total: clusters.length };

      const results = await mapLimit(clusters, CLUSTER_CONCURRENCY, async(cluster) => {
        const pods = await steveList(store, cluster.id, 'pod');

        pods.forEach((pod: any) => {
          [...(pod.status?.initContainerStatuses || []), ...(pod.status?.containerStatuses || [])].forEach((s: any) => {
            const ref = parseImageRef(s.imageID);

            if (!ref?.digest) {
              return;
            }

            if (ref.host !== connection.host) {
              external.add(`${ ref.host }/${ ref.path }@${ ref.digest }`);

              return;
            }

            const split = splitProjectRepo(ref.path);

            if (!split) {
              return;
            }

            const image = `${ ref.path }@${ ref.digest }`;
            const owner = ownerWorkload(pod);
            const key = `${ cluster.id }/${ pod.metadata?.namespace }/${ owner.kind }/${ owner.name }/${ s.name }/${ image }`;
            const row = grouped.get(key) || {
              key,
              image,
              clusterId:    cluster.id,
              clusterName:  cluster.name,
              namespace:    pod.metadata?.namespace,
              workload:     owner.name,
              kind:         owner.kind,
              resourceType: owner.resourceType,
              container:    s.name,
              repository:   ref.path,
              packages:     '',
              pods:         0,
            };

            row.pods++;
            grouped.set(key, row);
            images.set(image, {
              key: image, ...split, digest: ref.digest
            });
          });
        });
      }, (done, total) => {
        progress.value = { done, total };
      });

      failedClusters.value = clusters.filter((_c, i) => !!results[i]?.error).map((c) => c.name);

      // 2. SBOM of each distinct image
      const client = clientFor(connection);
      const list = [...images.values()];
      const matches = new Map<string, string>();

      phase.value = SEARCH_PHASE.SBOMS;
      progress.value = { done: 0, total: list.length };

      const checked = await mapLimit(list, SBOM_CONCURRENCY, async(image) => {
        const packages = await imagePackages(client, image);

        if (!packages) {
          return false;
        }

        const found = packages.filter((p) => packageMatches(p, name, version));

        if (found.length) {
          matches.set(image.key, [...new Set(found.map((p) => [p.name, p.version].filter(Boolean).join(' ')))].join(', '));
        }

        return true;
      }, (done, total) => {
        progress.value = { done, total };
      });

      uncovered.value = list.flatMap((image, i): UncoveredImage[] => {
        if (checked[i].error) {
          return [{ ...image, reason: 'error' }];
        }

        return checked[i].value ? [] : [{ ...image, reason: 'noSbom' }];
      });
      coverage.value = {
        checked: checked.filter((r) => r.value).length, total: list.length, external: external.size
      };

      // 3. Workloads running a matching image
      rows.value = [...grouped.values()]
        .filter((r) => matches.has(r.image))
        .map(({ image, ...row }) => ({ ...row, packages: matches.get(image) || '' }));
    } finally {
      running.value = false;
      searched.value = true;
    }
  }

  return {
    running,
    searched,
    phase,
    progress,
    rows,
    failedClusters,
    uncovered,
    coverage,
    search,
  };
}
