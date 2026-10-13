<script setup lang="ts">
import { computed } from 'vue';
import { useStore } from 'vuex';
import { useSprI18n } from '../composables/useSprI18n';
import { isUnavailable, normaliseHarborError } from '../composables/useHarbor';

/**
 * Body for an Overview tile that failed. 401/403/404 mean "not available with these credentials / this version",
 * anything else is shown as an error.
 */
const props = defineProps<{
  error: any;
}>();

const store = useStore();
const { t } = useSprI18n(store);

const unavailable = computed(() => isUnavailable(props.error));
const message = computed(() => normaliseHarborError(props.error).message);
</script>

<template>
  <div
    class="spr-unavailable"
    data-testid="spr-unavailable"
  >
    <i
      class="icon"
      :class="unavailable ? 'icon-info text-muted' : 'icon-error text-error'"
    />
    <span
      v-clean-tooltip="message"
      :class="{ 'text-muted': unavailable, 'text-error': !unavailable }"
    >
      {{ unavailable ? t('spr.unavailable.message') : t('spr.unavailable.error') }}
    </span>
  </div>
</template>

<style lang="scss" scoped>
.spr-unavailable {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 0;
}
</style>
