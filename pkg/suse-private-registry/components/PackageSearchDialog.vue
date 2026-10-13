<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import { Card } from '@components/Card';
import { Banner } from '@components/Banner';
import { LabeledInput } from '@components/Form/LabeledInput';
import SortableTable from '@shell/components/SortableTable/index.vue';
import { useSprI18n } from '../composables/useSprI18n';
import { Connection } from '../types/connection';
import { SEARCH_PHASE, usePackageSearch } from '../composables/usePackageSearch';
import { artifactRoute } from '../utils/artifact';
import { shortDigest } from '../utils/image-ref';
import { errorMessage, explorerResourceRoute } from '../utils/k8s';

/**
 * "Who runs package X?": workloads in every ready cluster whose SPR image SBOM contains a package.
 */
const props = withDefaults(defineProps<{
  connection: Connection;
  /** Prefill and search straight away */
  packageName?: string;
  packageVersion?: string;
}>(), { packageName: '', packageVersion: '' });

const emit = defineEmits<{(e: 'close'): void}>();

const store = useStore();
const { t } = useSprI18n(store);
const {
  running, searched, phase, progress, rows, failedClusters, uncovered, coverage, search
} = usePackageSearch();

const name = ref(props.packageName);
const version = ref(props.packageVersion);
const error = ref<string | null>(null);
const showUncovered = ref(false);
/** What the results are for (the inputs may have changed since) */
const query = ref('');

const headers = [
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
    name: 'container', labelKey: 'spr.runningIn.headers.container', value: 'container', sort: ['container']
  },
  {
    name: 'repository', labelKey: 'spr.runningIn.headers.repository', value: 'repository', sort: ['repository']
  },
  {
    name: 'packages', labelKey: 'spr.packageSearch.headers.packages', value: 'packages', sort: ['packages']
  },
  {
    name: 'pods', labelKey: 'spr.runningIn.headers.pods', value: 'pods', sort: ['pods'], width: 70
  },
];

const workloads = computed(() => new Set(rows.value.map((r) => `${ r.clusterId }/${ r.namespace }/${ r.kind }/${ r.workload }`)).size);

const progressLabel = computed(() => t(
  phase.value === SEARCH_PHASE.CLUSTERS ? 'spr.packageSearch.progress.clusters' : 'spr.packageSearch.progress.sboms',
  { done: progress.value.done, total: progress.value.total }
));

async function run() {
  if (!name.value.trim() || running.value) {
    return;
  }

  error.value = null;
  showUncovered.value = false;
  query.value = [name.value.trim(), version.value.trim()].filter(Boolean).join(' ');

  try {
    await search(props.connection, name.value, version.value);
  } catch (e) {
    error.value = errorMessage(e);
  }
}

onMounted(() => {
  if (props.packageName) {
    run();
  }
});
</script>

<template>
  <Card
    :show-highlight-border="false"
    data-testid="spr-package-search"
  >
    <template #title>
      <h4 class="text-default-text">
        {{ t('spr.packageSearch.title') }}
      </h4>
    </template>
    <template #body>
      <div class="spr-package-search__body">
        <p class="text-muted">
          {{ t('spr.packageSearch.description') }}
        </p>

        <form
          class="spr-package-search__form"
          @submit.prevent="run"
        >
          <LabeledInput
            v-model:value="name"
            :label="t('spr.packageSearch.name')"
            :placeholder="t('spr.packageSearch.namePlaceholder')"
            required
            data-testid="spr-package-search-name"
          />
          <LabeledInput
            v-model:value="version"
            :label="t('spr.packageSearch.version')"
            :tooltip="t('spr.packageSearch.versionTooltip')"
            data-testid="spr-package-search-version"
          />
          <button
            type="submit"
            class="btn role-primary"
            :disabled="running || !name.trim()"
            data-testid="spr-package-search-submit"
          >
            <i
              v-if="running"
              class="icon icon-spinner icon-spin mr-5"
            />
            {{ running ? progressLabel : t('spr.packageSearch.search') }}
          </button>
        </form>

        <Banner
          v-if="error"
          color="error"
          :label="error"
        />
        <Banner
          v-if="failedClusters.length"
          color="warning"
          :label="t('spr.runningIn.failed', { clusters: failedClusters.join(', ') })"
        />

        <template v-if="searched && !running && !error">
          <p v-if="!coverage.total">
            {{ t('spr.packageSearch.noImages') }}
          </p>
          <template v-else>
            <p>
              <strong>{{ t('spr.packageSearch.summary', { count: workloads, name: query }) }}</strong>
              {{ t('spr.packageSearch.coverage', { checked: coverage.checked, total: coverage.total }) }}
            </p>
            <div
              v-if="uncovered.length"
              class="spr-package-search__uncovered"
            >
              <a
                href="#"
                @click.prevent="showUncovered = !showUncovered"
              >{{ t(showUncovered ? 'spr.packageSearch.hideUncovered' : 'spr.packageSearch.showUncovered', { count: uncovered.length }) }}</a>
              <ul v-if="showUncovered">
                <li
                  v-for="u in uncovered"
                  :key="u.key"
                >
                  <router-link
                    :to="artifactRoute(props.connection.id, u.project, u.repo, u.digest)"
                    @click="emit('close')"
                  >
                    {{ u.project }}/{{ u.repo }}@{{ shortDigest(u.digest) }}
                  </router-link>
                  <span class="text-muted">{{ t(u.reason === 'error' ? 'spr.packageSearch.readFailed' : 'spr.packageSearch.noSbom') }}</span>
                </li>
              </ul>
            </div>
          </template>
          <p
            v-if="coverage.external"
            class="text-muted"
          >
            {{ t('spr.packageSearch.external', { count: coverage.external }) }}
          </p>
        </template>

        <SortableTable
          v-if="(searched || running) && !error && (running || coverage.total)"
          :headers="headers"
          :rows="rows"
          key-field="key"
          :loading="running"
          :table-actions="false"
          :row-actions="false"
          :search="false"
          no-rows-key="spr.packageSearch.none"
          default-sort-by="cluster"
        >
          <template #cell:workload="{ row }">
            <router-link
              :to="explorerResourceRoute(row.clusterId, row.resourceType, row.workload, row.namespace)"
              @click="emit('close')"
            >
              {{ row.workload }}
            </router-link>
            <span class="text-muted ml-5">{{ row.kind }}</span>
          </template>
        </SortableTable>
      </div>
    </template>
    <template #actions>
      <div class="spr-package-search__actions">
        <button
          type="button"
          class="btn role-secondary"
          @click="emit('close')"
        >
          {{ t('generic.close') }}
        </button>
      </div>
    </template>
  </Card>
</template>

<style lang="scss" scoped>
.spr-package-search__body {
  display: flex;
  flex-direction: column;
  gap: 15px;
  min-height: 120px;
  max-height: 70vh;
  overflow-y: auto;

  p {
    margin: 0;
  }
}

.spr-package-search__form {
  display: grid;
  grid-template-columns: 2fr 1fr auto;
  align-items: center;
  gap: 15px;
}

.spr-package-search__uncovered ul {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;

  li {
    display: flex;
    gap: 10px;
    padding: 2px 0;
  }
}

.spr-package-search__actions {
  display: flex;
  justify-content: flex-end;
  width: 100%;
}
</style>
