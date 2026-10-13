<script setup lang="ts">
import { RouteLocationRaw } from 'vue-router';

/**
 * Big number with a muted label underneath. Colour the value only when it means something (errors).
 */
const props = defineProps<{
  value: string | number;
  label: string;
  /** e.g. `text-error` */
  valueClass?: string;
  /** Optional muted second line (breakdown, "of 500 GiB") */
  detail?: string;
  to?: RouteLocationRaw;
  /** 0..1, draws a thin usage bar under the label */
  ratio?: number;
  /** Colours the bar as a warning */
  ratioWarn?: boolean;
}>();

const emit = defineEmits<{
  /** The link was clicked; same-hash links don't navigate, so the parent can scroll / select itself */
  navigate: [];
}>();
</script>

<template>
  <div class="spr-stat">
    <router-link
      v-if="props.to"
      class="spr-stat__value"
      :class="props.valueClass"
      :to="props.to"
      @click="emit('navigate')"
    >
      {{ props.value }}
    </router-link>
    <div
      v-else
      class="spr-stat__value"
      :class="props.valueClass"
    >
      {{ props.value }}
    </div>
    <div class="spr-stat__label">
      {{ props.label }}
    </div>
    <div
      v-if="props.ratio !== undefined"
      class="spr-stat__track"
    >
      <div
        class="spr-stat__fill"
        :class="props.ratioWarn ? 'bg-error' : 'bg-primary'"
        :style="{ width: `${ Math.min(100, Math.max(0, props.ratio * 100)) }%` }"
      />
    </div>
    <div
      v-if="props.detail"
      class="spr-stat__detail"
    >
      {{ props.detail }}
    </div>
  </div>
</template>

<style lang="scss" scoped>
.spr-stat {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 0;
  text-align: center;
}

.spr-stat__value {
  font-size: 28px;
  font-weight: 700;
  line-height: 36px;
  white-space: nowrap;
}

.spr-stat__label,
.spr-stat__detail {
  font-size: 14px;
  line-height: 20px;
  color: var(--disabled-text);
}

.spr-stat__detail {
  font-size: 12px;
  line-height: 16px;
}

.spr-stat__track {
  width: 100%;
  max-width: 160px;
  height: 7px;
  border-radius: 4px;
  background: var(--progress-bg);
  overflow: hidden;
}

.spr-stat__fill {
  height: 100%;
}
</style>
