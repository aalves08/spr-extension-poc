<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useStore } from 'vuex';
import { useRoute } from 'vue-router';
import { Checkbox } from '@components/Form/Checkbox';
import SortableTable from '@shell/components/SortableTable/index.vue';
import CopyToClipboardText from '@shell/components/CopyToClipboardText.vue';
import LiveDate from '@shell/components/formatter/LiveDate.vue';
import Select from '@shell/components/form/Select.vue';
import AsyncButton from '@shell/components/AsyncButton.vue';
import Tabbed from '@shell/components/Tabbed/index.vue';
import Tab from '@shell/components/Tabbed/Tab.vue';
import { useSprI18n } from '../composables/useSprI18n';
import { useShell } from '@shell/apis';
import { NotificationLevel } from '@shell/types/notifications';
import { downloadFile } from '@shell/utils/download';
import { PAGES, REGISTRY_QUERY, ROUTE_PARAMS, pageRouteName } from '../config/constants';
import {
  HarborArtifact, HarborDangerousCve, HarborVulnerability, SCAN_TYPE, ScanType
} from '../types/harbor';
import { useActiveRegistry } from '../composables/useActiveRegistry';
import { invalidateHarborCache, normaliseHarborError, useHarbor } from '../composables/useHarbor';
import { useAsyncData } from '../composables/useAsyncData';
import { useArtifactScans } from '../composables/useArtifactScans';
import { useSprActions } from '../composables/useSprActions';
import { formatBytes, portalUrl, pullCommand } from '../utils/format';
import {
  ARTIFACT_KIND, artifactKind, hasSbom, isScanActive, isScannable, isSigned, platform, projectRoute, repositoryRoute, scanSummary, signatures, tagNames
} from '../utils/artifact';
import { SEVERITIES, normaliseSeverity, severityRank } from '../utils/severity';
import { JOB_STATUS, normaliseJobStatus } from '../utils/status';
import { shortDigest } from '../utils/image-ref';
import SprPage from '../components/SprPage.vue';
import UnavailableCard from '../components/UnavailableCard.vue';
import RunningInTable from '../components/RunningInTable.vue';
import DigestCopy from '../components/DigestCopy.vue';
import StatusPill from '../components/StatusPill.vue';
import SeverityBadge from '../components/SeverityBadge.vue';
import SeverityDistribution from '../components/SeverityDistribution.vue';
import SummaryStrip from '../components/overview/SummaryStrip.vue';
import SummaryBlock from '../components/overview/SummaryBlock.vue';
import TopCves from '../components/overview/TopCves.vue';

const store = useStore();
const route = useRoute();
const { t } = useSprI18n(store);
const shell = useShell();
const { active } = useActiveRegistry();
const { clientFor } = useHarbor();
const actions = useSprActions();

const projectName = computed(() => route.params.project as string);
const repoName = computed(() => route.params.repo as string);
const digest = computed(() => route.params.digest as string);

const artifact = useAsyncData<HarborArtifact>(() => {
  if (!active.value) {
    throw new Error('No active registry');
  }

  return clientFor(active.value).artifact(projectName.value, repoName.value, digest.value);
});

const report = useAsyncData(() => {
  if (!active.value) {
    throw new Error('No active registry');
  }

  return clientFor(active.value).vulnerabilities(projectName.value, repoName.value, digest.value);
});

const a = computed(() => artifact.data.value);
const scan = computed(() => scanSummary(a.value));
const tags = computed(() => tagNames(a.value));
const title = computed(() => `${ repoName.value }:${ tags.value[0] || shortDigest(digest.value) }`);
const pull = computed(() => (active.value ? pullCommand(active.value.host, projectName.value, repoName.value, tags.value[0], digest.value) : ''));

// ---- Scans ----------------------------------------------------------------------------------------------------------

const scanTargets = computed(() => (a.value ? [a.value] : []));

const scans = useArtifactScans({
  connection: active,
  project:    projectName,
  repo:       repoName,
  artifacts:  scanTargets,
  reload:     async() => {
    if (active.value) {
      invalidateHarborCache(active.value.id);
    }
    await artifact.run({ silent: true });
  },
});

const vulnActive = computed(() => isScanActive(a.value, SCAN_TYPE.VULNERABILITY));
const sbomActive = computed(() => isScanActive(a.value, SCAN_TYPE.SBOM));
const sbomFailed = computed(() => normaliseJobStatus(a.value?.sbom_overview?.scan_status) === JOB_STATUS.ERROR);

async function startScan(type: ScanType, btnCb: (ok: boolean) => void) {
  btnCb(await scans.start(type, scanTargets.value));
}

async function stopScan(type: ScanType, btnCb: (ok: boolean) => void) {
  btnCb(await scans.stop(type, scanTargets.value));
}

// Fetch the new report once a scan finishes
watch(vulnActive, (now, before) => {
  if (before && !now) {
    report.run();
  }
});

// ---- Vulnerabilities ------------------------------------------------------------------------------------------------

const severityFilter = ref<string>('');
const fixableOnly = ref(false);

const severityOptions = computed(() => [
  { label: t('spr.vulnerabilities.allSeverities'), value: '' },
  ...SEVERITIES.map((s) => ({ label: t(`spr.severity.${ s.toLowerCase() }`), value: s })),
]);

const allVulns = computed(() => report.data.value?.vulnerabilities || []);

// From the report (not the artifact's scan summary) so the counts always match the table
const severityCounts = computed(() => SEVERITIES.reduce((acc, sev) => {
  acc[sev] = allVulns.value.filter((v) => normaliseSeverity(v.severity) === sev).length;

  return acc;
}, {} as Record<string, number>));

const fixableCount = computed(() => allVulns.value.filter((v) => !!v.fix_version).length);

// One entry per CVE: the report has a row per affected package
const topCves = computed(() => {
  const byId = new Map<string, HarborDangerousCve & { url?: string; packages: string[] }>();

  for (const v of allVulns.value) {
    const score = v.preferred_cvss?.score_v3;
    const existing = byId.get(v.id);

    if (!existing) {
      byId.set(v.id, {
        cve_id:        v.id,
        severity:      v.severity,
        cvss_score_v3: score,
        url:           cveLink(v),
        packages:      [v.package],
      });
      continue;
    }

    if (score !== undefined && (existing.cvss_score_v3 === undefined || score > existing.cvss_score_v3)) {
      existing.cvss_score_v3 = score;
    }
    if (severityRank(v.severity) < severityRank(existing.severity)) {
      existing.severity = v.severity;
    }
    if (!existing.packages.includes(v.package)) {
      existing.packages.push(v.package);
    }
  }

  return [...byId.values()].map(({ packages, ...cve }) => ({ ...cve, package: packages.join(', ') }));
});

const vulnRows = computed(() => allVulns.value
  .filter((v) => !severityFilter.value || normaliseSeverity(v.severity) === severityFilter.value)
  .filter((v) => !fixableOnly.value || !!v.fix_version)
  .map((v: HarborVulnerability) => ({
    ...v,
    key:          `${ v.id }/${ v.package }/${ v.version }`,
    severityRank: severityRank(v.severity),
    cvss:         v.preferred_cvss?.score_v3 ?? v.preferred_cvss?.score_v2,
  })));

const vulnHeaders = [
  {
    name: 'severity', labelKey: 'spr.vulnerabilities.headers.severity', value: 'severity', sort: ['severityRank', 'cvss:desc']
  },
  {
    name: 'cve', labelKey: 'spr.vulnerabilities.headers.cve', value: 'id', sort: ['id']
  },
  {
    name: 'package', labelKey: 'spr.vulnerabilities.headers.package', value: 'package', sort: ['package']
  },
  {
    name: 'installed', labelKey: 'spr.vulnerabilities.headers.installed', value: 'version'
  },
  {
    name: 'fixed', labelKey: 'spr.vulnerabilities.headers.fixed', value: 'fix_version'
  },
  {
    name: 'cvss', labelKey: 'spr.vulnerabilities.headers.cvss', value: 'cvss', sort: ['cvss:desc'], width: 70
  },
  {
    name: 'description', labelKey: 'spr.vulnerabilities.headers.description', value: 'description'
  },
  {
    name: 'exposure', labelKey: 'spr.vulnerabilities.headers.exposure', align: 'center', width: 90
  },
];

function cveLink(v: HarborVulnerability): string | undefined {
  return v.links?.[0] || (v.id?.startsWith('CVE-') ? `https://nvd.nist.gov/vuln/detail/${ v.id }` : undefined);
}

// ---- Accessories ----------------------------------------------------------------------------------------------------

const accessoryHeaders = [
  {
    name: 'type', labelKey: 'spr.accessories.headers.type', value: 'type', sort: ['type']
  },
  {
    name: 'digest', labelKey: 'spr.accessories.headers.digest', value: 'digest'
  },
  {
    name: 'size', labelKey: 'spr.accessories.headers.size', value: 'size', sort: ['size']
  },
  {
    name: 'created', labelKey: 'spr.accessories.headers.created', value: 'creation_time', formatter: 'LiveDate', sort: ['creation_time:desc']
  },
];

const accessoryLabel = (type: string) => store.getters['i18n/withFallback'](`spr.accessories.types.${ type.replace(/\./g, '_') }`, null, type);

// ---- SBOM -----------------------------------------------------------------------------------------------------------

async function downloadSbom(btnCb: (ok: boolean) => void) {
  const sbomDigest = a.value?.sbom_overview?.sbom_digest;

  if (!active.value || !sbomDigest) {
    btnCb(false);

    return;
  }

  try {
    const doc = await clientFor(active.value).sbom(projectName.value, repoName.value, sbomDigest);
    const {
      _status, _headers, _statusText, ...clean
    } = doc || {}; // eslint-disable-line @typescript-eslint/no-unused-vars

    await downloadFile(`${ repoName.value.replace(/\//g, '_') }-${ shortDigest(digest.value).replace(':', '-') }.sbom.json`, JSON.stringify(clean, null, 2), 'application/json');
    btnCb(true);
  } catch (e) {
    shell.notification.send(NotificationLevel.Error, t('spr.sbom.downloadFailed'), normaliseHarborError(e).message);
    btnCb(false);
  }
}

// ---- Running in -----------------------------------------------------------------------------------------------------

// Pods report the digest they pulled: the index digest for multi-arch pulls by tag, or a platform manifest digest
const runningDigests = computed(() => [digest.value, ...(a.value?.references || []).map((r) => r.child_digest)].filter(Boolean));

function deploy() {
  if (active.value && a.value) {
    actions.deployImage({
      connection: active.value, project: projectName.value, repo: repoName.value, artifact: a.value
    });
  }
}

function exposure(cveId: string) {
  if (active.value) {
    actions.cveExposure({
      connection: active.value, cveId, knownDigests: runningDigests.value
    });
  }
}

function packageSearch(packageName: string) {
  if (active.value) {
    actions.packageSearch({ connection: active.value, packageName });
  }
}

const projectsRoute = computed(() => ({
  name: pageRouteName(PAGES.PROJECTS), params: ROUTE_PARAMS, query: active.value ? { [REGISTRY_QUERY]: active.value.id } : {}
}));

function pulled(time?: string): string | undefined {
  return time && !time.startsWith('0001-') ? time : undefined;
}

function load() {
  artifact.run();
  report.run();
}

onMounted(load);
watch([() => active.value?.id, projectName, repoName, digest], load);
</script>

<template>
  <SprPage :title="title">
    <template #breadcrumbs>
      <div class="spr-breadcrumbs">
        <router-link :to="projectsRoute">
          {{ t('spr.projects.title') }}
        </router-link>
        <span class="text-muted">/</span>
        <template v-if="active">
          <router-link :to="projectRoute(active.id, projectName)">
            {{ projectName }}
          </router-link>
          <span class="text-muted">/</span>
          <router-link :to="repositoryRoute(active.id, projectName, repoName)">
            {{ repoName }}
          </router-link>
          <span class="text-muted">/</span>
        </template>
      </div>
    </template>
    <template #actions>
      <div class="spr-artifact__actions">
        <template v-if="a && isScannable(a)">
          <AsyncButton
            v-if="vulnActive && scans.canStop(SCAN_TYPE.VULNERABILITY)"
            key="stop-scan"
            mode="edit"
            action-color="role-secondary"
            icon="icon-close"
            :action-label="t('spr.scan.actions.stopScan')"
            :waiting-label="t('spr.scan.actions.stopping')"
            data-testid="spr-scan-stop"
            @click="stopScan(SCAN_TYPE.VULNERABILITY, $event)"
          />
          <AsyncButton
            v-else-if="!vulnActive && scans.canStart(SCAN_TYPE.VULNERABILITY)"
            key="start-scan"
            mode="edit"
            icon="icon-play"
            :action-label="t(scan ? 'spr.scan.actions.rescan' : 'spr.scan.actions.scan')"
            :waiting-label="t('spr.scan.actions.starting')"
            :success-label="t('spr.scan.actions.started')"
            data-testid="spr-scan-start"
            @click="startScan(SCAN_TYPE.VULNERABILITY, $event)"
          />
          <AsyncButton
            v-if="sbomActive && scans.canStop(SCAN_TYPE.SBOM)"
            key="stop-sbom"
            mode="edit"
            action-color="role-secondary"
            icon="icon-close"
            :action-label="t('spr.scan.actions.stopSbom')"
            :waiting-label="t('spr.scan.actions.stopping')"
            data-testid="spr-sbom-stop"
            @click="stopScan(SCAN_TYPE.SBOM, $event)"
          />
          <AsyncButton
            v-else-if="!sbomActive && scans.canStart(SCAN_TYPE.SBOM)"
            key="start-sbom"
            mode="edit"
            action-color="role-secondary"
            icon="icon-file"
            :action-label="t(hasSbom(a) ? 'spr.scan.actions.regenerateSbom' : 'spr.scan.actions.sbom')"
            :waiting-label="t('spr.scan.actions.starting')"
            :success-label="t('spr.scan.actions.started')"
            data-testid="spr-sbom-start"
            @click="startScan(SCAN_TYPE.SBOM, $event)"
          />
        </template>
        <button
          v-if="a && artifactKind(a) === ARTIFACT_KIND.IMAGE"
          type="button"
          class="btn role-primary"
          data-testid="spr-artifact-deploy"
          @click="deploy"
        >
          <i class="icon icon-upload mr-5" />{{ t('spr.deploy.open') }}
        </button>
        <a
          v-if="active && a"
          class="btn role-secondary"
          :href="portalUrl.artifact(active.url, a.project_id, repoName, digest)"
          target="_blank"
          rel="noopener noreferrer nofollow"
        >
          {{ t('spr.portal.open') }} <i class="icon icon-external-link ml-5" />
        </a>
      </div>
    </template>

    <UnavailableCard
      v-if="artifact.error.value"
      :error="artifact.error.value"
    />

    <template v-else-if="a">
      <dl
        class="spr-props mb-20"
        data-testid="spr-artifact-header"
      >
        <div class="spr-props__item">
          <dt>{{ t('spr.artifacts.headers.digest') }}</dt>
          <dd><DigestCopy :digest="a.digest" /></dd>
        </div>
        <div class="spr-props__item">
          <dt>{{ t('spr.artifacts.headers.type') }}</dt>
          <dd>{{ t(`spr.artifacts.kind.${ artifactKind(a) }`) }}</dd>
        </div>
        <div class="spr-props__item">
          <dt>{{ t('spr.artifacts.headers.platform') }}</dt>
          <dd>
            <span v-if="platform(a)">{{ platform(a) }}</span>
            <span
              v-else
              class="text-muted"
            >&mdash;</span>
          </dd>
        </div>
        <div class="spr-props__item">
          <dt>{{ t('spr.artifacts.headers.size') }}</dt>
          <dd>{{ formatBytes(a.size) }}</dd>
        </div>
        <div class="spr-props__item">
          <dt>{{ t('spr.artifacts.headers.pushed') }}</dt>
          <dd>
            <LiveDate
              :value="a.push_time"
              add-suffix
            />
          </dd>
        </div>
        <div class="spr-props__item">
          <dt>{{ t('spr.artifacts.headers.pulled') }}</dt>
          <dd>
            <LiveDate
              v-if="pulled(a.pull_time)"
              :value="pulled(a.pull_time)"
              add-suffix
            />
            <span
              v-else
              class="text-muted"
            >{{ t('spr.artifacts.neverPulled') }}</span>
          </dd>
        </div>
        <div class="spr-props__item">
          <dt>{{ t('spr.artifacts.headers.signed') }}</dt>
          <dd>
            <span
              v-if="isSigned(a)"
              class="text-success"
            ><i class="icon icon-checkmark mr-5" />{{ t('spr.artifacts.signed') }}</span>
            <span
              v-else
              class="text-muted"
            >{{ t('spr.artifacts.unsigned') }}</span>
          </dd>
        </div>
        <div class="spr-props__item">
          <dt>{{ t('spr.artifacts.headers.sbom') }}</dt>
          <dd>
            <span
              v-if="sbomActive"
              class="text-muted"
            ><i class="icon icon-spinner icon-spin mr-5" />{{ scans.statusLabel(a.sbom_overview?.scan_status) }}</span>
            <StatusPill
              v-else-if="sbomFailed"
              :status="a.sbom_overview?.scan_status"
            />
            <span
              v-else-if="hasSbom(a)"
              class="text-success"
            ><i class="icon icon-checkmark mr-5" />{{ t('spr.sbom.available') }}</span>
            <span
              v-else
              class="text-muted"
            >{{ t('spr.sbom.notGenerated') }}</span>
          </dd>
        </div>
        <div class="spr-props__item">
          <dt>{{ t('spr.scan.status') }}</dt>
          <dd>
            <span
              v-if="vulnActive"
              class="text-muted"
            ><i class="icon icon-spinner icon-spin mr-5" />{{ scans.statusLabel(scan?.scan_status) }}</span>
            <template v-else-if="scan">
              <StatusPill :status="scan.scan_status" />
              <LiveDate
                v-if="scan.end_time"
                class="text-muted ml-5"
                :value="scan.end_time"
                add-suffix
              />
            </template>
            <span
              v-else
              class="text-muted"
            >{{ t('spr.scan.notScanned') }}</span>
          </dd>
        </div>
        <div
          v-if="tags.length"
          class="spr-props__item spr-props__item--wide"
        >
          <dt>{{ t('spr.artifacts.headers.tags') }}</dt>
          <dd>{{ tags.join(', ') }}</dd>
        </div>
        <div class="spr-props__item spr-props__item--full">
          <dt>{{ t('spr.artifacts.headers.pull') }}</dt>
          <dd><CopyToClipboardText :text="pull" /></dd>
        </div>
      </dl>

      <Tabbed
        :use-hash="true"
        default-tab="vulnerabilities"
      >
        <Tab
          name="vulnerabilities"
          :label="t('spr.artifactTabs.vulnerabilities')"
          :weight="4"
        >
          <UnavailableCard
            v-if="report.error.value"
            :error="report.error.value"
          />
          <template v-else>
            <SummaryStrip
              v-if="allVulns.length"
              data-testid="spr-vulnerability-summary"
            >
              <SummaryBlock
                :title="t('spr.overview.vulnerabilities.title')"
                :tooltip="t('spr.vulnerabilities.summaryTooltip')"
                :grow="2"
              >
                <SeverityDistribution
                  :summary="severityCounts"
                  selectable
                  :selected="severityFilter"
                  @select="severityFilter = $event"
                >
                  <a
                    v-if="fixableCount"
                    href="#"
                    :class="{ 'spr-artifact__fixable--active': fixableOnly }"
                    :aria-pressed="fixableOnly"
                    @click.prevent="fixableOnly = !fixableOnly"
                  >{{ t('spr.overview.vulnerabilities.fixable', { count: fixableCount }) }}</a>
                </SeverityDistribution>
              </SummaryBlock>
              <SummaryBlock
                :title="t('spr.overview.topCves.title')"
                :grow="3"
              >
                <TopCves
                  :cves="topCves"
                  exposure
                  @exposure="exposure"
                />
              </SummaryBlock>
            </SummaryStrip>
            <SortableTable
              :headers="vulnHeaders"
              :rows="vulnRows"
              key-field="key"
              :loading="report.loading.value"
              :table-actions="false"
              :row-actions="false"
              default-sort-by="severity"
              :paging="true"
              :rows-per-page="50"
              :no-rows-key="report.data.value || report.loading.value ? 'spr.vulnerabilities.none' : 'spr.vulnerabilities.noReport'"
              data-testid="spr-vulnerabilities"
            >
              <template #header-left>
                <div class="spr-artifact__filters">
                  <Select
                    class="spr-artifact__severity"
                    :value="severityFilter"
                    :options="severityOptions"
                    :clearable="false"
                    :aria-label="t('spr.vulnerabilities.severityFilter')"
                    @update:value="severityFilter = $event"
                  />
                  <Checkbox
                    v-model:value="fixableOnly"
                    :label="t('spr.vulnerabilities.fixableOnly')"
                  />
                </div>
              </template>
              <template #cell:severity="{ row }">
                <SeverityBadge :severity="row.severity" />
              </template>
              <template #cell:cve="{ row }">
                <a
                  v-if="cveLink(row)"
                  :href="cveLink(row)"
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                >{{ row.id }}</a>
                <span v-else>{{ row.id }}</span>
              </template>
              <template #cell:exposure="{ row }">
                <div class="spr-artifact__exposure">
                  <button
                    v-clean-tooltip="t('spr.exposure.action')"
                    type="button"
                    class="btn btn-sm role-link"
                    :aria-label="t('spr.exposure.actionFor', { cve: row.id })"
                    :data-testid="`spr-cve-exposure-${ row.id }`"
                    @click="exposure(row.id)"
                  >
                    <i class="icon icon-search" />
                  </button>
                </div>
              </template>
              <template #cell:package="{ row }">
                <a
                  v-clean-tooltip="t('spr.packageSearch.findTooltip', { package: row.package })"
                  href="#"
                  :data-testid="`spr-package-search-${ row.package }`"
                  @click.prevent="packageSearch(row.package)"
                >{{ row.package }}</a>
              </template>
              <template #cell:fixed="{ row }">
                <span v-if="row.fix_version">{{ row.fix_version }}</span>
                <span
                  v-else
                  class="text-muted"
                >{{ t('spr.vulnerabilities.noFix') }}</span>
              </template>
              <template #cell:description="{ row }">
                <span
                  v-clean-tooltip="row.description"
                  class="spr-artifact__description"
                >{{ row.description }}</span>
              </template>
            </SortableTable>
          </template>
        </Tab>

        <Tab
          name="sbom"
          :label="t('spr.artifactTabs.sbom')"
          :weight="3"
        >
          <dl
            v-if="a.sbom_overview && a.sbom_overview.scan_status"
            class="spr-props mb-15"
          >
            <div class="spr-props__item">
              <dt>{{ t('spr.sbom.headers.status') }}</dt>
              <dd>
                <span
                  v-if="sbomActive"
                  class="text-muted"
                ><i class="icon icon-spinner icon-spin mr-5" />{{ scans.statusLabel(a.sbom_overview.scan_status) }}</span>
                <StatusPill
                  v-else
                  :status="a.sbom_overview.scan_status"
                />
              </dd>
            </div>
            <div class="spr-props__item">
              <dt>{{ t('spr.sbom.headers.generated') }}</dt>
              <dd>
                <LiveDate
                  v-if="a.sbom_overview.end_time && !sbomActive"
                  :value="a.sbom_overview.end_time"
                  add-suffix
                />
                <span
                  v-else
                  class="text-muted"
                >&mdash;</span>
              </dd>
            </div>
            <div class="spr-props__item">
              <dt>{{ t('spr.sbom.headers.generator') }}</dt>
              <dd>
                <span v-if="a.sbom_overview.scanner">{{ [a.sbom_overview.scanner.name, a.sbom_overview.scanner.version].filter(Boolean).join(' ') }}</span>
                <span
                  v-else
                  class="text-muted"
                >&mdash;</span>
              </dd>
            </div>
            <div class="spr-props__item">
              <dt>{{ t('spr.artifacts.headers.digest') }}</dt>
              <dd>
                <DigestCopy
                  v-if="a.sbom_overview.sbom_digest"
                  :digest="a.sbom_overview.sbom_digest"
                />
                <span
                  v-else
                  class="text-muted"
                >&mdash;</span>
              </dd>
            </div>
          </dl>
          <p
            v-else
            class="text-muted mb-15"
          >
            {{ t('spr.sbom.none') }}
          </p>
          <AsyncButton
            v-if="a.sbom_overview?.sbom_digest && !sbomActive"
            mode="download"
            data-testid="spr-sbom-download"
            @click="downloadSbom"
          />
        </Tab>

        <Tab
          name="accessories"
          :label="t('spr.artifactTabs.accessories')"
          :weight="2"
        >
          <p class="text-muted mb-10">
            {{ t('spr.accessories.summary', { signatures: signatures(a).length, total: (a.accessories || []).length }) }}
          </p>
          <SortableTable
            :headers="accessoryHeaders"
            :rows="a.accessories || []"
            key-field="id"
            :table-actions="false"
            :row-actions="false"
            :search="false"
            no-rows-key="spr.accessories.none"
            data-testid="spr-accessories"
          >
            <template #cell:type="{ row }">
              {{ accessoryLabel(row.type) }}
            </template>
            <template #cell:digest="{ row }">
              <DigestCopy :digest="row.digest" />
            </template>
            <template #cell:size="{ row }">
              {{ formatBytes(row.size) }}
            </template>
          </SortableTable>
        </Tab>

        <Tab
          name="running"
          :label="t('spr.artifactTabs.runningIn')"
          :weight="1"
        >
          <RunningInTable
            v-if="active"
            :host="active.host"
            :digests="runningDigests"
          />
        </Tab>
      </Tabbed>
    </template>
  </SprPage>
</template>

<style lang="scss" scoped>
.spr-breadcrumbs {
  display: flex;
  gap: 8px;
  margin-bottom: 5px;
}

.spr-artifact__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

// Property grid: muted label above the value, same border as the summary strips
.spr-props {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px 24px;
  margin-top: 0;
  padding: 16px 20px;
  border: var(--border-width) solid var(--input-border);
  border-radius: 6px;

  dt {
    margin-bottom: 4px;
    color: var(--muted);
    font-weight: normal;
  }

  dd {
    display: flex;
    align-items: center;
    min-height: 24px;
    margin: 0;
    overflow-wrap: anywhere;
  }
}

.spr-props__item--wide {
  grid-column: span 2;
}

.spr-props__item--full {
  grid-column: 1 / -1;
}

.spr-artifact__filters {
  display: flex;
  align-items: center;
  gap: 20px;
}

.spr-artifact__severity {
  min-width: 200px;
}

.spr-artifact__fixable--active {
  font-weight: 700;
  text-decoration: underline;
}

.spr-artifact__exposure {
  display: flex;
  justify-content: center;

  .btn {
    min-height: auto;
    padding: 0 4px;
    line-height: 1;
  }
}

.spr-artifact__description {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  max-width: 500px;
}
</style>
