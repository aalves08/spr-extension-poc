<script setup lang="ts">
import { computed, onMounted, reactive, watch } from 'vue';
import { useStore } from 'vuex';
import { BadgeState } from '@components/BadgeState';
import SortableTable from '@shell/components/SortableTable/index.vue';
import { useSprI18n } from '../composables/useSprI18n';
import { CATALOG } from '@shell/config/types';
import { PAGES, REGISTRY_QUERY, ROUTE_PARAMS, pageRouteName } from '../config/constants';
import { CONNECTION_STATE, Connection } from '../types/connection';
import { HarborStatistics, HarborVulSummary } from '../types/harbor';
import { useConnections } from '../composables/useConnections';
import { useProxyAllowList } from '../composables/useProxyAllowList';
import { useConnectionProbe } from '../composables/useConnectionProbe';
import { useHarbor } from '../composables/useHarbor';
import { steveList } from '../composables/useSprDiscovery';
import {
  SUPPORT_STATUS, SupportStatus, sprReleaseForHarbor, sprReleaseForVersion, sprVersionFromHarborVersion, supportStatus
} from '../utils/spr-releases';
import { formatBytes, portalUrl } from '../utils/format';
import SprPage from '../components/SprPage.vue';
import ConnectionStateBadge from '../components/ConnectionStateBadge.vue';

interface Details {
  stats?: HarborStatistics;
  vul?: HarborVulSummary;
  /** App (SPR) version of the linked Helm app; the chart version differs (chart 1.1.29 ships SPR 1.1.3) */
  appVersion?: string;
}

const store = useStore();
const { t } = useSprI18n(store);
const { connections, load } = useConnections(store);
const allowList = useProxyAllowList(store);
const { probe, resultFor } = useConnectionProbe();
const { clientFor } = useHarbor();

const details = reactive<Record<string, Details>>({});

const SUPPORT_BG: Record<SupportStatus, string> = {
  [SUPPORT_STATUS.SUPPORTED]:   'bg-success',
  [SUPPORT_STATUS.MAINTENANCE]: 'bg-warning',
  [SUPPORT_STATUS.EOL]:         'bg-error',
  [SUPPORT_STATUS.UNKNOWN]:     'bg-darker',
};

const headers = [
  { name: 'state', labelKey: 'spr.registries.headers.state' },
  {
    name: 'name', labelKey: 'spr.registries.headers.name', value: 'displayName', sort: ['displayName']
  },
  {
    name: 'url', labelKey: 'spr.registries.headers.url', value: 'url', sort: ['url']
  },
  { name: 'sprVersion', labelKey: 'spr.registries.headers.sprVersion' },
  { name: 'support', labelKey: 'spr.registries.headers.support' },
  { name: 'projects', labelKey: 'spr.registries.headers.projects' },
  { name: 'repositories', labelKey: 'spr.registries.headers.repositories' },
  { name: 'storage', labelKey: 'spr.registries.headers.storage' },
  { name: 'critical', labelKey: 'spr.registries.headers.critical' },
  { name: 'linked', labelKey: 'spr.registries.headers.linked' },
  {
    name: 'actions', label: ' ', width: 160
  },
];

function overviewRoute(c: Connection) {
  return {
    name: pageRouteName(PAGES.OVERVIEW), params: ROUTE_PARAMS, query: { [REGISTRY_QUERY]: c.id }
  };
}

function harborVersion(c: Connection): string | undefined {
  return resultFor(c)?.systemInfo?.harbor_version;
}

/** SPR version reported by SPR itself, else from the linked app, else derived from the Harbor version (approximate) */
function sprVersion(c: Connection): { version?: string; approx: boolean } {
  const exact = sprVersionFromHarborVersion(harborVersion(c)) || details[c.id]?.appVersion;

  if (exact) {
    return { version: exact, approx: false };
  }

  return { version: sprReleaseForHarbor(harborVersion(c))?.spr, approx: true };
}

function support(c: Connection): SupportStatus {
  const { version, approx } = sprVersion(c);
  const release = approx ? sprReleaseForHarbor(harborVersion(c)) : sprReleaseForVersion(version);

  return supportStatus(release);
}

async function loadDetails(c: Connection) {
  const result = await probe(c, { allowed: allowList.isAllowed(c.host) });
  const d: Details = { ...(details[c.id] || {}) };

  if (c.linkedCluster && c.linkedNamespace && d.appVersion === undefined) {
    try {
      const apps = await steveList(store, c.linkedCluster, CATALOG.APP, c.linkedNamespace);
      const app = apps.find((a: any) => (a.spec?.name || a.metadata?.name) === c.linkedApp);

      d.appVersion = app?.spec?.chart?.metadata?.appVersion || '';
    } catch {
      d.appVersion = '';
    }
  }

  if (result.state === CONNECTION_STATE.CONNECTED) {
    const client = clientFor(c);
    const [stats, vul] = await Promise.allSettled([client.statistics(), client.vulSummary()]);

    d.stats = stats.status === 'fulfilled' ? stats.value : undefined;
    d.vul = vul.status === 'fulfilled' ? vul.value : undefined;
  }

  details[c.id] = d;
}

const rows = computed(() => connections.value);

onMounted(async() => {
  await Promise.all([load(), allowList.load()]);
  connections.value.forEach(loadDetails);
});

watch([connections, () => allowList.allowedDomains.value], () => connections.value.forEach(loadDetails));
</script>

<template>
  <SprPage :title="t('spr.registries.title')">
    <SortableTable
      :headers="headers"
      :rows="rows"
      key-field="id"
      :table-actions="false"
      :row-actions="false"
      :search="rows.length > 10"
      default-sort-by="name"
      data-testid="spr-registries"
    >
      <template #cell:state="{ row }">
        <ConnectionStateBadge :result="resultFor(row)" />
      </template>
      <template #cell:name="{ row }">
        <router-link :to="overviewRoute(row)">
          {{ row.displayName }}
        </router-link>
      </template>
      <template #cell:sprVersion="{ row }">
        <span v-if="sprVersion(row).version">
          {{ sprVersion(row).version }}
          <span
            v-if="sprVersion(row).approx"
            v-clean-tooltip="t('spr.registries.approxTooltip')"
            class="text-muted"
          >{{ t('spr.registries.approx') }}</span>
        </span>
        <span
          v-else
          class="text-muted"
        >&mdash;</span>
      </template>
      <template #cell:support="{ row }">
        <BadgeState
          :color="SUPPORT_BG[support(row)]"
          :label="t(`spr.support.${ support(row) }`)"
        />
      </template>
      <template #cell:projects="{ row }">
        {{ details[row.id]?.stats?.total_project_count ?? '—' }}
      </template>
      <template #cell:repositories="{ row }">
        {{ details[row.id]?.stats?.total_repo_count ?? '—' }}
      </template>
      <template #cell:storage="{ row }">
        {{ formatBytes(details[row.id]?.stats?.total_storage_consumption) || '—' }}
      </template>
      <template #cell:critical="{ row }">
        <span
          v-if="details[row.id]?.vul"
          :class="{ 'text-error': (details[row.id]?.vul?.critical_cnt || 0) > 0 }"
        >{{ details[row.id]?.vul?.critical_cnt || 0 }}</span>
        <span
          v-else
          class="text-muted"
        >&mdash;</span>
      </template>
      <template #cell:linked="{ row }">
        <span v-if="row.linkedCluster">{{ row.linkedNamespace }} / {{ row.linkedApp }}</span>
        <span
          v-else
          class="text-muted"
        >&mdash;</span>
      </template>
      <template #cell:actions="{ row }">
        <a
          :href="portalUrl.home(row.url)"
          target="_blank"
          rel="noopener noreferrer nofollow"
          :data-testid="`spr-registries-portal-${ row.id }`"
        >
          {{ t('spr.portal.open') }} <i class="icon icon-external-link" />
        </a>
      </template>
    </SortableTable>
  </SprPage>
</template>
