<script setup lang="ts">
import {
  computed, onMounted, ref, Ref, watch
} from 'vue';
import { useStore } from 'vuex';
import { useRoute } from 'vue-router';
import { RcDropdown, RcDropdownItem, RcDropdownSeparator, RcDropdownTrigger } from '@components/RcDropdown';
import SortableTable from '@shell/components/SortableTable/index.vue';
import LiveDate from '@shell/components/formatter/LiveDate.vue';
import AsyncButton from '@shell/components/AsyncButton.vue';
import { useSprI18n } from '../composables/useSprI18n';
import { PAGES, REGISTRY_QUERY, ROUTE_PARAMS, pageRouteName } from '../config/constants';
import { HarborArtifact, HarborNativeReportSummary, SCAN_TYPE, ScanType } from '../types/harbor';
import { useActiveRegistry } from '../composables/useActiveRegistry';
import { invalidateHarborCache, useHarbor } from '../composables/useHarbor';
import { useAsyncData } from '../composables/useAsyncData';
import { useArtifactScans } from '../composables/useArtifactScans';
import { useSprActions } from '../composables/useSprActions';
import { formatBytes, portalUrl } from '../utils/format';
import {
  ARTIFACT_KIND, artifactKind, artifactRoute, hasSbom, isIndex, isScanActive, isScannable, isSigned, platform, projectRoute, scanSummary, tagNames
} from '../utils/artifact';
import { SEVERITIES } from '../utils/severity';
import { JOB_STATUS, normaliseJobStatus } from '../utils/status';
import SprPage from '../components/SprPage.vue';
import SeverityBar from '../components/SeverityBar.vue';
import SeverityDistribution from '../components/SeverityDistribution.vue';
import UnavailableCard from '../components/UnavailableCard.vue';
import DigestCopy from '../components/DigestCopy.vue';
import BooleanMark from '../components/BooleanMark.vue';
import StatusPill from '../components/StatusPill.vue';
import SummaryStrip from '../components/overview/SummaryStrip.vue';
import SummaryBlock from '../components/overview/SummaryBlock.vue';
import SummaryStat from '../components/overview/SummaryStat.vue';

type ArtifactRow = HarborArtifact & { tagList: string; kind: string; platform: string; scan?: HarborNativeReportSummary };

const store = useStore();
const route = useRoute();
const { t } = useSprI18n(store);
const { active } = useActiveRegistry();
const { clientFor } = useHarbor();
const actions = useSprActions();

const projectName = computed(() => route.params.project as string);
const repoName = computed(() => route.params.repo as string);

const artifacts = useAsyncData<HarborArtifact[]>(async() => {
  if (!active.value) {
    return [];
  }

  return clientFor(active.value).artifacts(projectName.value, repoName.value);
});

function toRow(a: HarborArtifact): ArtifactRow {
  return {
    ...a,
    tagList:  tagNames(a).join(', '),
    kind:     artifactKind(a),
    platform: isIndex(a) ? t('spr.artifacts.platforms', { count: a.references?.length || 0 }) : platform(a),
    scan:     scanSummary(a),
  };
}

// Rows are updated in place: the table matches the selection by object, so new objects on every poll would clear it
const rows: Ref<ArtifactRow[]> = ref([]);

watch(() => artifacts.data.value, (list) => {
  const current = new Map(rows.value.map((r) => [r.digest, r]));

  rows.value = (list || []).map((a) => {
    const existing = current.get(a.digest);

    return existing ? Object.assign(existing, toRow(a)) : toRow(a);
  });
});

const scans = useArtifactScans({
  connection: active,
  project:    projectName,
  repo:       repoName,
  artifacts:  rows,
  reload:     async() => {
    if (active.value) {
      invalidateHarborCache(active.value.id);
    }
    await artifacts.run({ silent: true });
  },
});

const showActions = computed(() => scans.canStart(SCAN_TYPE.VULNERABILITY) || scans.canStart(SCAN_TYPE.SBOM));
const hasImages = computed(() => rows.value.some((r) => r.kind === ARTIFACT_KIND.IMAGE));

function deploy(row: ArtifactRow) {
  if (active.value) {
    actions.deployImage({
      connection: active.value, project: projectName.value, repo: repoName.value, artifact: row
    });
  }
}

const selected: Ref<ArtifactRow[]> = ref([]);
const selectedScannable = computed(() => selected.value.filter(isScannable));

async function startSelected(type: ScanType, btnCb: (ok: boolean) => void) {
  btnCb(await scans.start(type, selectedScannable.value));
}

// ---- Summary strip --------------------------------------------------------------------------------------------------

const summary = computed(() => {
  const scannable = rows.value.filter(isScannable);
  const severities: Record<string, number> = {};

  rows.value.forEach((r) => {
    const counts = r.scan?.summary?.summary || {};

    SEVERITIES.forEach((sev) => {
      severities[sev] = (severities[sev] || 0) + (counts[sev] || 0);
    });
  });

  return {
    total:     rows.value.length,
    scannable: scannable.length,
    scanned:   scannable.filter((r) => !!r.scan?.summary).length,
    signed:    rows.value.filter(isSigned).length,
    sbom:      rows.value.filter(hasSbom).length,
    severities,
  };
});

function sbomFailed(row: ArtifactRow): boolean {
  return normaliseJobStatus(row.sbom_overview?.scan_status) === JOB_STATUS.ERROR;
}

const columns = [
  {
    name: 'tags', labelKey: 'spr.artifacts.headers.tags', value: 'tagList', sort: ['tagList']
  },
  {
    name: 'digest', labelKey: 'spr.artifacts.headers.digest', value: 'digest', sort: ['digest']
  },
  {
    name: 'type', labelKey: 'spr.artifacts.headers.type', value: 'kind', sort: ['kind']
  },
  {
    name: 'platform', labelKey: 'spr.artifacts.headers.platform', value: 'platform'
  },
  {
    name: 'size', labelKey: 'spr.artifacts.headers.size', value: 'size', sort: ['size']
  },
  { name: 'vulnerabilities', labelKey: 'spr.artifacts.headers.vulnerabilities' },
  {
    name: 'signed', labelKey: 'spr.artifacts.headers.signed', width: 80
  },
  {
    name: 'sbom', labelKey: 'spr.artifacts.headers.sbom', width: 80
  },
  {
    name: 'pushed', labelKey: 'spr.artifacts.headers.pushed', value: 'push_time', formatter: 'LiveDate', sort: ['push_time:desc']
  },
  {
    name: 'pulled', labelKey: 'spr.artifacts.headers.pulled', value: 'pull_time', sort: ['pull_time:desc']
  },
];

const headers = computed(() => (showActions.value || hasImages.value ? [...columns, {
  name: 'actions', label: ' ', width: 50
}] : columns));

const projectsRoute = computed(() => ({
  name: pageRouteName(PAGES.PROJECTS), params: ROUTE_PARAMS, query: active.value ? { [REGISTRY_QUERY]: active.value.id } : {}
}));

/** Harbor uses 0001-01-01 for "never pulled" */
function pulled(time?: string): string | undefined {
  return time && !time.startsWith('0001-') ? time : undefined;
}

onMounted(() => artifacts.run());
watch([() => active.value?.id, projectName, repoName], () => artifacts.run());
</script>

<template>
  <SprPage
    :title="repoName"
    selector
  >
    <template #breadcrumbs>
      <div class="spr-breadcrumbs">
        <router-link :to="projectsRoute">
          {{ t('spr.projects.title') }}
        </router-link>
        <span class="text-muted">/</span>
        <router-link
          v-if="active"
          :to="projectRoute(active.id, projectName)"
        >
          {{ projectName }}
        </router-link>
        <span class="text-muted">/</span>
      </div>
    </template>
    <template #actions>
      <a
        v-if="active && rows.length"
        class="btn role-secondary"
        :href="portalUrl.repository(active.url, rows[0].project_id, repoName)"
        target="_blank"
        rel="noopener noreferrer nofollow"
      >
        {{ t('spr.portal.open') }} <i class="icon icon-external-link ml-5" />
      </a>
    </template>

    <UnavailableCard
      v-if="artifacts.error.value"
      :error="artifacts.error.value"
    />
    <SummaryStrip
      v-if="!artifacts.error.value && rows.length"
      data-testid="spr-repository-summary"
    >
      <SummaryBlock>
        <SummaryStat
          :value="summary.total"
          :label="t('spr.repository.summary.artifacts')"
        />
      </SummaryBlock>
      <SummaryBlock>
        <SummaryStat
          :value="`${ summary.scanned }/${ summary.scannable }`"
          :label="t('spr.repository.summary.scanned')"
          :ratio="summary.scannable ? summary.scanned / summary.scannable : undefined"
        />
      </SummaryBlock>
      <SummaryBlock>
        <SummaryStat
          :value="`${ summary.signed }/${ summary.total }`"
          :label="t('spr.repository.summary.signed')"
        />
      </SummaryBlock>
      <SummaryBlock>
        <SummaryStat
          :value="`${ summary.sbom }/${ summary.total }`"
          :label="t('spr.repository.summary.sbom')"
        />
      </SummaryBlock>
      <SummaryBlock
        :title="t('spr.overview.vulnerabilities.title')"
        :tooltip="t('spr.repository.summary.vulnerabilitiesTooltip')"
        :grow="4"
      >
        <SeverityDistribution :summary="summary.severities" />
      </SummaryBlock>
    </SummaryStrip>
    <SortableTable
      v-if="!artifacts.error.value"
      :headers="headers"
      :rows="rows"
      key-field="digest"
      :loading="artifacts.loading.value"
      :table-actions="showActions"
      :row-actions="false"
      default-sort-by="pushed"
      no-rows-key="spr.artifacts.none"
      data-testid="spr-artifacts"
      @selection="selected = $event"
    >
      <template
        v-if="showActions"
        #header-left
      >
        <div class="spr-bulk">
          <AsyncButton
            v-if="scans.canStart(SCAN_TYPE.VULNERABILITY)"
            mode="edit"
            icon="icon-play"
            :disabled="!selectedScannable.length"
            :action-label="t('spr.scan.actions.scanSelected')"
            :waiting-label="t('spr.scan.actions.starting')"
            :success-label="t('spr.scan.actions.started')"
            data-testid="spr-artifacts-bulk-scan"
            @click="startSelected(SCAN_TYPE.VULNERABILITY, $event)"
          />
          <AsyncButton
            v-if="scans.canStart(SCAN_TYPE.SBOM)"
            mode="edit"
            icon="icon-file"
            action-color="role-secondary"
            :disabled="!selectedScannable.length"
            :action-label="t('spr.scan.actions.sbomSelected')"
            :waiting-label="t('spr.scan.actions.starting')"
            :success-label="t('spr.scan.actions.started')"
            data-testid="spr-artifacts-bulk-sbom"
            @click="startSelected(SCAN_TYPE.SBOM, $event)"
          />
        </div>
      </template>
      <template #cell:tags="{ row }">
        <router-link
          v-if="active"
          :to="artifactRoute(active.id, projectName, repoName, row.digest)"
        >
          {{ row.tagList || t('spr.artifacts.untagged') }}
        </router-link>
      </template>
      <template #cell:digest="{ row }">
        <DigestCopy :digest="row.digest" />
      </template>
      <template #cell:type="{ row }">
        {{ t(`spr.artifacts.kind.${ row.kind }`) }}
      </template>
      <template #cell:size="{ row }">
        {{ formatBytes(row.size) }}
      </template>
      <template #cell:vulnerabilities="{ row }">
        <SeverityBar
          :summary="row.scan?.summary?.summary"
          :busy="isScanActive(row, SCAN_TYPE.VULNERABILITY)"
          :empty-label="scans.statusLabel(row.scan?.scan_status)"
        />
      </template>
      <template #cell:signed="{ row }">
        <BooleanMark
          :value="isSigned(row)"
          :label="t(isSigned(row) ? 'spr.artifacts.signed' : 'spr.artifacts.unsigned')"
        />
      </template>
      <template #cell:sbom="{ row }">
        <span
          v-if="isScanActive(row, SCAN_TYPE.SBOM)"
          class="text-muted"
        ><i class="icon icon-spinner icon-spin mr-5" />{{ scans.statusLabel(row.sbom_overview?.scan_status) }}</span>
        <StatusPill
          v-else-if="sbomFailed(row)"
          :status="row.sbom_overview?.scan_status"
        />
        <BooleanMark
          v-else
          :value="hasSbom(row)"
          :label="t(hasSbom(row) ? 'spr.artifacts.sbom' : 'spr.artifacts.noSbom')"
        />
      </template>
      <template #cell:actions="{ row }">
        <RcDropdown
          v-if="showActions || row.kind === ARTIFACT_KIND.IMAGE"
          :aria-label="t('spr.scan.actions.menu')"
        >
          <RcDropdownTrigger
            variant="link"
            size="medium"
            :aria-label="t('spr.scan.actions.menu')"
            :data-testid="`spr-artifact-actions-${ row.digest }`"
          >
            <i class="icon icon-actions" />
          </RcDropdownTrigger>
          <template #dropdownCollection>
            <template v-if="row.kind === ARTIFACT_KIND.IMAGE">
              <RcDropdownItem
                :data-testid="`spr-artifact-deploy-${ row.digest }`"
                @click="deploy(row)"
              >
                {{ t('spr.deploy.open') }}
              </RcDropdownItem>
              <RcDropdownSeparator v-if="showActions" />
            </template>
            <template
              v-for="type in [SCAN_TYPE.VULNERABILITY, SCAN_TYPE.SBOM]"
              :key="type"
            >
              <RcDropdownItem
                v-if="isScanActive(row, type) && scans.canStop(type)"
                :disabled="scans.isBusy(row, type)"
                @click="scans.stop(type, [row])"
              >
                {{ t(type === SCAN_TYPE.SBOM ? 'spr.scan.actions.stopSbom' : 'spr.scan.actions.stopScan') }}
              </RcDropdownItem>
              <RcDropdownItem
                v-else-if="scans.canStart(type)"
                :disabled="!isScannable(row) || isScanActive(row, type) || scans.isBusy(row, type)"
                @click="scans.start(type, [row])"
              >
                {{ t(type === SCAN_TYPE.SBOM ? 'spr.scan.actions.sbom' : 'spr.scan.actions.scan') }}
              </RcDropdownItem>
            </template>
          </template>
        </RcDropdown>
      </template>
      <template #cell:pulled="{ row }">
        <LiveDate
          v-if="pulled(row.pull_time)"
          :value="pulled(row.pull_time)"
          add-suffix
        />
        <span
          v-else
          class="text-muted"
        >{{ t('spr.artifacts.neverPulled') }}</span>
      </template>
    </SortableTable>
  </SprPage>
</template>

<style lang="scss" scoped>
.spr-breadcrumbs {
  display: flex;
  gap: 8px;
  margin-bottom: 5px;
}

.spr-bulk {
  display: flex;
  gap: 10px;
}
</style>
