import { ref, Ref } from 'vue';
import { Store, useStore } from 'vuex';
import { CLUSTER_CONCURRENCY } from '../config/constants';
import { Connection } from '../types/connection';
import { HarborArtifact } from '../types/harbor';
import { mapLimit } from '../utils/async';
import { ImageRef, parseImageRef, splitProjectRepo } from '../utils/image-ref';
import { HarborClient } from './useHarbor';
import { readyClusters, steveList } from './useSprDiscovery';

export interface ContainerImage {
  container: string;
  init: boolean;
  image: string;
  /** Resolved image id from a running pod, if any */
  imageID?: string;
  ref?: ImageRef;
}

export interface MatchedImage extends ContainerImage {
  connection?: Connection;
  project?: string;
  repo?: string;
  /** Digest if known, else tag */
  reference?: string;
}

/** Pod spec of a workload or pod model / plain object */
export function podSpecOf(resource: any): any {
  switch (resource?.type) {
  case 'pod':
    return resource.spec;
  case 'batch.cronjob':
    return resource.spec?.jobTemplate?.spec?.template?.spec;
  default:
    return resource?.spec?.template?.spec;
  }
}

/**
 * Containers (init first) with their spec image and, when a pod is available, the resolved imageID.
 */
export function containerImages(podSpec: any, pod?: any): ContainerImage[] {
  const statuses: Record<string, string> = {};

  [...(pod?.status?.initContainerStatuses || []), ...(pod?.status?.containerStatuses || [])].forEach((s: any) => {
    if (s?.name && s.imageID) {
      statuses[s.name] = s.imageID;
    }
  });

  const build = (c: any, init: boolean): ContainerImage => {
    const imageID = statuses[c.name];
    const fromId = parseImageRef(imageID);
    const fromSpec = parseImageRef(c.image);

    // Prefer the resolved digest, keep the spec tag for display
    const ref = fromId?.digest ? { ...fromId, tag: fromSpec?.tag } : fromSpec;

    return {
      container: c.name, init, image: c.image, imageID, ref
    };
  };

  return [
    ...(podSpec?.initContainers || []).map((c: any) => build(c, true)),
    ...(podSpec?.containers || []).map((c: any) => build(c, false)),
  ];
}

export function matchConnection(ref: ImageRef | undefined, connections: Connection[]): Connection | undefined {
  if (!ref) {
    return undefined;
  }

  return connections.find((c) => c.host && c.host === ref.host);
}

export function matchImage(image: ContainerImage, connections: Connection[]): MatchedImage {
  const connection = matchConnection(image.ref, connections);
  const split = image.ref ? splitProjectRepo(image.ref.path) : undefined;

  if (!connection || !split) {
    return { ...image };
  }

  return {
    ...image,
    connection,
    project:   split.project,
    repo:      split.repo,
    reference: image.ref?.digest || image.ref?.tag,
  };
}

function selectorFromMatchLabels(matchLabels?: Record<string, string>): string | undefined {
  if (!matchLabels || !Object.keys(matchLabels).length) {
    return undefined;
  }

  return Object.entries(matchLabels).map(([k, v]) => `${ k }=${ v }`).join(',');
}

/**
 * Pods of a workload in the current cluster. Returns `[resource]` for pods.
 */
export async function podsForResource(store: Store<any>, clusterId: string, resource: any): Promise<any[]> {
  if (resource?.type === 'pod') {
    return [resource];
  }

  const namespace = resource?.metadata?.namespace;
  const base = `/k8s/clusters/${ clusterId }/v1/pods/${ encodeURIComponent(namespace) }?exclude=metadata.managedFields`;

  if (resource?.type === 'batch.cronjob') {
    const res = await store.dispatch('management/request', { url: base, redirectUnauthorized: false });
    const prefix = `${ resource.metadata?.name }-`;

    return (res?.data || []).filter((p: any) => (p.metadata?.labels?.['job-name'] || '').startsWith(prefix));
  }

  const selector = selectorFromMatchLabels(resource?.spec?.selector?.matchLabels);

  if (!selector) {
    return [];
  }

  const res = await store.dispatch('management/request', {
    url:                  `${ base }&labelSelector=${ encodeURIComponent(selector) }`,
    redirectUnauthorized: false,
  });

  return res?.data || [];
}

// Session cache: `<connection>|<project>/<repo>@<reference>` -> artifact
const artifactCache = new Map<string, Promise<HarborArtifact>>();

export function fetchArtifactCached(client: HarborClient, project: string, repo: string, reference: string): Promise<HarborArtifact> {
  const key = `${ client.target.id }|${ project }/${ repo }@${ reference }`;
  let hit = artifactCache.get(key);

  if (!hit) {
    hit = client.artifact(project, repo, reference);
    hit.catch(() => artifactCache.delete(key));
    artifactCache.set(key, hit);
  }

  return hit;
}

export interface RunningInRow {
  key: string;
  clusterId: string;
  clusterName: string;
  namespace: string;
  workload: string;
  kind: string;
  /** Explorer resource type for the detail link */
  resourceType: string;
  container: string;
  /** Image path in the registry (`<project>/<repo>`) */
  repository: string;
  pods: number;
}

export function ownerWorkload(pod: any): { kind: string; name: string; resourceType: string } {
  const owner = (pod.metadata?.ownerReferences || []).find((o: any) => o.controller) || pod.metadata?.ownerReferences?.[0];

  if (!owner) {
    return {
      kind: 'Pod', name: pod.metadata?.name, resourceType: 'pod'
    };
  }

  if (owner.kind === 'ReplicaSet') {
    const hash = pod.metadata?.labels?.['pod-template-hash'];
    const name = hash && owner.name.endsWith(`-${ hash }`) ? owner.name.substring(0, owner.name.length - hash.length - 1) : owner.name;

    return {
      kind: 'Deployment', name, resourceType: 'apps.deployment'
    };
  }

  const types: Record<string, string> = {
    StatefulSet: 'apps.statefulset',
    DaemonSet:   'apps.daemonset',
    Job:         'batch.job',
  };

  return {
    kind: owner.kind, name: owner.name, resourceType: types[owner.kind] || 'pod'
  };
}

/**
 * Search all ready clusters for pods running any of `digests`. Heavy by design, on demand only.
 */
export function useRunningIn() {
  const store = useStore();

  const running = ref(false);
  const progress = ref({ done: 0, total: 0 });
  const rows: Ref<RunningInRow[]> = ref([]);
  const failedClusters: Ref<string[]> = ref([]);
  const searched = ref(false);

  async function search(host: string, digests: string[]): Promise<void> {
    running.value = true;
    rows.value = [];
    failedClusters.value = [];

    const wanted = new Set(digests.filter(Boolean));

    try {
      const clusters = await readyClusters(store);

      progress.value = { done: 0, total: clusters.length };

      const results = await mapLimit(clusters, CLUSTER_CONCURRENCY, async(cluster) => {
        const pods = await steveList(store, cluster.id, 'pod');
        const grouped: Record<string, RunningInRow> = {};

        pods.forEach((pod: any) => {
          const statuses = [...(pod.status?.initContainerStatuses || []), ...(pod.status?.containerStatuses || [])];

          statuses.forEach((s: any) => {
            const ref = parseImageRef(s.imageID);

            if (!ref?.digest || !wanted.has(ref.digest) || ref.host !== host) {
              return;
            }

            const owner = ownerWorkload(pod);
            const key = `${ cluster.id }/${ pod.metadata?.namespace }/${ owner.kind }/${ owner.name }/${ s.name }`;
            const row = grouped[key] || {
              key,
              clusterId:    cluster.id,
              clusterName:  cluster.name,
              namespace:    pod.metadata?.namespace,
              workload:     owner.name,
              kind:         owner.kind,
              resourceType: owner.resourceType,
              container:    s.name,
              repository:   ref.path,
              pods:         0,
            };

            row.pods++;
            grouped[key] = row;
          });
        });

        rows.value = [...rows.value, ...Object.values(grouped)];
      }, (done, total) => {
        progress.value = { done, total };
      });

      failedClusters.value = clusters.filter((_c, i) => !!results[i]?.error).map((c) => c.name);
    } finally {
      running.value = false;
      searched.value = true;
    }
  }

  return {
    running,
    progress,
    rows,
    failedClusters,
    searched,
    search,
  };
}
