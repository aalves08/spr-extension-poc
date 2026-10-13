<script setup lang="ts">
import { computed } from 'vue';
import { useStore } from 'vuex';
import { useSprI18n } from '../../composables/useSprI18n';
import { HarborDangerousCve } from '../../types/harbor';
import { severityRank } from '../../utils/severity';
import SeverityBadge from '../SeverityBadge.vue';

const ROWS = 5;

/** `url` overrides the NVD link (artifact reports carry their own links) */
type TopCve = HarborDangerousCve & { url?: string };

/**
 * Top 5 CVEs in fixed columns (CVE, score badge, package). Never wraps; pads to 5 rows so the strip keeps its height.
 */
const props = withDefaults(defineProps<{
  cves: TopCve[];
  /** Show the "Who's exposed?" action */
  exposure?: boolean;
}>(), { exposure: false });

const emit = defineEmits<{(e: 'exposure', cveId: string): void}>();

const store = useStore();
const { t } = useSprI18n(store);

const rows = computed(() => {
  const sorted = [...props.cves]
    .sort((a, b) => (b.cvss_score_v3 ?? -1) - (a.cvss_score_v3 ?? -1) || severityRank(a.severity) - severityRank(b.severity))
    .slice(0, ROWS)
    .map((c) => ({
      ...c,
      key:   `${ c.cve_id }/${ c.package }/${ c.version }`,
      url:   c.url || (c.cve_id?.startsWith('CVE-') ? `https://nvd.nist.gov/vuln/detail/${ c.cve_id }` : undefined),
      score: c.cvss_score_v3 !== undefined && c.cvss_score_v3 !== null ? t('spr.overview.topCves.score', { score: c.cvss_score_v3 }) : undefined,
      pkg:   [c.package, c.version].filter(Boolean).join(' '),
    }));

  return sorted;
});

const padding = computed(() => Math.max(0, ROWS - rows.value.length));
</script>

<template>
  <div
    class="spr-top-cves"
    data-testid="spr-top-cves"
  >
    <div class="spr-top-cves__row spr-top-cves__head text-muted">
      <span class="spr-top-cves__cve">{{ t('spr.vulnerabilities.headers.cve') }}</span>
      <span class="spr-top-cves__score">{{ t('spr.vulnerabilities.headers.cvss') }}</span>
      <span class="spr-top-cves__pkg">{{ t('spr.vulnerabilities.headers.package') }}</span>
      <span
        v-if="props.exposure"
        class="spr-top-cves__action"
      >{{ t('spr.vulnerabilities.headers.exposure') }}</span>
    </div>
    <div
      v-for="r in rows"
      :key="r.key"
      class="spr-top-cves__row"
    >
      <span class="spr-top-cves__cve">
        <a
          v-if="r.url"
          :href="r.url"
          :title="r.cve_id"
          target="_blank"
          rel="noopener noreferrer nofollow"
        >{{ r.cve_id }}</a>
        <span
          v-else
          :title="r.cve_id"
        >{{ r.cve_id }}</span>
      </span>
      <span class="spr-top-cves__score">
        <SeverityBadge
          class="spr-top-cves__badge"
          :severity="r.severity"
          :text="r.score"
        />
      </span>
      <span
        class="spr-top-cves__pkg"
        :title="r.pkg"
      >{{ r.pkg }}</span>
      <span
        v-if="props.exposure"
        class="spr-top-cves__action"
      >
        <button
          v-clean-tooltip="t('spr.exposure.action')"
          type="button"
          class="btn btn-sm role-link"
          :aria-label="t('spr.exposure.actionFor', { cve: r.cve_id })"
          :data-testid="`spr-top-cves-exposure-${ r.cve_id }`"
          @click="emit('exposure', r.cve_id)"
        >
          <i class="icon icon-search" />
        </button>
      </span>
    </div>
    <div
      v-for="n in padding"
      :key="`pad-${ n }`"
      class="spr-top-cves__row spr-top-cves__pad"
    />
  </div>
</template>

<style lang="scss" scoped>
.spr-top-cves__row {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 36px;
  padding: 0 8px;
  border-radius: 4px;

  &:not(.spr-top-cves__head):not(.spr-top-cves__pad):hover {
    background: var(--sortable-table-selected-bg);
  }
}

.spr-top-cves__head {
  height: 24px;
  font-size: 12px;
}

.spr-top-cves__cve,
.spr-top-cves__pkg {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.spr-top-cves__cve {
  width: 170px;
  flex-shrink: 0;
}

.spr-top-cves__score {
  width: 112px;
  flex-shrink: 0;
}

.spr-top-cves__pkg {
  flex: 1;
  min-width: 0;
}

.spr-top-cves__action {
  width: 64px;
  flex-shrink: 0;
  text-align: center;

  .btn {
    min-height: auto;
    padding: 0 4px;
    line-height: 1;
  }
}

.spr-top-cves__badge {
  width: 96px;
}
</style>
