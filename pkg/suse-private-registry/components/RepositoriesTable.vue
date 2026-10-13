<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { useStore } from 'vuex';
import SortableTable from '@shell/components/SortableTable/index.vue';
import { useSprI18n } from '../composables/useSprI18n';
import { HarborArtifact, HarborRepositoryRow, SCAN_TYPE } from '../types/harbor';
import { useActiveRegistry } from '../composables/useActiveRegistry';
import { useHarbor } from '../composables/useHarbor';
import { mapLimit } from '../utils/async';
import {
  artifactRoute, isScanActive, projectRoute, repositoryRoute, scanSummary, tagNames
} from '../utils/artifact';
import { shortDigest } from '../utils/image-ref';
import SeverityBar from './SeverityBar.vue';

/**
 * Repositories with their latest artifact and its vulnerabilities. Used by the Repositories page and a project's detail.
 */
const props = withDefaults(defineProps<{
  rows: HarborRepositoryRow[];
  loading?: boolean;
  /** Add the Project column (repositories of several projects) */
  showProject?: boolean;
  noRowsKey: string;
}>(), { loading: false, showProject: false });

// Concurrent latest-artifact requests
const LATEST_CONCURRENCY = 5;

const store = useStore();
const { t } = useSprI18n(store);
const { active } = useActiveRegistry();
const { clientFor } = useHarbor();

/** Latest artifact by repository id: undefined while loading, null if none / failed */
const latest = reactive<Record<number, HarborArtifact | null | undefined>>({});
let generation = 0;

async function loadLatest(rows: HarborRepositoryRow[]) {
  const gen = ++generation;

  Object.keys(latest).forEach((id) => delete latest[Number(id)]);

  if (!active.value) {
    return;
  }

  const client = clientFor(active.value);

  rows.filter((r) => !r.artifact_count).forEach((r) => {
    latest[r.id] = null;
  });

  await mapLimit(rows.filter((r) => !!r.artifact_count), LATEST_CONCURRENCY, async(r) => {
    if (gen !== generation) {
      return;
    }

    let artifact: HarborArtifact | null = null;

    try {
      artifact = (await client.latestArtifact(r.project, r.shortName)) || null;
    } catch {}

    if (gen === generation) {
      latest[r.id] = artifact;
    }
  });
}

watch(() => props.rows, (rows) => loadLatest(rows), { immediate: true });

// -1 sorts unscanned / empty repositories after scanned ones without findings
function severity(summary: Record<string, number> | undefined, sev: string): number {
  return summary ? summary[sev] || 0 : -1;
}

const tableRows = computed(() => props.rows.map((r) => {
  const artifact = latest[r.id];
  const tags = tagNames(artifact || undefined);
  const counts = scanSummary(artifact || undefined)?.summary?.summary;

  return {
    ...r,
    latest:       artifact,
    latestLabel:  artifact ? tags[0] || shortDigest(artifact.digest) : '',
    latestExtra:  Math.max(0, tags.length - 1),
    vulnCritical: severity(counts, 'Critical'),
    vulnHigh:     severity(counts, 'High'),
    vulnMedium:   severity(counts, 'Medium'),
    vulnLow:      severity(counts, 'Low'),
  };
}));

const headers = computed(() => [
  {
    name: 'name', labelKey: 'spr.repositories.headers.name', value: 'shortName', sort: ['shortName', 'project']
  },
  ...(props.showProject ? [{
    name: 'project', labelKey: 'spr.repositories.headers.project', value: 'project', sort: ['project', 'shortName']
  }] : []),
  {
    name: 'latest', labelKey: 'spr.repositories.headers.latest', value: 'latestLabel', sort: ['latestLabel']
  },
  {
    name:     'vulnerabilities',
    labelKey: 'spr.repositories.headers.vulnerabilities',
    tooltip:  'spr.repositories.vulnerabilitiesTooltip',
    value:    'vulnCritical',
    sort:     ['vulnCritical:desc', 'vulnHigh:desc', 'vulnMedium:desc', 'vulnLow:desc'],
  },
  {
    name: 'artifacts', labelKey: 'spr.repositories.headers.artifacts', value: 'artifact_count', sort: ['artifact_count'], width: 100
  },
  {
    name: 'pulls', labelKey: 'spr.repositories.headers.pulls', value: 'pull_count', sort: ['pull_count'], width: 100
  },
  {
    name: 'updated', labelKey: 'spr.repositories.headers.updated', value: 'update_time', formatter: 'LiveDate', sort: ['update_time:desc'], width: 140
  },
]);
</script>

<template>
  <SortableTable
    :headers="headers"
    :rows="tableRows"
    key-field="id"
    :loading="props.loading"
    :table-actions="false"
    :row-actions="false"
    default-sort-by="name"
    :no-rows-key="props.noRowsKey"
  >
    <template #cell:name="{ row }">
      <router-link
        v-if="active"
        :to="repositoryRoute(active.id, row.project, row.shortName)"
      >
        {{ row.shortName }}
      </router-link>
      <div
        v-if="row.description"
        v-clean-tooltip="row.description"
        class="spr-repo__description text-muted"
      >
        {{ row.description }}
      </div>
    </template>
    <template #cell:project="{ row }">
      <router-link
        v-if="active"
        :to="projectRoute(active.id, row.project)"
      >
        {{ row.project }}
      </router-link>
    </template>
    <template #cell:latest="{ row }">
      <i
        v-if="row.latest === undefined"
        class="icon icon-spinner icon-spin text-muted"
      />
      <span v-else-if="row.latest && active">
        <router-link :to="artifactRoute(active.id, row.project, row.shortName, row.latest.digest)">{{ row.latestLabel }}</router-link>
        <span
          v-if="row.latestExtra"
          v-clean-tooltip="tagNames(row.latest).slice(1).join(', ')"
          class="text-muted ml-5"
        >{{ t('spr.repositories.moreTags', { count: row.latestExtra }) }}</span>
      </span>
      <span
        v-else
        class="text-muted"
      >&mdash;</span>
    </template>
    <template #cell:vulnerabilities="{ row }">
      <i
        v-if="row.latest === undefined"
        class="icon icon-spinner icon-spin text-muted"
      />
      <SeverityBar
        v-else-if="row.latest"
        :summary="scanSummary(row.latest)?.summary?.summary"
        :busy="isScanActive(row.latest, SCAN_TYPE.VULNERABILITY)"
        :empty-label="isScanActive(row.latest, SCAN_TYPE.VULNERABILITY) ? t('spr.scan.statuses.running') : undefined"
      />
      <span
        v-else
        class="text-muted"
      >&mdash;</span>
    </template>
  </SortableTable>
</template>

<style lang="scss" scoped>
.spr-repo__description {
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
</style>
