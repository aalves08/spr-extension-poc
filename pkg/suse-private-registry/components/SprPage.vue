<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useStore } from 'vuex';
import Loading from '@shell/components/Loading.vue';
import { Banner } from '@components/Banner';
import { useConnections } from '../composables/useConnections';
import ProxyAllowListBanner from './ProxyAllowListBanner.vue';
import NoConnectionsState from './NoConnectionsState.vue';
import RegistrySelector from './RegistrySelector.vue';

/**
 * Common frame for product pages: header, proxy allow-list banner and the "no connections" guard.
 */
const props = withDefaults(defineProps<{
  title: string;
  /** Show the registry selector in the header */
  selector?: boolean;
  /** Render the default slot even without connections (Settings) */
  allowEmpty?: boolean;
}>(), { selector: false, allowEmpty: false });

const store = useStore();
const {
  schema, connections, loaded, loadError, load
} = useConnections(store);

const noPermission = computed(() => !schema.value);

onMounted(() => load());
</script>

<template>
  <div class="spr-page">
    <header class="spr-page__header">
      <div class="title">
        <slot name="breadcrumbs" />
        <h1 data-testid="spr-page-title">
          {{ props.title }}
          <slot name="title-extra" />
        </h1>
        <div
          v-if="$slots.description"
          class="spr-page__description text-deemphasized"
        >
          <slot name="description" />
        </div>
      </div>
      <div class="spr-page__actions">
        <slot name="actions" />
        <RegistrySelector v-if="props.selector && connections.length > 1" />
      </div>
    </header>

    <ProxyAllowListBanner />

    <Banner
      v-if="loadError"
      color="error"
      :label="loadError"
    />

    <Loading v-if="!loaded" />
    <slot v-else-if="props.allowEmpty || connections.length" />
    <NoConnectionsState
      v-else
      :no-permission="noPermission"
    />
  </div>
</template>

<style lang="scss" scoped>
.spr-page__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 20px;
  flex-wrap: wrap;

  h1 {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 10px;
  }
}

.spr-page__description {
  margin-top: 4px;
}

.spr-page__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
