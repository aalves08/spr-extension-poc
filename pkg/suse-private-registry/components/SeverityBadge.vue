<script setup lang="ts">
import { computed } from 'vue';
import { useStore } from 'vuex';
import { useSprI18n } from '../composables/useSprI18n';
import { normaliseSeverity } from '../utils/severity';

/**
 * Fixed-width badge in the severity palette. Shows the severity, or `text` (e.g. a CVSS score) with the severity as tooltip.
 */
const props = defineProps<{
  severity?: string;
  text?: string;
}>();

const store = useStore();
const { t } = useSprI18n(store);

const key = computed(() => normaliseSeverity(props.severity).toLowerCase());
const label = computed(() => t(`spr.severity.${ key.value }`));
</script>

<template>
  <span
    v-clean-tooltip="props.text ? label : ''"
    class="spr-severity-badge"
    :class="key"
    data-testid="spr-severity-badge"
  >{{ props.text || label }}</span>
</template>

<style lang="scss" scoped>
@import '../styles/palette';

.spr-severity-badge {
  display: inline-block;
  min-width: 80px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 13px;
  line-height: 18px;
  text-align: center;
  white-space: nowrap;
  @include spr-severity-colors;
}
</style>
