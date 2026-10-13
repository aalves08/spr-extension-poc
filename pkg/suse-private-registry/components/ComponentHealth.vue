<script setup lang="ts">
import {
  computed, onMounted, ref, Ref, watch
} from 'vue';
import { useStore } from 'vuex';
import { Banner } from '@components/Banner';
import RcCounterBadge from '@components/Pill/RcCounterBadge';
import Loading from '@shell/components/Loading.vue';
import SortableTable from '@shell/components/SortableTable/index.vue';
import { MANAGEMENT } from '@shell/config/types';
import { useSprI18n } from '../composables/useSprI18n';
import { Connection } from '../types/connection';
import { HarborComponentHealth, HarborHealth } from '../types/harbor';
import { HarborClient } from '../composables/useHarbor';
import { ComponentHealthRow, PvcRow, useLinkedInstallHealth } from '../composables/useLinkedInstallHealth';
import UnavailableCard from './UnavailableCard.vue';
import StatusPill from './StatusPill.vue';

/**
 * Linked install: component pods + PVCs from the cluster, combined with Harbor's own `/health` checks.
 * Otherwise only Harbor's `/health`.
 */
const props = defineProps<{
  connection: Connection;
  client: HarborClient;
}>();

const emit = defineEmits<{
  /** Healthy / total components for the overview stat: undefined while loading, null when unavailable */
  summary: [value: { healthy: number; total: number } | null | undefined];
}>();

type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

interface HealthRow extends Partial<ComponentHealthRow> {
  component: string;
  checks: HarborComponentHealth[];
  status: HealthStatus;
  statusRank: number;
  checkError?: string;
}

const STATUS_RANK: Record<HealthStatus, number> = {
  unhealthy: 0, degraded: 1, healthy: 2
};

// StatusPill colours
const STATUS_PILL: Record<HealthStatus, string> = {
  healthy: 'success', degraded: 'pending', unhealthy: 'error'
};

// Harbor checks that run inside another component's pod
const CHECK_ALIASES: Record<string, string> = { registryctl: 'registry' };

const ACCESS_MODES: Record<string, string> = {
  ReadWriteOnce:    'RWO',
  ReadOnlyMany:     'ROX',
  ReadWriteMany:    'RWX',
  ReadWriteOncePod: 'RWOP',
};

const store = useStore();
const { t } = useSprI18n(store);

const linked = computed(() => !!props.connection.linkedCluster && !!props.connection.linkedNamespace);
const k8s = useLinkedInstallHealth();

const harborHealth: Ref<HarborHealth | null> = ref(null);
const harborError: Ref<any> = ref(null);
const harborLoading = ref(false);

async function loadHarbor(force: boolean) {
  harborLoading.value = true;
  harborError.value = null;

  try {
    harborHealth.value = await props.client.health({ force });
  } catch (e) {
    harborHealth.value = null;
    harborError.value = e;
  } finally {
    harborLoading.value = false;
  }
}

function load(force = false) {
  loadHarbor(force);

  if (linked.value) {
    k8s.load(props.connection);
  }
}

function checkStatus(checks: HarborComponentHealth[]): HealthStatus | undefined {
  if (!checks.length) {
    return undefined;
  }

  return checks.some((c) => c.status !== 'healthy') ? 'unhealthy' : 'healthy';
}

function withStatus(row: Omit<HealthRow, 'status' | 'statusRank'>): HealthRow {
  let status: HealthStatus = checkStatus(row.checks) || 'healthy';

  if (row.total !== undefined) {
    if (!row.ready) {
      status = 'unhealthy';
    } else if (row.ready < row.total && status === 'healthy') {
      status = 'degraded';
    }
  }

  return {
    ...row,
    status,
    statusRank: STATUS_RANK[status],
    checkError: row.checks.map((c) => c.error).filter(Boolean).join('\n') || undefined,
  };
}

const rows = computed<HealthRow[]>(() => {
  const checks = harborHealth.value?.components || [];

  if (!linked.value) {
    return checks.map((c) => withStatus({ component: c.name, checks: [c] }));
  }

  const byComponent: Record<string, HarborComponentHealth[]> = {};

  checks.forEach((c) => {
    const key = CHECK_ALIASES[c.name] || c.name;

    (byComponent[key] = byComponent[key] || []).push(c);
  });

  const podRows = k8s.components.value.map((r) => withStatus({ ...r, checks: byComponent[r.component] || [] }));
  const known = new Set(podRows.map((r) => r.component));
  // Checked by Harbor but no pod found (e.g. an external database)
  const checkOnly = Object.entries(byComponent)
    .filter(([component]) => !known.has(component))
    .map(([component, list]) => withStatus({ component, checks: list }));

  return [...podRows, ...checkOnly];
});

// Linked: Harbor's checks are an extra, a failure there only leaves the "Health check" column empty
const loading = computed(() => harborLoading.value || (linked.value && k8s.loading.value));
const error = computed(() => (linked.value ? k8s.error.value : harborError.value));
const loaded = computed(() => (linked.value ? k8s.loaded.value : !!harborHealth.value || !!harborError.value));
const unhealthy = computed(() => rows.value.filter((r) => r.status !== 'healthy'));

const summary = computed(() => {
  if (loading.value || !loaded.value) {
    return undefined;
  }

  if (error.value) {
    return null;
  }

  return { healthy: rows.value.length - unhealthy.value.length, total: rows.value.length };
});

const clusterName = computed(() => {
  const id = props.connection.linkedCluster;

  return (id && store.getters['management/byId'](MANAGEMENT.CLUSTER, id)?.nameDisplay) || id || '';
});

const chartVersion = computed(() => k8s.app.value?.spec?.chart?.metadata?.version);

function explorerRoute(resource: string, id: string, namespaced = true) {
  return {
    name:   namespaced ? 'c-cluster-product-resource-namespace-id' : 'c-cluster-product-resource-id',
    params: {
      cluster:   props.connection.linkedCluster,
      product:   'explorer',
      resource,
      id,
      ...(namespaced ? { namespace: props.connection.linkedNamespace } : {}),
    },
  };
}

/** `registry.suse.com/private-registry/harbor-core:1.1.3` -> `harbor-core:1.1.3` */
function shortImage(image: string): string {
  return image.substring(image.lastIndexOf('/') + 1);
}

function pvcStatus(pvc: PvcRow): string {
  if (pvc.phase === 'Bound') {
    return 'success';
  }

  return pvc.phase === 'Lost' ? 'error' : 'pending';
}

const componentHeaders = computed(() => [
  {
    name: 'status', labelKey: 'spr.health.headers.status', value: 'statusRank', sort: ['statusRank', 'component'], width: 120
  },
  {
    name: 'component', labelKey: 'spr.health.headers.component', value: 'component', sort: ['component']
  },
  ...(linked.value ? [
    {
      name: 'pods', labelKey: 'spr.health.headers.pods', value: 'ready', sort: ['ready', 'total'], width: 100
    },
    { name: 'check', labelKey: 'spr.health.headers.check' },
    {
      name: 'restarts', labelKey: 'spr.health.headers.restarts', value: 'restarts', sort: ['restarts:desc'], width: 100
    },
    { name: 'version', labelKey: 'spr.health.headers.version' },
    {
      name: 'started', labelKey: 'spr.health.headers.started', value: 'started', formatter: 'LiveDate', sort: ['started:desc'], width: 120
    },
  ] : [
    { name: 'check', labelKey: 'spr.health.headers.check' },
  ]),
]);

const pvcHeaders = [
  {
    name: 'status', labelKey: 'spr.health.headers.status', value: 'phase', sort: ['phase', 'name'], width: 120
  },
  {
    name: 'name', labelKey: 'spr.health.headers.name', value: 'name', sort: ['name']
  },
  {
    name: 'component', labelKey: 'spr.health.headers.component', value: 'component', sort: ['component']
  },
  {
    name: 'capacity', labelKey: 'spr.health.headers.capacity', value: 'capacity', sort: ['capacity'], width: 100
  },
  {
    name: 'storageClass', labelKey: 'spr.health.headers.storageClass', value: 'storageClass', sort: ['storageClass']
  },
  {
    name: 'accessModes', labelKey: 'spr.health.headers.accessModes', width: 120
  },
];

onMounted(() => load());
watch(() => props.connection.id, () => load());
watch(summary, (value) => emit('summary', value), { immediate: true });
</script>

<template>
  <div data-testid="spr-component-health">
    <div class="spr-health__header">
      <p
        v-if="linked"
        class="text-deemphasized"
      >
        {{ t('spr.health.linkedSource') }}
        <router-link :to="{ name: 'c-cluster-explorer', params: { cluster: props.connection.linkedCluster } }">
          {{ clusterName }}
        </router-link>
        /
        <router-link :to="explorerRoute('namespace', props.connection.linkedNamespace || '', false)">
          {{ props.connection.linkedNamespace }}
        </router-link>
        <template v-if="chartVersion">
          &middot; {{ t('spr.health.chartVersion', { version: chartVersion }) }}
        </template>
      </p>
      <p
        v-else
        class="text-deemphasized"
      >
        {{ t('spr.health.registrySource') }}
      </p>
      <button
        type="button"
        class="btn btn-sm role-link"
        :disabled="loading"
        data-testid="spr-component-health-refresh"
        @click="load(true)"
      >
        <i
          class="icon icon-refresh mr-5"
          :class="{ 'icon-spin': loading }"
        />{{ t('spr.health.refresh') }}
      </button>
    </div>

    <Loading
      v-if="!loaded"
      mode="relative"
    />
    <UnavailableCard
      v-else-if="error"
      :error="error"
    />
    <template v-else>
      <Banner
        v-if="unhealthy.length"
        color="error"
        :label="t('spr.health.unhealthyBanner', { count: unhealthy.length, names: unhealthy.map((r) => r.component).join(', ') })"
        data-testid="spr-component-health-banner"
      />

      <div class="spr-health__section">
        <h3>{{ t('spr.health.components') }}</h3>
        <RcCounterBadge
          :count="rows.length"
          type="inactive"
        />
      </div>
      <SortableTable
        :headers="componentHeaders"
        :rows="rows"
        key-field="component"
        :search="false"
        :table-actions="false"
        :row-actions="false"
        default-sort-by="status"
        :no-rows-key="linked ? 'spr.health.noPods' : 'spr.health.noChecks'"
        data-testid="spr-component-health-components"
      >
        <template #cell:status="{ row }">
          <StatusPill
            :status="STATUS_PILL[row.status as HealthStatus]"
            :label="t(`spr.health.status.${ row.status }`)"
          />
        </template>
        <template #cell:component="{ row }">
          <router-link
            v-if="linked && row.workload"
            v-clean-tooltip="row.workload.name"
            :to="explorerRoute(row.workload.type, row.workload.name)"
          >
            {{ row.component }}
          </router-link>
          <span v-else>{{ row.component }}</span>
        </template>
        <template #cell:pods="{ row }">
          <span
            v-if="row.total !== undefined"
            :class="{ 'text-error': row.ready < row.total }"
          >{{ row.ready }}/{{ row.total }}</span>
          <span
            v-else
            v-clean-tooltip="t('spr.health.noPodTooltip')"
            class="text-muted"
          >&mdash;</span>
        </template>
        <template #cell:check="{ row }">
          <span
            v-if="!row.checks.length"
            v-clean-tooltip="t('spr.health.noCheckTooltip')"
            class="text-muted"
          >&mdash;</span>
          <span
            v-else-if="row.checkError || row.checks.some((c: HarborComponentHealth) => c.status !== 'healthy')"
            class="text-error spr-health__check"
          >
            <i class="icon icon-error mr-5" />
            <span
              v-clean-tooltip="row.checkError"
              class="spr-health__check-text"
            >{{ row.checkError || t('spr.health.check.failing') }}</span>
          </span>
          <span
            v-else
            class="text-success"
          ><i class="icon icon-checkmark mr-5" />{{ t('spr.health.check.passing') }}</span>
        </template>
        <template #cell:restarts="{ row }">
          <span
            v-if="row.restarts !== undefined"
            :class="{ 'text-warning': row.restarts > 0 }"
          >{{ row.restarts }}</span>
          <span
            v-else
            class="text-muted"
          >&mdash;</span>
        </template>
        <template #cell:version="{ row }">
          <div
            v-if="row.images?.length"
            v-clean-tooltip="row.images.join('\n')"
            class="spr-health__images"
          >
            <code
              v-for="image in row.images"
              :key="image"
            >{{ shortImage(image) }}</code>
          </div>
          <span
            v-else
            class="text-muted"
          >&mdash;</span>
        </template>
      </SortableTable>

      <template v-if="linked && k8s.pvcs.value.length">
        <div class="spr-health__section mt-30">
          <h3>{{ t('spr.health.pvcs') }}</h3>
          <RcCounterBadge
            :count="k8s.pvcs.value.length"
            type="inactive"
          />
        </div>
        <SortableTable
          :headers="pvcHeaders"
          :rows="k8s.pvcs.value"
          key-field="name"
          :search="false"
          :table-actions="false"
          :row-actions="false"
          default-sort-by="component"
          data-testid="spr-component-health-pvcs"
        >
          <template #cell:status="{ row }">
            <StatusPill
              :status="pvcStatus(row)"
              :label="row.phase"
            />
          </template>
          <template #cell:name="{ row }">
            <router-link :to="explorerRoute('persistentvolumeclaim', row.name)">
              {{ row.name }}
            </router-link>
          </template>
          <template #cell:component="{ row }">
            {{ row.component || '—' }}
          </template>
          <template #cell:capacity="{ row }">
            {{ row.capacity || '—' }}
          </template>
          <template #cell:storageClass="{ row }">
            {{ row.storageClass || '—' }}
          </template>
          <template #cell:accessModes="{ row }">
            <span v-clean-tooltip="row.accessModes.join(', ')">{{ row.accessModes.map((m: string) => ACCESS_MODES[m] || m).join(', ') || '—' }}</span>
          </template>
        </SortableTable>
      </template>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.spr-health__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;

  p {
    margin: 0;
  }
}

.spr-health__section {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;

  h3 {
    margin: 0;
    font-size: 18px;
  }
}

.spr-health__images {
  display: flex;
  flex-direction: column;
  gap: 2px;

  code {
    width: fit-content;
    font-size: 12px;
  }
}

.spr-health__check {
  display: inline-flex;
  align-items: center;
  max-width: 320px;
}

.spr-health__check-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
