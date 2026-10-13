<script setup lang="ts">
import { computed } from 'vue';
import { useStore } from 'vuex';
import { useSprI18n } from '../composables/useSprI18n';
import { SEVERITIES } from '../utils/severity';
import SeverityAmountBar from './SeverityAmountBar.vue';

/**
 * Severity summary for table cells: segmented bar with counts, or the scan state when there's nothing to show.
 */
const props = defineProps<{
  summary?: Record<string, number>;
  /** Shown when there is no summary (not scanned, scan running...) */
  emptyLabel?: string;
  /** A scan is running: show the status with a spinner instead of the (previous) results */
  busy?: boolean;
}>();

const store = useStore();
const { t } = useSprI18n(store);

const total = computed(() => SEVERITIES.reduce((sum, sev) => sum + (props.summary?.[sev] || 0), 0));
</script>

<template>
  <span
    v-if="props.busy"
    class="text-muted"
    data-testid="spr-severity-bar-busy"
  ><i class="icon icon-spinner icon-spin mr-5" />{{ props.emptyLabel }}</span>
  <SeverityAmountBar
    v-else-if="props.summary && total"
    class="spr-severity-bar"
    :summary="props.summary"
    data-testid="spr-severity-bar"
  />
  <span
    v-else-if="props.summary"
    class="text-success"
  ><i class="icon icon-checkmark mr-5" />{{ t('spr.severity.none') }}</span>
  <span
    v-else
    class="text-muted"
  >{{ props.emptyLabel || t('spr.scan.notScanned') }}</span>
</template>

<style lang="scss" scoped>
.spr-severity-bar {
  min-width: 200px;
  max-width: 280px;
}
</style>
