<script setup lang="ts">
/**
 * Light yes/no for table cells: a green checkmark, or a muted dash. Heavy grey "No" badges drown the row.
 */
const props = defineProps<{
  value: boolean;
  /** Tooltip / accessible label */
  label: string;
}>();
</script>

<template>
  <i
    v-if="props.value"
    v-clean-tooltip="props.label"
    class="icon icon-checkmark text-success"
    :aria-label="props.label"
    role="img"
  />
  <span
    v-else
    v-clean-tooltip="props.label"
    class="text-muted"
    :aria-label="props.label"
  >&mdash;</span>
</template>
