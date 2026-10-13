<script setup lang="ts">
import { computed } from 'vue';
import { useStore } from 'vuex';
import { BadgeState } from '@components/BadgeState';
import { useSprI18n } from '../composables/useSprI18n';
import { ProbeResult, STATE_BG } from '../composables/useConnectionProbe';

const props = defineProps<{
  result?: ProbeResult;
}>();

const store = useStore();
const { t } = useSprI18n(store);

const label = computed(() => (props.result ? t(`spr.state.${ props.result.state }`) : t('spr.state.checking')));
const color = computed(() => (props.result ? STATE_BG[props.result.state] : 'bg-darker'));
const tooltip = computed(() => props.result?.error?.message || '');
</script>

<template>
  <BadgeState
    v-clean-tooltip="tooltip"
    :label="label"
    :color="color"
  />
</template>
