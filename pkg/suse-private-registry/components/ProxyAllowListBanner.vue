<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useStore } from 'vuex';
import { Banner } from '@components/Banner';
import AsyncButton from '@shell/components/AsyncButton.vue';
import { useSprI18n } from '../composables/useSprI18n';
import { useShell } from '@shell/apis';
import { NotificationLevel } from '@shell/types/notifications';
import { useConnections } from '../composables/useConnections';
import { useProxyAllowList } from '../composables/useProxyAllowList';

const store = useStore();
const { t } = useSprI18n(store);
const shell = useShell();
const { connections, load: loadConnections } = useConnections(store);
const allowList = useProxyAllowList(store);

const missing = computed(() => {
  if (!allowList.loaded.value) {
    return [];
  }

  return allowList.missingHosts(connections.value.map((c) => c.host));
});

const checked = new Set<string>();

// A host may be allowed by a ProxyEndpoint we don't manage, double check new ones once
watch(missing, (hosts) => {
  const unchecked = hosts.filter((h) => !checked.has(h));

  unchecked.forEach((h) => checked.add(h));

  if (unchecked.length) {
    allowList.recheck(unchecked);
  }
});

onMounted(async() => {
  await Promise.all([loadConnections(), allowList.load()]);
});

async function allow(btnCb: (ok: boolean) => void) {
  try {
    await allowList.allow(missing.value);
    btnCb(true);
  } catch (e: any) {
    shell.notification.send(NotificationLevel.Error, t('spr.proxyBanner.allowFailed'), e?.message || `${ e }`);
    btnCb(false);
  }
}
</script>

<template>
  <Banner
    v-if="missing.length"
    color="warning"
    class="spr-proxy-banner"
    data-testid="spr-proxy-banner"
  >
    <div class="spr-proxy-banner__body">
      <div>
        <p>{{ t('spr.proxyBanner.message', { count: missing.length }) }}</p>
        <p class="mt-5">
          <code
            v-for="host in missing"
            :key="host"
            class="mr-5"
          >{{ host }}</code>
        </p>
        <p
          v-if="!allowList.canFix.value"
          class="mt-5"
        >
          {{ t('spr.proxyBanner.askAdmin') }}
        </p>
      </div>
      <AsyncButton
        v-if="allowList.canFix.value"
        mode="edit"
        :action-label="t('spr.proxyBanner.allow')"
        :waiting-label="t('spr.proxyBanner.allowing')"
        :success-label="t('spr.proxyBanner.allowed')"
        data-testid="spr-proxy-banner-allow"
        @click="allow"
      />
    </div>
  </Banner>
</template>

<style lang="scss" scoped>
.spr-proxy-banner__body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  width: 100%;
}
</style>
