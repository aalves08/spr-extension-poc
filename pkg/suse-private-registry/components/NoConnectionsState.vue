<script setup lang="ts">
import { useStore } from 'vuex';
import { useSprI18n } from '../composables/useSprI18n';
import { PAGES, ROUTE_PARAMS, pageRouteName } from '../config/constants';
import SprRequirements from './SprRequirements.vue';

const props = defineProps<{
  /** User can't read connection Secrets at all */
  noPermission?: boolean;
}>();

const store = useStore();
const { t } = useSprI18n(store);

const settingsRoute = { name: pageRouteName(PAGES.SETTINGS), params: ROUTE_PARAMS };
</script>

<template>
  <div
    class="spr-empty"
    data-testid="spr-no-connections"
  >
    <i class="icon icon-storage icon-4x text-muted" />
    <template v-if="props.noPermission">
      <h2>{{ t('spr.empty.noPermission.title') }}</h2>
      <p class="text-muted">
        {{ t('spr.empty.noPermission.description') }}
      </p>
    </template>
    <template v-else>
      <h2>{{ t('spr.empty.title') }}</h2>
      <p class="text-muted">
        {{ t('spr.empty.description') }}
      </p>
      <router-link
        :to="settingsRoute"
        class="btn role-primary mt-20"
        data-testid="spr-no-connections-cta"
      >
        {{ t('spr.empty.cta') }}
      </router-link>
      <p class="text-muted mt-20">
        {{ t('spr.empty.install') }}
      </p>
      <SprRequirements class="spr-empty__requirements" />
    </template>
  </div>
</template>

<style lang="scss" scoped>
.spr-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 60px 20px;
  gap: 10px;

  p {
    max-width: 600px;
  }

  &__requirements {
    max-width: 700px;
  }
}
</style>
