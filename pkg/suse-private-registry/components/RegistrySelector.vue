<script setup lang="ts">
import { computed } from 'vue';
import { useStore } from 'vuex';
import LabeledSelect from '@shell/components/form/LabeledSelect.vue';
import { useSprI18n } from '../composables/useSprI18n';
import { useConnections } from '../composables/useConnections';
import { useActiveRegistry } from '../composables/useActiveRegistry';

const store = useStore();
const { t } = useSprI18n(store);
const { connections } = useConnections(store);
const { activeId, setActive } = useActiveRegistry();

const options = computed(() => connections.value.map((c) => ({ label: c.displayName, value: c.id })));
</script>

<template>
  <LabeledSelect
    class="spr-registry-selector"
    :value="activeId"
    :options="options"
    :label="t('spr.registrySelector.label')"
    :searchable="options.length > 5"
    :clearable="false"
    data-testid="spr-registry-selector"
    @update:value="setActive"
  />
</template>

<style lang="scss" scoped>
.spr-registry-selector {
  min-width: 260px;
}
</style>
