<script setup lang="ts">
import { computed } from 'vue';
import { useStore } from 'vuex';
import { useSprI18n } from '../composables/useSprI18n';
import { JOB_STATUS, normaliseJobStatus } from '../utils/status';

/**
 * Job / scan status pill (SUSE Security StatusBadge): status colour at 30% alpha, failed is solid red.
 */
const props = defineProps<{
  /** Raw Harbor status (`Success`, `Succeed`, `InProgress`, `healthy`...) */
  status?: string;
  /** Overrides the translated status */
  label?: string;
}>();

const store = useStore();
const { t } = useSprI18n(store);

const key = computed(() => normaliseJobStatus(props.status));
const text = computed(() => props.label || (key.value === JOB_STATUS.UNKNOWN ? (props.status || t('spr.state.unknown')) : t(`spr.scan.statuses.${ key.value }`)));
</script>

<template>
  <span
    class="spr-status-pill"
    :class="key"
    data-testid="spr-status-pill"
  >{{ text }}</span>
</template>

<style lang="scss" scoped>
@import '../styles/palette';

.spr-status-pill {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 30px;
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
  color: rgba(0, 0, 0, 0.65);
  background: rgba($spr-status-pending, 0.3);

  body.theme-dark & {
    color: rgba(255, 255, 255, 0.65);
  }

  &.success { background: rgba($spr-status-success, 0.3); }
  &.running { background: rgba($spr-status-running, 0.3); }
  &.scheduled { background: rgba($spr-status-scheduled, 0.3); }

  &.error {
    background: $spr-status-error;
    color: #fff;
  }
}
</style>
