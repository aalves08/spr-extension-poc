<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useStore } from 'vuex';
import { useRoute } from 'vue-router';
import { BadgeState } from '@components/BadgeState';
import RcCounterBadge from '@components/Pill/RcCounterBadge';
import LiveDate from '@shell/components/formatter/LiveDate.vue';
import SpacedRow from '@shell/components/Resource/Detail/SpacedRow.vue';
import Card from '@shell/components/Resource/Detail/Card/index.vue';
import PercentageBar from '@shell/components/Resource/Detail/PercentageBar.vue';
import IdentifyingInformation, { Row } from '@shell/components/Resource/Detail/Metadata/IdentifyingInformation/index.vue';
import { useSprI18n } from '../composables/useSprI18n';
import { PAGES, REGISTRY_QUERY, ROUTE_PARAMS, pageRouteName } from '../config/constants';
import { useActiveRegistry } from '../composables/useActiveRegistry';
import { useHarbor } from '../composables/useHarbor';
import { useAsyncData } from '../composables/useAsyncData';
import { HarborRepositoryRow } from '../types/harbor';
import { formatBytes, portalUrl } from '../utils/format';
import { repoNameWithoutProject } from '../utils/harbor-encoding';
import { normaliseSeverity } from '../utils/severity';
import SprPage from '../components/SprPage.vue';
import BooleanMark from '../components/BooleanMark.vue';
import UnavailableCard from '../components/UnavailableCard.vue';
import RepositoriesTable from '../components/RepositoriesTable.vue';

const store = useStore();
const route = useRoute();
const { t } = useSprI18n(store);
const { active } = useActiveRegistry();
const { clientFor } = useHarbor();

const projectName = computed(() => route.params.project as string);

const project = useAsyncData(async() => {
  if (!active.value) {
    return undefined;
  }

  const client = clientFor(active.value);
  const [details, summary] = await Promise.all([
    client.project(projectName.value),
    client.projectSummary(projectName.value).catch(() => undefined),
  ]);

  return { details, summary };
});

const repositories = useAsyncData(async() => {
  if (!active.value) {
    return [];
  }

  const list = await clientFor(active.value).repositories(projectName.value);

  return list.map((r): HarborRepositoryRow => ({
    ...r, project: projectName.value, shortName: repoNameWithoutProject(projectName.value, r.name)
  }));
});

const projectsRoute = computed(() => ({
  name: pageRouteName(PAGES.PROJECTS), params: ROUTE_PARAMS, query: active.value ? { [REGISTRY_QUERY]: active.value.id } : {}
}));

const details = computed(() => project.data.value?.details);
const summary = computed(() => project.data.value?.summary);
const meta = computed(() => details.value?.metadata || {});
const isTrue = (v?: string) => v === 'true';

const QUOTA_WARN_PERCENT = 85;

const quota = computed(() => {
  const q = summary.value?.quota;

  if (!q) {
    return undefined;
  }

  const used = q.used?.storage ?? 0;
  const hard = q.hard?.storage;
  const unlimited = hard === undefined || hard < 0;
  const percent = unlimited || !hard ? 0 : Math.min(100, Math.floor((used / hard) * 100));

  return {
    used, hard, unlimited, percent, warn: percent >= QUOTA_WARN_PERCENT
  };
});

const ROLES = [
  ['project_admin_count', 'admins'],
  ['maintainer_count', 'maintainers'],
  ['developer_count', 'developers'],
  ['guest_count', 'guests'],
  ['limited_guest_count', 'limitedGuests'],
] as const;

/** "1 admin, 2 developers" (roles without members are left out) */
const members = computed(() => {
  const s = summary.value;

  if (!s) {
    return undefined;
  }

  return ROLES
    .filter(([field]) => s[field])
    .map(([field, key]) => t(`spr.projects.roles.${ key }`, { count: s[field] }))
    .join(', ') || t('spr.projects.roles.none');
});

const detailRows = computed<Row[]>(() => {
  const d = details.value;

  if (!d) {
    return [];
  }

  const rows: Row[] = [
    { label: t('spr.projects.headers.access'), value: t(isTrue(meta.value.public) ? 'spr.projects.public' : 'spr.projects.private') },
    { label: t('spr.projects.headers.type'), value: t(d.registry_id ? 'spr.projects.proxyCache' : 'spr.projects.normal') },
  ];

  if (d.registry_id) {
    rows.push({ label: t('spr.projects.details.upstream'), value: summary.value?.registry?.name });
  }

  rows.push(
    {
      label:         t('spr.projects.details.created'),
      value:         d.creation_time,
      valueOverride: { component: LiveDate, props: { value: d.creation_time, addSuffix: true } }
    },
    { label: t('spr.projects.headers.members'), value: members.value },
  );

  return rows;
});

const policies = computed(() => {
  const preventVul = isTrue(meta.value.prevent_vul);
  const severity = normaliseSeverity(meta.value.severity).toLowerCase();

  return [
    { key: 'autoScan', on: isTrue(meta.value.auto_scan) },
    {
      key: 'preventVul', on: preventVul, detail: preventVul ? t('spr.projects.policies.severityAndAbove', { severity: t(`spr.severity.${ severity }`) }) : undefined
    },
    { key: 'cosign', on: isTrue(meta.value.enable_content_trust_cosign) },
    { key: 'autoSbom', on: isTrue(meta.value.auto_sbom_generation) },
    { key: 'retention', on: !!meta.value.retention_id },
  ];
});

function load() {
  project.run();
  repositories.run();
}

onMounted(load);
watch([() => active.value?.id, projectName], load);
</script>

<template>
  <SprPage
    :title="projectName"
    selector
  >
    <template #breadcrumbs>
      <div class="spr-breadcrumbs">
        <router-link :to="projectsRoute">
          {{ t('spr.projects.title') }}
        </router-link>
        <span class="text-muted">/</span>
      </div>
    </template>
    <template
      v-if="details?.registry_id"
      #title-extra
    >
      <BadgeState
        class="spr-project__badge"
        color="bg-info"
        :label="t('spr.projects.proxyCache')"
      />
    </template>
    <template
      v-if="details?.registry_id && summary?.registry"
      #description
    >
      {{ t('spr.projects.details.proxyOf', { name: summary.registry.name, url: summary.registry.url }) }}
    </template>
    <template #actions>
      <a
        v-if="active && details"
        class="btn role-secondary"
        :href="portalUrl.project(active.url, details.project_id)"
        target="_blank"
        rel="noopener noreferrer nofollow"
      >
        {{ t('spr.portal.open') }} <i class="icon icon-external-link ml-5" />
      </a>
    </template>

    <UnavailableCard
      v-if="project.error.value"
      :error="project.error.value"
    />
    <SpacedRow
      v-else-if="details"
      class="spr-project__cards"
      data-testid="spr-project-summary"
    >
      <Card :title="t('spr.projects.details.title')">
        <IdentifyingInformation :rows="detailRows" />
      </Card>

      <Card
        :title="t('spr.projects.policies.title')"
        data-testid="spr-project-policies"
      >
        <template
          v-if="active"
          #heading-action
        >
          <a
            :href="portalUrl.projectConfig(active.url, details.project_id)"
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            {{ t('spr.projects.policies.manage') }} <i class="icon icon-external-link" />
          </a>
        </template>
        <ul class="spr-policies">
          <li
            v-for="p in policies"
            :key="p.key"
            :data-testid="`spr-project-policy-${ p.key }`"
          >
            <span class="spr-policies__mark">
              <BooleanMark
                :value="p.on"
                :label="t(p.on ? 'spr.projects.policies.enabled' : 'spr.projects.policies.disabled')"
              />
            </span>
            <span :class="{ 'text-muted': !p.on }">{{ t(`spr.projects.policies.${ p.key }`) }}</span>
            <span
              v-if="p.detail"
              class="spr-policies__detail text-deemphasized"
            >{{ p.detail }}</span>
          </li>
        </ul>
      </Card>

      <Card
        :title="t('spr.projects.quota.title')"
        data-testid="spr-project-quota"
      >
        <template v-if="quota">
          <div class="spr-quota">
            <span class="text-deemphasized">{{ t('spr.projects.quota.used') }}</span>
            <span v-if="quota.unlimited">{{ formatBytes(quota.used) }}</span>
            <span v-else>
              {{ formatBytes(quota.used) }} / {{ formatBytes(quota.hard) }}
              <span class="spr-quota__sep">/</span>
              <strong :class="{ 'text-error': quota.warn }">{{ quota.percent }}%</strong>
            </span>
          </div>
          <PercentageBar
            v-if="!quota.unlimited"
            :percent="quota.percent"
            :percentage-color="quota.warn ? 'var(--error)' : undefined"
          />
          <p
            v-else
            class="text-muted"
          >
            {{ t('spr.projects.quota.noLimit') }}
          </p>
        </template>
        <p
          v-else
          class="text-muted"
        >
          {{ t('spr.projects.quota.unavailable') }}
        </p>
      </Card>
    </SpacedRow>

    <div class="spr-section-header">
      <h2>{{ t('spr.repositories.title') }}</h2>
      <RcCounterBadge
        v-if="repositories.data.value"
        :count="repositories.data.value.length"
        type="inactive"
      />
    </div>
    <UnavailableCard
      v-if="repositories.error.value"
      :error="repositories.error.value"
    />
    <RepositoriesTable
      v-else
      :rows="repositories.data.value || []"
      :loading="repositories.loading.value"
      no-rows-key="spr.repositories.none"
      data-testid="spr-repositories"
    />
  </SprPage>
</template>

<style lang="scss" scoped>
.spr-breadcrumbs {
  display: flex;
  gap: 8px;
  margin-bottom: 5px;
}

// Same size as the shell TitleBar state badge
.spr-project__badge {
  font-size: 16px;
}

.spr-project__cards {
  margin-bottom: 32px;
}

.spr-policies {
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    display: flex;
    align-items: center;
    gap: 8px;

    &:not(:last-child) {
      margin-bottom: 8px;
    }
  }
}

// Checkmark and dash differ in width, keep the labels aligned
.spr-policies__mark {
  flex: 0 0 16px;
  text-align: center;
}

.spr-policies__detail {
  margin-left: auto;
  white-space: nowrap;
}

// Same layout as the shell ResourceUsageCard
.spr-quota {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.spr-quota__sep {
  margin: 0 8px;
}

.spr-section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;

  h2 {
    margin: 0;
  }
}
</style>
