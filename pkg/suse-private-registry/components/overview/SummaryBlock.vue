<script setup lang="ts">
import Loading from '@shell/components/Loading.vue';
import UnavailableCard from '../UnavailableCard.vue';

/**
 * One section of a summary strip (blocks sit side by side with a divider, see SummaryStrip).
 * Independent loading and error state.
 */
const props = defineProps<{
  title?: string;
  tooltip?: string;
  loading?: boolean;
  error?: any;
  /** Relative width in the strip */
  grow?: number;
}>();
</script>

<template>
  <section
    class="spr-summary-block"
    :style="{ flexGrow: props.grow || 1 }"
  >
    <header
      v-if="props.title || $slots['header-extra']"
      class="spr-summary-block__header"
    >
      <h3 v-if="props.title">
        {{ props.title }}
        <i
          v-if="props.tooltip"
          v-clean-tooltip="props.tooltip"
          class="icon icon-info"
        />
      </h3>
      <span class="spr-summary-block__extra text-muted">
        <slot name="header-extra" />
      </span>
    </header>
    <Loading
      v-if="props.loading"
      mode="relative"
    />
    <UnavailableCard
      v-else-if="props.error"
      :error="props.error"
    />
    <slot v-else />
  </section>
</template>

<style lang="scss" scoped>
.spr-summary-block {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  min-height: 100px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;

  & + & {
    border-left: var(--border-width) solid var(--input-border);
  }

  @media (max-width: 1200px) {
    & + & {
      border-left: 0;
      border-top: var(--border-width) solid var(--input-border);
    }
  }
}

.spr-summary-block__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;

  h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 18px;
    font-weight: 400;
    line-height: 21px;
  }
}
</style>
