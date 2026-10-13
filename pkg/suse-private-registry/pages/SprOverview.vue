<script setup lang="ts">
import {
  computed, nextTick, onMounted, ref, Ref, watch
} from 'vue';
import { useStore } from 'vuex';
import { BadgeState } from '@components/BadgeState';
import { Banner } from '@components/Banner';
import LiveDate from '@shell/components/formatter/LiveDate.vue';
import SortableTable from '@shell/components/SortableTable/index.vue';
import Tabbed from '@shell/components/Tabbed/index.vue';
import Tab from '@shell/components/Tabbed/Tab.vue';
import { useSprI18n } from '../composables/useSprI18n';
import { CONNECTION_STATE } from '../types/connection';
import { HarborReplicationExecution, HarborScanner } from '../types/harbor';
import { useActiveRegistry } from '../composables/useActiveRegistry';
import { useConnectionProbe } from '../composables/useConnectionProbe';
import { useProxyAllowList } from '../composables/useProxyAllowList';
import { HarborClient, useHarbor } from '../composables/useHarbor';
import { useAsyncData } from '../composables/useAsyncData';
import { useSprActions } from '../composables/useSprActions';
import { mapLimit } from '../utils/async';
import { formatBytes, durationSeconds, portalUrl } from '../utils/format';
import { sprReleaseForHarbor, sprVersionFromHarborVersion } from '../utils/spr-releases';
import SprPage from '../components/SprPage.vue';
import SummaryStrip from '../components/overview/SummaryStrip.vue';
import SummaryBlock from '../components/overview/SummaryBlock.vue';
import SummaryStat from '../components/overview/SummaryStat.vue';
import TopCves from '../components/overview/TopCves.vue';
import TopArtifacts from '../components/overview/TopArtifacts.vue';
import SeverityDistribution from '../components/SeverityDistribution.vue';
import StatusPill from '../components/StatusPill.vue';
import ComponentHealth from '../components/ComponentHealth.vue';
import ConnectionStateBadge from '../components/ConnectionStateBadge.vue';

type ScannerRow = HarborScanner & { healthStatus: string };

const store = useStore();
const { t } = useSprI18n(store);
const { active } = useActiveRegistry();
const { probe, resultFor } = useConnectionProbe();
const allowList = useProxyAllowList(store);
const { clientFor } = useHarbor();
const actions = useSprActions();

const client = computed<HarborClient | undefined>(() => (active.value ? clientFor(active.value) : undefined));
const probeResult = computed(() => (active.value ? resultFor(active.value) : undefined));
const connected = computed(() => probeResult.value?.state === CONNECTION_STATE.CONNECTED);
const systemInfo = computed(() => probeResult.value?.systemInfo);
const sprVersion = computed(() => {
  const harborVersion = systemInfo.value?.harbor_version;

  return sprVersionFromHarborVersion(harborVersion) || sprReleaseForHarbor(harborVersion)?.spr;
});

function exposure(cveId: string) {
  if (active.value) {
    actions.cveExposure({ connection: active.value, cveId });
  }
}

function packageSearch() {
  if (active.value) {
    actions.packageSearch({ connection: active.value });
  }
}

function needClient(): HarborClient {
  if (!client.value) {
    throw new Error('No active registry');
  }

  return client.value;
}

const inventory = useAsyncData(async() => {
  const c = needClient();
  const [stats, volumes] = await Promise.all([c.statistics(), c.volumes().catch(() => undefined)]);

  return { stats, volumes };
});

const vulns = useAsyncData(() => needClient().vulSummary());

const replication = useAsyncData(async() => {
  const c = needClient();
  const executions: HarborReplicationExecution[] = await c.replicationExecutions();
  const policyIds = [...new Set(executions.map((e) => e.policy_id))];
  const names: Record<number, string> = {};

  await mapLimit(policyIds, 5, async(id) => {
    names[id] = (await c.replicationPolicy(id))?.name;
  });

  return executions.map((e) => ({
    ...e,
    policyName: names[e.policy_id] || `#${ e.policy_id }`,
    duration:   durationSeconds(e.start_time, e.end_time),
  }));
});

const gc = useAsyncData(async() => {
  const c = needClient();
  const [history, schedule] = await Promise.all([c.gcHistory(), c.gcSchedule().catch(() => undefined)]);

  return { last: history?.[0], schedule };
});

const scanners = useAsyncData(async(): Promise<ScannerRow[]> => {
  const c = needClient();
  const list = await c.scanners();

  // A metadata error means the adapter can't be reached
  const results = await mapLimit(list, 5, async(s): Promise<ScannerRow> => {
    if (!s.disabled && !s.health) {
      await c.scannerMetadata(s.uuid);
    }

    return { ...s, healthStatus: s.health || 'healthy' };
  });

  return results.map((r, i) => r.value || { ...list[i], healthStatus: 'unhealthy' });
});

// undefined while loading, null when unavailable
const health: Ref<{ healthy: number; total: number } | null | undefined> = ref();
const detailsEl: Ref<HTMLElement | null> = ref(null);
const tabsRef: Ref<{ select:(name: string) => void } | null> = ref(null);

// The stat links to `#health`, which does nothing when that's already the hash
async function showHealth() {
  tabsRef.value?.select('health');
  await nextTick();
  detailsEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const storage = computed(() => {
  const s = inventory.data.value?.volumes?.storage?.[0];

  if (!s?.total) {
    return undefined;
  }

  const used = s.total - s.free;

  return {
    used, total: s.total, ratio: used / s.total
  };
});

const scanned = computed(() => {
  const v = vulns.data.value;

  if (!v?.total_artifact) {
    return undefined;
  }

  const ratio = (v.scanned_cnt || 0) / v.total_artifact;

  return { ratio, pct: Math.round(ratio * 100) };
});

const vulnSummary = computed(() => {
  const v = vulns.data.value;

  return {
    Critical: v?.critical_cnt || 0,
    High:     v?.high_cnt || 0,
    Medium:   v?.medium_cnt || 0,
    Low:      v?.low_cnt || 0,
    Unknown:  v?.unknown_cnt || 0,
  };
});

const lastReplication = computed(() => replication.data.value?.[0]);
const defaultScanner = computed(() => scanners.data.value?.find((s) => s.is_default) || scanners.data.value?.[0]);

const gcSchedule = computed(() => {
  const s = gc.data.value?.schedule?.schedule;

  return s?.type && s.type !== 'None' ? `${ s.type } ${ s.cron || '' }`.trim() : t('spr.overview.gc.noSchedule');
});

const replicationHeaders = [
  {
    name: 'policy', labelKey: 'spr.overview.replication.headers.policy', value: 'policyName', sort: ['policyName']
  },
  {
    name: 'trigger', labelKey: 'spr.overview.replication.headers.trigger', value: 'trigger', sort: ['trigger']
  },
  {
    name: 'status', labelKey: 'spr.overview.replication.headers.status', value: 'status', sort: ['status']
  },
  {
    name: 'started', labelKey: 'spr.overview.replication.headers.started', value: 'start_time', formatter: 'LiveDate', sort: ['start_time:desc']
  },
  {
    name: 'duration', labelKey: 'spr.overview.replication.headers.duration', value: 'duration', sort: ['duration']
  },
];

const scannerHeaders = [
  {
    name: 'name', labelKey: 'spr.overview.scanners.headers.name', value: 'name', sort: ['name']
  },
  { name: 'version', labelKey: 'spr.overview.scanners.headers.version' },
  { name: 'health', labelKey: 'spr.overview.scanners.headers.health' },
];

async function loadAll() {
  if (!active.value) {
    return;
  }

  await allowList.load();
  const result = await probe(active.value, { allowed: allowList.isAllowed(active.value.host) });

  if (result.state !== CONNECTION_STATE.CONNECTED) {
    return;
  }

  [inventory, vulns, replication, gc, scanners].forEach((s) => s.run());
}

onMounted(loadAll);
watch(() => active.value?.id, () => {
  health.value = undefined;
  loadAll();
});
// Also covers hosts allowed by another ProxyEndpoint
watch(() => !!active.value && allowList.isAllowed(active.value.host), (allowed) => {
  if (allowed && !connected.value) {
    loadAll();
  }
});
</script>

<template>
  <SprPage
    :title="active ? active.displayName : t('spr.overview.title')"
    selector
  >
    <template #title-extra>
      <ConnectionStateBadge
        v-if="active"
        :result="probeResult"
      />
    </template>
    <template #actions>
      <button
        v-if="active"
        type="button"
        class="btn role-primary"
        data-testid="spr-overview-package-search"
        @click="packageSearch"
      >
        <i class="icon icon-search mr-5" />{{ t('spr.packageSearch.open') }}
      </button>
      <a
        v-if="active"
        class="btn role-secondary"
        :href="portalUrl.home(active.url)"
        target="_blank"
        rel="noopener noreferrer nofollow"
      >
        {{ t('spr.portal.open') }} <i class="icon icon-external-link ml-5" />
      </a>
    </template>

    <template v-if="active">
      <div
        v-if="systemInfo"
        class="spr-overview__meta"
        data-testid="spr-overview-meta"
      >
        <span><span class="text-muted">{{ t('spr.overview.sprVersion') }}</span> {{ sprVersion || '—' }}</span>
        <span><span class="text-muted">{{ t('spr.overview.authMode') }}</span> {{ systemInfo.auth_mode || '—' }}</span>
        <BadgeState
          v-if="systemInfo.read_only"
          color="bg-warning"
          :label="t('spr.overview.readOnly')"
        />
      </div>

      <Banner
        v-if="probeResult && !connected"
        color="error"
        :label="`${ t(`spr.state.${ probeResult.state }`) }${ probeResult.error?.message ? `: ${ probeResult.error.message }` : '' }`"
      />

      <template v-if="connected && client">
        <!-- At a glance -->
        <SummaryStrip data-testid="spr-overview-stats">
          <SummaryBlock :loading="health === undefined">
            <SummaryStat
              :value="health ? `${ health.healthy }/${ health.total }` : '—'"
              :label="t('spr.overview.health.stat')"
              :value-class="health && health.healthy < health.total ? 'text-error' : ''"
              :to="{ hash: '#health' }"
              @navigate="showHealth"
            />
          </SummaryBlock>
          <SummaryBlock
            :loading="inventory.loading.value"
            :error="inventory.error.value"
          >
            <SummaryStat
              :value="inventory.data.value?.stats?.total_project_count ?? '—'"
              :label="t('spr.overview.inventory.projects')"
              :detail="t('spr.overview.inventory.projectsDetail', {
                private: inventory.data.value?.stats?.private_project_count ?? 0,
                public: inventory.data.value?.stats?.public_project_count ?? 0
              })"
            />
          </SummaryBlock>
          <SummaryBlock
            :loading="inventory.loading.value"
            :error="inventory.error.value"
          >
            <SummaryStat
              :value="inventory.data.value?.stats?.total_repo_count ?? '—'"
              :label="t('spr.overview.inventory.repositories')"
            />
          </SummaryBlock>
          <SummaryBlock
            :loading="inventory.loading.value"
            :error="inventory.error.value"
          >
            <SummaryStat
              :value="formatBytes(inventory.data.value?.stats?.total_storage_consumption) || '—'"
              :label="t('spr.overview.inventory.consumed')"
              :ratio="storage?.ratio"
              :ratio-warn="!!storage && storage.ratio > 0.85"
              :detail="storage ? t('spr.overview.inventory.disk', { used: formatBytes(storage.used), total: formatBytes(storage.total) }) : undefined"
            />
          </SummaryBlock>
          <SummaryBlock
            :loading="vulns.loading.value"
            :error="vulns.error.value"
          >
            <SummaryStat
              :value="scanned ? `${ scanned.pct }%` : '—'"
              :label="t('spr.overview.vulnerabilities.scanned')"
              :ratio="scanned?.ratio"
              :detail="t('spr.overview.vulnerabilities.scannedDetail', { scanned: vulns.data.value?.scanned_cnt ?? 0, total: vulns.data.value?.total_artifact ?? 0 })"
            />
          </SummaryBlock>
        </SummaryStrip>

        <!-- Security -->
        <SummaryStrip data-testid="spr-overview-security">
          <SummaryBlock
            :title="t('spr.overview.vulnerabilities.title')"
            :loading="vulns.loading.value"
            :error="vulns.error.value"
            :grow="2"
          >
            <SeverityDistribution :summary="vulnSummary">
              <span
                v-if="vulns.data.value?.fixable_cnt"
                class="text-muted"
              >{{ t('spr.overview.vulnerabilities.fixable', { count: vulns.data.value.fixable_cnt }) }}</span>
            </SeverityDistribution>
          </SummaryBlock>
          <SummaryBlock
            :title="t('spr.overview.topCves.title')"
            :loading="vulns.loading.value"
            :error="vulns.error.value"
            :grow="3"
          >
            <TopCves
              v-if="vulns.data.value?.dangerous_cves?.length"
              :cves="vulns.data.value.dangerous_cves"
              :exposure="!!active"
              @exposure="exposure"
            />
            <p
              v-else
              class="text-muted"
            >
              {{ t('spr.overview.topCves.none') }}
            </p>
          </SummaryBlock>
        </SummaryStrip>

        <SummaryStrip data-testid="spr-overview-activity">
          <SummaryBlock
            :title="t('spr.overview.topArtifacts.title')"
            :loading="vulns.loading.value"
            :error="vulns.error.value"
            :grow="3"
          >
            <TopArtifacts
              v-if="vulns.data.value?.dangerous_artifacts?.length"
              :connection-id="active.id"
              :artifacts="vulns.data.value.dangerous_artifacts"
            />
            <p
              v-else
              class="text-muted"
            >
              {{ t('spr.overview.topArtifacts.none') }}
            </p>
          </SummaryBlock>
          <SummaryBlock
            :title="t('spr.overview.operations.title')"
            :grow="2"
          >
            <dl class="spr-overview__ops">
              <dt>{{ t('spr.overview.gc.title') }}</dt>
              <dd>
                <i
                  v-if="gc.loading.value"
                  class="icon icon-spinner icon-spin"
                />
                <span
                  v-else-if="gc.error.value"
                  class="text-muted"
                >{{ t('spr.overview.operations.unavailable') }}</span>
                <template v-else-if="gc.data.value?.last">
                  <StatusPill :status="gc.data.value.last.job_status" />
                  <LiveDate
                    class="text-muted"
                    :value="gc.data.value.last.update_time || gc.data.value.last.creation_time"
                    add-suffix
                  />
                </template>
                <span
                  v-else
                  class="text-muted"
                >{{ t('spr.overview.gc.never') }}</span>
              </dd>

              <dt>{{ t('spr.overview.gc.schedule') }}</dt>
              <dd>
                <span v-if="gc.data.value">{{ gcSchedule }}</span>
                <span
                  v-else
                  class="text-muted"
                >—</span>
              </dd>

              <dt>{{ t('spr.overview.operations.lastReplication') }}</dt>
              <dd>
                <i
                  v-if="replication.loading.value"
                  class="icon icon-spinner icon-spin"
                />
                <span
                  v-else-if="replication.error.value"
                  class="text-muted"
                >{{ t('spr.overview.operations.unavailable') }}</span>
                <template v-else-if="lastReplication">
                  <StatusPill :status="lastReplication.status" />
                  <span
                    class="spr-overview__ellipsis"
                    :title="lastReplication.policyName"
                  >{{ lastReplication.policyName }}</span>
                  <LiveDate
                    class="text-muted"
                    :value="lastReplication.start_time"
                    add-suffix
                  />
                </template>
                <span
                  v-else
                  class="text-muted"
                >{{ t('spr.overview.replication.none') }}</span>
              </dd>

              <dt>{{ t('spr.overview.operations.scanner') }}</dt>
              <dd>
                <i
                  v-if="scanners.loading.value"
                  class="icon icon-spinner icon-spin"
                />
                <span
                  v-else-if="scanners.error.value"
                  class="text-muted"
                >{{ t('spr.overview.operations.unavailable') }}</span>
                <template v-else-if="defaultScanner">
                  <StatusPill
                    :status="defaultScanner.disabled ? 'stopped' : defaultScanner.healthStatus"
                    :label="defaultScanner.disabled ? t('spr.overview.scanners.disabled') : t(`spr.overview.scanners.${ defaultScanner.healthStatus === 'healthy' ? 'healthy' : 'unhealthy' }`)"
                  />
                  <span
                    class="spr-overview__ellipsis"
                    :title="defaultScanner.name"
                  >{{ defaultScanner.name }}</span>
                </template>
                <span
                  v-else
                  class="text-muted"
                >{{ t('spr.overview.scanners.none') }}</span>
              </dd>
            </dl>
          </SummaryBlock>
        </SummaryStrip>

        <!-- Details -->
        <div ref="detailsEl">
          <Tabbed
            ref="tabsRef"
            :use-hash="true"
            default-tab="health"
          >
            <Tab
              name="health"
              :label="t('spr.overview.health.title')"
              :weight="3"
            >
              <ComponentHealth
                :connection="active"
                :client="client"
                @summary="health = $event"
              />
            </Tab>
            <Tab
              name="replication"
              :label="t('spr.overview.replication.title')"
              :weight="2"
            >
              <SortableTable
                :headers="replicationHeaders"
                :rows="replication.data.value || []"
                key-field="id"
                :loading="replication.loading.value"
                :search="false"
                :table-actions="false"
                :row-actions="false"
                default-sort-by="started"
                no-rows-key="spr.overview.replication.none"
                data-testid="spr-overview-replication"
              >
                <template #cell:status="{ row }">
                  <StatusPill :status="row.status" />
                </template>
                <template #cell:duration="{ row }">
                  <span class="text-muted">{{ row.duration !== undefined ? t('spr.overview.seconds', { s: row.duration }) : '—' }}</span>
                </template>
              </SortableTable>
            </Tab>
            <Tab
              name="scanners"
              :label="t('spr.overview.scanners.title')"
              :weight="1"
            >
              <SortableTable
                :headers="scannerHeaders"
                :rows="scanners.data.value || []"
                key-field="uuid"
                :loading="scanners.loading.value"
                :search="false"
                :table-actions="false"
                :row-actions="false"
                no-rows-key="spr.overview.scanners.none"
                data-testid="spr-overview-scanners"
              >
                <template #cell:name="{ row }">
                  {{ row.name }}
                  <BadgeState
                    v-if="row.is_default"
                    class="ml-5"
                    color="bg-primary"
                    :label="t('spr.overview.scanners.default')"
                  />
                </template>
                <template #cell:version="{ row }">
                  <span class="text-muted">{{ [row.vendor, row.version].filter(Boolean).join(' ') || '—' }}</span>
                </template>
                <template #cell:health="{ row }">
                  <StatusPill
                    :status="row.disabled ? 'stopped' : row.healthStatus"
                    :label="row.disabled ? t('spr.overview.scanners.disabled') : t(`spr.overview.scanners.${ row.healthStatus === 'healthy' ? 'healthy' : 'unhealthy' }`)"
                  />
                </template>
              </SortableTable>
            </Tab>
          </Tabbed>
        </div>
      </template>
    </template>
  </SprPage>
</template>

<style lang="scss" scoped>
.spr-overview__meta {
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
  margin: -8px 0 20px;
}

.spr-overview__ops {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 12px 24px;
  align-items: center;
  margin: 0;

  dt {
    color: var(--disabled-text);
  }

  dd {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    margin: 0;
    white-space: nowrap;
  }
}

.spr-overview__ellipsis {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
