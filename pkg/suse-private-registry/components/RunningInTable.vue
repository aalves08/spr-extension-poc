<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useStore } from 'vuex';
import { Banner } from '@components/Banner';
import SortableTable from '@shell/components/SortableTable/index.vue';
import { useSprI18n } from '../composables/useSprI18n';
import { RunningInRow, useRunningIn } from '../composables/useImageMatching';

/**
 * Search every ready cluster for pods running one of `digests` (on demand, can be slow on big fleets).
 */
const props = withDefaults(defineProps<{
  host: string;
  digests: string[];
  /** Search as soon as it's shown (dialogs opened for this purpose) */
  autoStart?: boolean;
  /** Add the Repository column (digests of several repositories) */
  showRepository?: boolean;
}>(), { autoStart: false, showRepository: false });

const emit = defineEmits<{(e: 'navigate'): void}>();

const store = useStore();
const { t } = useSprI18n(store);
const {
  running, progress, rows, failedClusters, searched, search
} = useRunningIn();

const columns = [
  {
    name: 'cluster', labelKey: 'spr.runningIn.headers.cluster', value: 'clusterName', sort: ['clusterName']
  },
  {
    name: 'namespace', labelKey: 'spr.runningIn.headers.namespace', value: 'namespace', sort: ['namespace']
  },
  {
    name: 'workload', labelKey: 'spr.runningIn.headers.workload', value: 'workload', sort: ['workload']
  },
  {
    name: 'kind', labelKey: 'spr.runningIn.headers.kind', value: 'kind', sort: ['kind']
  },
  {
    name: 'container', labelKey: 'spr.runningIn.headers.container', value: 'container', sort: ['container']
  },
  {
    name: 'repository', labelKey: 'spr.runningIn.headers.repository', value: 'repository', sort: ['repository']
  },
  {
    name: 'pods', labelKey: 'spr.runningIn.headers.pods', value: 'pods', sort: ['pods'], width: 80
  },
];

const headers = computed(() => (props.showRepository ? columns : columns.filter((c) => c.name !== 'repository')));

function workloadRoute(row: RunningInRow) {
  return {
    name:   'c-cluster-product-resource-namespace-id',
    params: {
      cluster:   row.clusterId,
      product:   'explorer',
      resource:  row.resourceType,
      namespace: row.namespace,
      id:        row.workload,
    },
  };
}

const progressLabel = computed(() => t('spr.runningIn.progress', { done: progress.value.done, total: progress.value.total }));

onMounted(() => {
  if (props.autoStart && props.digests.length) {
    search(props.host, props.digests);
  }
});
</script>

<template>
  <div data-testid="spr-running-in">
    <div class="spr-running-in__toolbar">
      <p class="text-muted">
        {{ t('spr.runningIn.description') }}
      </p>
      <button
        type="button"
        class="btn role-primary"
        :disabled="running || !props.digests.length"
        data-testid="spr-running-in-search"
        @click="search(props.host, props.digests)"
      >
        <i
          v-if="running"
          class="icon icon-spinner icon-spin mr-5"
        />
        {{ running ? progressLabel : t(searched ? 'spr.runningIn.searchAgain' : 'spr.runningIn.search') }}
      </button>
    </div>

    <Banner
      v-if="failedClusters.length"
      color="warning"
      :label="t('spr.runningIn.failed', { clusters: failedClusters.join(', ') })"
    />

    <SortableTable
      v-if="searched || running"
      :headers="headers"
      :rows="rows"
      key-field="key"
      :loading="running && !rows.length"
      :table-actions="false"
      :row-actions="false"
      :search="false"
      no-rows-key="spr.runningIn.none"
      default-sort-by="cluster"
    >
      <template #cell:workload="{ row }">
        <router-link
          :to="workloadRoute(row)"
          @click="emit('navigate')"
        >
          {{ row.workload }}
        </router-link>
      </template>
    </SortableTable>
  </div>
</template>

<style lang="scss" scoped>
.spr-running-in__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 15px;

  p {
    margin: 0;
  }
}
</style>
