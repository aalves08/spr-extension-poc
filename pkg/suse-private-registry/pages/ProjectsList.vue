<script setup lang="ts">
import { computed, onMounted, reactive, watch } from 'vue';
import { useStore } from 'vuex';
import { Banner } from '@components/Banner';
import { BadgeState } from '@components/BadgeState';
import SortableTable from '@shell/components/SortableTable/index.vue';
import ProgressBarMulti from '@shell/components/ProgressBarMulti.vue';
import { useSprI18n } from '../composables/useSprI18n';
import { CLUSTER_CONCURRENCY } from '../config/constants';
import { HarborProject, HarborProjectSummary } from '../types/harbor';
import { useActiveRegistry } from '../composables/useActiveRegistry';
import { useHarbor } from '../composables/useHarbor';
import { useAsyncData } from '../composables/useAsyncData';
import { mapLimit } from '../utils/async';
import { formatBytes } from '../utils/format';
import { projectRoute } from '../utils/artifact';
import SprPage from '../components/SprPage.vue';
import UnavailableCard from '../components/UnavailableCard.vue';

const store = useStore();
const { t } = useSprI18n(store);
const { active } = useActiveRegistry();
const { clientFor } = useHarbor();

// Per-project summaries, keyed by `<connection>/<project id>`
const summaries = reactive<Record<string, HarborProjectSummary | null>>({});

const projects = useAsyncData<HarborProject[]>(async() => {
  if (!active.value) {
    return [];
  }

  const client = clientFor(active.value);
  const list = await client.projects();
  const connectionId = active.value.id;

  // Summaries carry quota, proxy-cache upstream and member counts. Load in the background.
  mapLimit(list, CLUSTER_CONCURRENCY, async(p) => {
    const key = `${ connectionId }/${ p.project_id }`;

    if (summaries[key] === undefined) {
      summaries[key] = await client.projectSummary(p.project_id).catch(() => null);
    }
  });

  return list;
});

const headers = [
  {
    name: 'name', labelKey: 'spr.projects.headers.name', value: 'name', sort: ['name']
  },
  {
    name: 'access', labelKey: 'spr.projects.headers.access', value: 'metadata.public', sort: ['metadata.public']
  },
  { name: 'type', labelKey: 'spr.projects.headers.type' },
  {
    name: 'repositories', labelKey: 'spr.projects.headers.repositories', value: 'repo_count', sort: ['repo_count']
  },
  { name: 'quota', labelKey: 'spr.projects.headers.quota' },
  { name: 'autoScan', labelKey: 'spr.projects.headers.autoScan' },
  { name: 'preventVul', labelKey: 'spr.projects.headers.preventVul' },
  { name: 'cosign', labelKey: 'spr.projects.headers.cosign' },
  { name: 'members', labelKey: 'spr.projects.headers.members' },
];

function summaryFor(p: HarborProject): HarborProjectSummary | null | undefined {
  return active.value ? summaries[`${ active.value.id }/${ p.project_id }`] : undefined;
}

function quota(p: HarborProject) {
  const q = summaryFor(p)?.quota;
  const used = q?.used?.storage ?? 0;
  const hard = q?.hard?.storage;

  if (!q) {
    return undefined;
  }

  const unlimited = hard === undefined || hard < 0;

  return {
    used,
    hard,
    unlimited,
    values: unlimited ? [] : [{
      label: 'used', value: used, color: hard && used / hard > 0.85 ? 'bg-error' : 'bg-primary'
    }],
  };
}

function members(p: HarborProject): number | undefined {
  const s = summaryFor(p);

  if (!s) {
    return undefined;
  }

  return (s.project_admin_count || 0) + (s.maintainer_count || 0) + (s.developer_count || 0) + (s.guest_count || 0) + (s.limited_guest_count || 0);
}

const isTrue = (v?: string) => v === 'true';

const rows = computed(() => projects.data.value || []);

onMounted(() => projects.run());
watch(() => active.value?.id, () => projects.run());
</script>

<template>
  <SprPage
    :title="t('spr.projects.title')"
    selector
  >
    <UnavailableCard
      v-if="projects.error.value"
      :error="projects.error.value"
    />
    <Banner
      v-else-if="active && !projects.loading.value && rows.length === 0"
      color="info"
      :label="t('spr.projects.emptyHint')"
    />
    <SortableTable
      v-if="!projects.error.value"
      :headers="headers"
      :rows="rows"
      key-field="project_id"
      :loading="projects.loading.value"
      :table-actions="false"
      :row-actions="false"
      default-sort-by="name"
      data-testid="spr-projects"
    >
      <template #cell:name="{ row }">
        <router-link
          v-if="active"
          :to="projectRoute(active.id, row.name)"
        >
          {{ row.name }}
        </router-link>
      </template>
      <template #cell:access="{ row }">
        {{ t(isTrue(row.metadata?.public) ? 'spr.projects.public' : 'spr.projects.private') }}
      </template>
      <template #cell:type="{ row }">
        <span v-if="row.registry_id">
          {{ t('spr.projects.proxyCache') }}
          <span
            v-if="summaryFor(row)?.registry"
            class="text-muted"
          >&rarr; {{ summaryFor(row)?.registry?.name }}</span>
        </span>
        <span v-else>{{ t('spr.projects.normal') }}</span>
      </template>
      <template #cell:quota="{ row }">
        <div
          v-if="quota(row)"
          class="spr-projects__quota"
        >
          <ProgressBarMulti
            v-if="!quota(row)?.unlimited"
            :values="quota(row)?.values || []"
            :max="quota(row)?.hard"
          />
          <span class="text-muted">
            {{ formatBytes(quota(row)?.used) }} / {{ quota(row)?.unlimited ? t('spr.projects.unlimited') : formatBytes(quota(row)?.hard) }}
          </span>
        </div>
        <i
          v-else-if="summaryFor(row) === undefined"
          class="icon icon-spinner icon-spin text-muted"
        />
      </template>
      <template #cell:autoScan="{ row }">
        <BadgeState
          :color="isTrue(row.metadata?.auto_scan) ? 'bg-success' : 'bg-darker'"
          :label="t(isTrue(row.metadata?.auto_scan) ? 'generic.yes' : 'generic.no')"
        />
      </template>
      <template #cell:preventVul="{ row }">
        <span v-if="isTrue(row.metadata?.prevent_vul)">{{ row.metadata?.severity || t('generic.yes') }}</span>
        <span
          v-else
          class="text-muted"
        >{{ t('spr.projects.off') }}</span>
      </template>
      <template #cell:cosign="{ row }">
        <BadgeState
          :color="isTrue(row.metadata?.enable_content_trust_cosign) ? 'bg-success' : 'bg-darker'"
          :label="t(isTrue(row.metadata?.enable_content_trust_cosign) ? 'generic.yes' : 'generic.no')"
        />
      </template>
      <template #cell:members="{ row }">
        {{ members(row) ?? '—' }}
      </template>
    </SortableTable>
  </SprPage>
</template>

<style lang="scss" scoped>
.spr-projects__quota {
  min-width: 140px;
}
</style>
