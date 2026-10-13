import { ref, Ref } from 'vue';
import { useStore } from 'vuex';
import { CATALOG } from '@shell/config/types';
import { Connection } from '../types/connection';
import { steveList } from './useSprDiscovery';

export interface ComponentHealthRow {
  component: string;
  ready: number;
  total: number;
  restarts: number;
  state: string;
  /** Owning Deployment / StatefulSet / DaemonSet, for links to the cluster explorer */
  workload?: { type: string; name: string };
  /** Distinct container images */
  images: string[];
  /** Most recent pod start */
  started?: string;
}

export interface PvcRow {
  name: string;
  phase: string;
  capacity?: string;
  storageClass?: string;
  accessModes: string[];
  component?: string;
}

const KNOWN_COMPONENTS = ['core', 'jobservice', 'registryctl', 'registry', 'portal', 'trivy', 'database', 'valkey', 'redis', 'exporter', 'nginx'];

function belongsToRelease(obj: any, release?: string): boolean {
  if (!release) {
    return true;
  }

  const labels = obj.metadata?.labels || {};

  if (labels.release || labels['app.kubernetes.io/instance']) {
    return labels.release === release || labels['app.kubernetes.io/instance'] === release;
  }

  return obj.metadata?.name?.startsWith(release);
}

function componentOf(pod: any, release?: string): string {
  const labels = pod.metadata?.labels || {};
  const fromLabel = labels.component || labels['app.kubernetes.io/component'];

  if (fromLabel) {
    return fromLabel;
  }

  const name: string = pod.metadata?.name || '';
  const rest = release && name.startsWith(`${ release }-`) ? name.substring(release.length + 1) : name;

  return KNOWN_COMPONENTS.find((c) => rest.startsWith(c)) || rest.split('-')[0] || name;
}

const WORKLOAD_TYPES: Record<string, string> = {
  Deployment:  'apps.deployment',
  StatefulSet: 'apps.statefulset',
  DaemonSet:   'apps.daemonset',
};

// ReplicaSets are named `<deployment>-<pod-template-hash>`
function workloadOf(pod: any): ComponentHealthRow['workload'] {
  const owner = (pod.metadata?.ownerReferences || []).find((o: any) => o.controller) || pod.metadata?.ownerReferences?.[0];

  if (!owner?.name) {
    return undefined;
  }

  if (owner.kind === 'ReplicaSet') {
    return { type: WORKLOAD_TYPES.Deployment, name: owner.name.replace(/-[a-z0-9]+$/, '') };
  }

  return WORKLOAD_TYPES[owner.kind] ? { type: WORKLOAD_TYPES[owner.kind], name: owner.name } : undefined;
}

/**
 * Pods and PVCs of a linked SPR install, grouped by component.
 */
export function useLinkedInstallHealth() {
  const store = useStore();

  const loading = ref(false);
  /** At least one load finished (successfully or not) */
  const loaded = ref(false);
  const error: Ref<any> = ref(null);
  const components: Ref<ComponentHealthRow[]> = ref([]);
  const pvcs: Ref<PvcRow[]> = ref([]);
  const app: Ref<any> = ref(null);

  async function load(connection: Connection): Promise<void> {
    if (!connection.linkedCluster || !connection.linkedNamespace) {
      return;
    }

    loading.value = true;
    error.value = null;

    try {
      const [pods, claims, apps] = await Promise.all([
        steveList(store, connection.linkedCluster, 'pod', connection.linkedNamespace),
        steveList(store, connection.linkedCluster, 'persistentvolumeclaim', connection.linkedNamespace),
        steveList(store, connection.linkedCluster, CATALOG.APP, connection.linkedNamespace).catch(() => []),
      ]);

      const release = connection.linkedApp;

      app.value = apps.find((a: any) => (a.spec?.name || a.metadata?.name) === release) || null;

      const grouped: Record<string, ComponentHealthRow> = {};

      pods.filter((p) => belongsToRelease(p, release)).forEach((pod) => {
        const component = componentOf(pod, release);
        const row: ComponentHealthRow = grouped[component] || {
          component, ready: 0, total: 0, restarts: 0, state: 'running', images: [], workload: workloadOf(pod)
        };
        const statuses: any[] = pod.status?.containerStatuses || [];
        const podReady = statuses.length > 0 && statuses.every((s) => s.ready);
        const podState = (pod.metadata?.state?.name || pod.status?.phase || '').toLowerCase();

        row.total++;
        row.ready += podReady ? 1 : 0;
        row.restarts += statuses.reduce((sum, s) => sum + (s.restartCount || 0), 0);
        (pod.spec?.containers || []).forEach((c: any) => {
          if (c.image && !row.images.includes(c.image)) {
            row.images.push(c.image);
          }
        });

        if (pod.status?.startTime && (!row.started || pod.status.startTime > row.started)) {
          row.started = pod.status.startTime;
        }

        if (!podReady && podState !== 'succeeded' && podState !== 'completed') {
          row.state = podState || 'unknown';
        }

        grouped[component] = row;
      });

      components.value = Object.values(grouped).sort((a, b) => a.component.localeCompare(b.component));

      pvcs.value = claims.filter((c) => belongsToRelease(c, release)).map((c) => ({
        name:         c.metadata?.name,
        phase:        c.status?.phase || 'Unknown',
        capacity:     c.status?.capacity?.storage || c.spec?.resources?.requests?.storage,
        storageClass: c.spec?.storageClassName,
        accessModes:  c.spec?.accessModes || [],
        component:    c.metadata?.labels?.component || c.metadata?.labels?.['app.kubernetes.io/component'],
      }));
    } catch (e) {
      error.value = e;
    } finally {
      loading.value = false;
      loaded.value = true;
    }
  }

  return {
    loading,
    loaded,
    error,
    components,
    pvcs,
    app,
    load,
  };
}
