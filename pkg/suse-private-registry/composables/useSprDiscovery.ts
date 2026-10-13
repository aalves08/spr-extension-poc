import { ref, Ref } from 'vue';
import { Store, useStore } from 'vuex';
import { MANAGEMENT } from '@shell/config/types';
import { CLUSTER_CONCURRENCY, SPR_CHART_NAMES } from '../config/constants';
import { SprInstall } from '../types/connection';
import { mapLimit } from '../utils/async';

export interface ClusterRef {
  id: string;
  name: string;
}

/**
 * Clusters the user can see that are ready (downstream requests to others would just fail).
 */
export async function readyClusters(store: Store<any>): Promise<ClusterRef[]> {
  const clusters: any[] = await store.dispatch('management/findAll', { type: MANAGEMENT.CLUSTER });

  return clusters
    .filter((c) => c.isReady)
    .map((c) => ({ id: c.id, name: c.nameDisplay || c.spec?.displayName || c.id }));
}

export async function steveList(store: Store<any>, clusterId: string, type: string, namespace?: string): Promise<any[]> {
  const ns = namespace ? `/${ encodeURIComponent(namespace) }` : '';
  const res = await store.dispatch('management/request', {
    url:                  `/k8s/clusters/${ clusterId }/v1/${ type }${ ns }?exclude=metadata.managedFields`,
    redirectUnauthorized: false,
  });

  return res?.data || [];
}

// Only user values: chart defaults hold the placeholder https://core.harbor.domain
function externalUrlFromValues(app: any): string | undefined {
  const url = app.spec?.values?.externalURL;

  return typeof url === 'string' && url.startsWith('http') ? url : undefined;
}

async function externalUrlFromIngress(store: Store<any>, clusterId: string, namespace: string, release: string): Promise<string | undefined> {
  try {
    const ingresses = await steveList(store, clusterId, 'networking.k8s.io.ingresses', namespace);
    const forRelease = ingresses.filter((i) => {
      const labels = i.metadata?.labels || {};

      return labels.release === release || labels['app.kubernetes.io/instance'] === release || i.metadata?.name?.startsWith(release);
    });
    const ingress = forRelease[0] || ingresses[0];
    const host = ingress?.spec?.rules?.find((r: any) => r.host)?.host;

    return host ? `https://${ host }` : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Find SPR Helm installs (`suse-private-registry` chart) across clusters. On demand only: this fans out to every cluster.
 */
export function useSprDiscovery() {
  const store = useStore();

  const running = ref(false);
  const progress = ref({ done: 0, total: 0 });
  const installs: Ref<SprInstall[]> = ref([]);
  const failedClusters: Ref<ClusterRef[]> = ref([]);
  const error: Ref<any> = ref(null);

  async function discover(): Promise<SprInstall[]> {
    running.value = true;
    error.value = null;
    installs.value = [];
    failedClusters.value = [];

    try {
      const clusters = await readyClusters(store);

      progress.value = { done: 0, total: clusters.length };

      const results = await mapLimit(clusters, CLUSTER_CONCURRENCY, async(cluster) => {
        const apps = await steveList(store, cluster.id, 'catalog.cattle.io.apps');
        const spr = apps.filter((a) => SPR_CHART_NAMES.includes(a.spec?.chart?.metadata?.name));

        const found = await Promise.all(spr.map(async(app): Promise<SprInstall> => {
          const namespace = app.metadata?.namespace;
          const releaseName = app.spec?.name || app.metadata?.name;

          return {
            clusterId:    cluster.id,
            clusterName:  cluster.name,
            namespace,
            releaseName,
            chartVersion: app.spec?.chart?.metadata?.version,
            appVersion:   app.spec?.chart?.metadata?.appVersion,
            externalUrl:  externalUrlFromValues(app) || await externalUrlFromIngress(store, cluster.id, namespace, releaseName),
          };
        }));

        installs.value = [...installs.value, ...found];

        return found;
      }, (done, total) => {
        progress.value = { done, total };
      });

      failedClusters.value = clusters.filter((_c, i) => !!results[i]?.error);
    } catch (e) {
      error.value = e;
    } finally {
      running.value = false;
    }

    return installs.value;
  }

  return {
    running,
    progress,
    installs,
    failedClusters,
    error,
    discover,
  };
}
