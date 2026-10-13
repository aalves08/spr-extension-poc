<script setup lang="ts">
import { computed, ref } from 'vue';
import { useStore } from 'vuex';
import { Card } from '@components/Card';
import { Banner } from '@components/Banner';
import { Checkbox } from '@components/Form/Checkbox';
import AsyncButton from '@shell/components/AsyncButton.vue';
import { useSprI18n } from '../composables/useSprI18n';
import { Connection } from '../types/connection';
import { useConnections } from '../composables/useConnections';
import { useProxyAllowList } from '../composables/useProxyAllowList';
import { invalidateHarborCache } from '../composables/useHarbor';

const props = defineProps<{
  connection: Connection;
}>();

const emit = defineEmits<{(e: 'close'): void}>();

const store = useStore();
const { t } = useSprI18n(store);
const { connections, remove } = useConnections(store);
const allowList = useProxyAllowList(store);

// Only offer to disallow the host when no other connection uses it and it's in our own CR
const hostInOwnEndpoint = computed(() => (allowList.ownEndpoint.value?.spec?.routes || [])
  .some((r: { domain?: string }) => r.domain?.toLowerCase() === props.connection.host.replace(/:\d+$/, '')));
const hostUnused = computed(() => !connections.value.some((c) => c.id !== props.connection.id && c.host === props.connection.host));
const canDisallow = computed(() => hostUnused.value && hostInOwnEndpoint.value && allowList.canFix.value);

const disallow = ref(true);
const error = ref<string | null>(null);

async function confirm(btnCb: (ok: boolean) => void) {
  error.value = null;

  try {
    await remove(props.connection);
    invalidateHarborCache(props.connection.id);

    if (canDisallow.value && disallow.value) {
      await allowList.disallow([props.connection.host]);
    }

    btnCb(true);
    emit('close');
  } catch (e: any) {
    error.value = e?.message || e?._statusText || `${ e }`;
    btnCb(false);
  }
}
</script>

<template>
  <Card
    :show-highlight-border="false"
    data-testid="spr-remove-connection"
  >
    <template #title>
      <h4 class="text-default-text">
        {{ t('spr.removeConnection.title') }}
      </h4>
    </template>
    <template #body>
      <div class="spr-remove__body">
        <p>{{ t('spr.removeConnection.message', { name: props.connection.displayName }) }}</p>
        <Checkbox
          v-if="canDisallow"
          v-model:value="disallow"
          :label="t('spr.removeConnection.disallow', { host: props.connection.host })"
          data-testid="spr-remove-connection-disallow"
        />
        <Banner
          v-if="error"
          color="error"
          :label="error"
        />
      </div>
    </template>
    <template #actions>
      <div class="spr-remove__actions">
        <button
          type="button"
          class="btn role-secondary"
          @click="emit('close')"
        >
          {{ t('generic.cancel') }}
        </button>
        <AsyncButton
          mode="delete"
          action-color="bg-error"
          data-testid="spr-remove-connection-confirm"
          @click="confirm"
        />
      </div>
    </template>
  </Card>
</template>

<style lang="scss" scoped>
.spr-remove__body {
  display: flex;
  flex-direction: column;
  gap: 15px;

  p {
    margin: 0;
  }
}

.spr-remove__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  width: 100%;
}
</style>
