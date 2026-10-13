<script setup lang="ts">
/**
 * One bordered container for related summaries, side by side (not a grid of cards).
 * Each SummaryBlock is only as tall as the strip's tallest content; stacks below 1200px.
 */
</script>

<template>
  <div class="spr-summary-strip">
    <slot />
  </div>
</template>

<style lang="scss" scoped>
.spr-summary-strip {
  display: flex;
  align-items: stretch;
  border: var(--border-width) solid var(--input-border);
  border-radius: 6px;
  margin-bottom: 24px;

  @media (max-width: 1200px) {
    flex-direction: column;
  }
}
</style>
