<script setup lang="ts">
import { computed } from 'vue';
import { useStore } from 'vuex';
import { useSprI18n } from '../composables/useSprI18n';
import { SEVERITIES } from '../utils/severity';

/**
 * Segmented strip, one equal-width segment per severity with its count inside. Empty severities are greyed out.
 */
const props = defineProps<{
  summary: Record<string, number>;
  /** Only these severities (e.g. Harbor's dangerous artifacts only count critical/high/medium) */
  severities?: readonly string[];
}>();

const store = useStore();
const { t } = useSprI18n(store);

const segments = computed(() => (props.severities || SEVERITIES).map((sev) => ({
  key:   sev.toLowerCase(),
  label: t(`spr.severity.${ sev.toLowerCase() }`),
  value: props.summary[sev] || 0,
})));
</script>

<template>
  <div
    class="spr-amount-bar"
    data-testid="spr-severity-amount-bar"
  >
    <span
      v-for="s in segments"
      :key="s.key"
      v-clean-tooltip="`${ s.label }: ${ s.value }`"
      class="spr-amount-bar__seg"
      :class="s.value ? s.key : 'zero'"
    >{{ s.value }}</span>
  </div>
</template>

<style lang="scss" scoped>
@import '../styles/palette';

.spr-amount-bar {
  display: flex;
  height: 24px;
  border-radius: 4px;
  overflow: hidden;
  gap: 1px;
}

.spr-amount-bar__seg {
  flex: 1 0 0;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 2px;
  font-size: 13px;
  @include spr-severity-colors;

  &.zero {
    background: $spr-zero-light;
    color: var(--disabled-text);

    body.theme-dark & {
      background: $spr-zero-dark;
    }
  }
}
</style>
