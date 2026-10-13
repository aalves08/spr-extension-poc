<script setup lang="ts">
import { computed } from 'vue';
import { useStore } from 'vuex';
import { useSprI18n } from '../composables/useSprI18n';
import { SEVERITIES } from '../utils/severity';

/**
 * Big total on the left, one row per severity on the right (label, thin bar, count).
 * Every severity is shown, also at 0, so the layout doesn't shift.
 * With `selectable`, labels are links that emit the severity (click again to clear), e.g. to filter a table.
 */
const props = defineProps<{
  summary: Record<string, number>;
  selectable?: boolean;
  /** Currently selected severity (`Critical`...), '' for none */
  selected?: string;
}>();

const emit = defineEmits<{
  select: [severity: string];
}>();

const store = useStore();
const { t } = useSprI18n(store);

const total = computed(() => SEVERITIES.reduce((sum, sev) => sum + (props.summary[sev] || 0), 0));
const max = computed(() => Math.max(...SEVERITIES.map((sev) => props.summary[sev] || 0), 1));

const rows = computed(() => SEVERITIES.map((sev) => {
  const value = props.summary[sev] || 0;

  return {
    sev,
    key:   sev.toLowerCase(),
    label: t(`spr.severity.${ sev.toLowerCase() }`),
    value,
    pct:   (value / max.value) * 100,
  };
}));
</script>

<template>
  <div
    class="spr-distribution"
    data-testid="spr-severity-distribution"
  >
    <div class="spr-distribution__total">
      <span class="spr-distribution__total-value">{{ total }}</span>
      <span class="text-muted">{{ t('spr.severity.total', { count: total }) }}</span>
      <slot />
    </div>
    <div class="spr-distribution__rows">
      <div
        v-for="r in rows"
        :key="r.key"
        class="spr-distribution__row"
      >
        <a
          v-if="props.selectable"
          href="#"
          class="spr-distribution__label"
          :class="{ 'spr-distribution__label--active': props.selected === r.sev }"
          :aria-pressed="props.selected === r.sev"
          @click.prevent="emit('select', props.selected === r.sev ? '' : r.sev)"
        >{{ r.label }}</a>
        <span
          v-else
          class="spr-distribution__label"
        >{{ r.label }}</span>
        <div class="spr-distribution__track">
          <div
            class="spr-distribution__fill"
            :class="r.key"
            :style="{ width: `${ r.pct }%` }"
          />
        </div>
        <span class="spr-distribution__count text-muted">{{ r.value }}</span>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
@import '../styles/palette';

.spr-distribution {
  display: flex;
  gap: 24px;
  padding: 8px 0;
}

.spr-distribution__total {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  text-align: center;
}

.spr-distribution__total-value {
  font-size: 28px;
  font-weight: 800;
  line-height: 36px;
}

.spr-distribution__rows {
  flex: 3;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
}

.spr-distribution__row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.spr-distribution__label {
  width: 80px;
  flex-shrink: 0;
}

.spr-distribution__label--active {
  font-weight: 700;
  text-decoration: underline;
}

.spr-distribution__track {
  flex: 1;
  height: 7px;
  border-radius: 4px;
  background: var(--progress-bg);
  overflow: hidden;
}

.spr-distribution__fill {
  height: 100%;
  @include spr-severity-colors;
}

.spr-distribution__count {
  width: 50px;
  flex-shrink: 0;
  text-align: right;
}
</style>
