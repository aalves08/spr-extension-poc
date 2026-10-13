<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useStore } from 'vuex';
import { Banner } from '@components/Banner';
import SortableTable from '@shell/components/SortableTable/index.vue';
import AsyncButton from '@shell/components/AsyncButton.vue';
import { useSprI18n } from '../composables/useSprI18n';
import { useShell } from '@shell/apis';
import { MANAGEMENT } from '@shell/config/types';
import { CONNECTION_STATE, Connection, SprInstall } from '../types/connection';
import { useConnections } from '../composables/useConnections';
import { useProxyAllowList } from '../composables/useProxyAllowList';
import { useConnectionProbe } from '../composables/useConnectionProbe';
import { useSprDiscovery } from '../composables/useSprDiscovery';
import SprPage from '../components/SprPage.vue';
import ConnectionForm from '../components/ConnectionForm.vue';
import ConnectionStateBadge from '../components/ConnectionStateBadge.vue';
import RemoveConnectionDialog from '../components/RemoveConnectionDialog.vue';

const store = useStore();
const { t } = useSprI18n(store);
const shell = useShell();
const { connections, canManage, load } = useConnections(store);
const allowList = useProxyAllowList(store);
const { probe, resultFor } = useConnectionProbe();
const discovery = useSprDiscovery();

const headers = [
  {
    name: 'name', labelKey: 'spr.settings.headers.name', value: 'displayName', sort: ['displayName']
  },
  {
    name: 'url', labelKey: 'spr.settings.headers.url', value: 'url', sort: ['url']
  },
  {
    name: 'username', labelKey: 'spr.settings.headers.username', value: 'username', sort: ['username']
  },
  { name: 'proxy', labelKey: 'spr.settings.headers.proxy' },
  { name: 'status', labelKey: 'spr.settings.headers.status' },
  { name: 'linked', labelKey: 'spr.settings.headers.linked' },
  {
    name: 'age', labelKey: 'spr.settings.headers.age', value: 'creationTimestamp', formatter: 'LiveDate', sort: ['creationTimestamp:desc'], width: 100
  },
  {
    name: 'actions', label: ' ', width: 220
  },
];

const installHeaders = [
  {
    name: 'cluster', labelKey: 'spr.discovery.headers.cluster', value: 'clusterName', sort: ['clusterName']
  },
  {
    name: 'namespace', labelKey: 'spr.discovery.headers.namespace', value: 'namespace', sort: ['namespace']
  },
  {
    name: 'release', labelKey: 'spr.discovery.headers.release', value: 'releaseName', sort: ['releaseName']
  },
  {
    name: 'version', labelKey: 'spr.discovery.headers.version', value: 'chartVersion'
  },
  {
    name: 'url', labelKey: 'spr.discovery.headers.url', value: 'externalUrl'
  },
  {
    name: 'actions', label: ' ', width: 140
  },
];

const installRows = computed(() => discovery.installs.value.map((i) => ({ ...i, key: `${ i.clusterId }/${ i.namespace }/${ i.releaseName }` })));

function clusterName(id?: string): string {
  return (id && store.getters['management/byId'](MANAGEMENT.CLUSTER, id)?.nameDisplay) || id || '';
}

function linkedLabel(c: Connection): string {
  return c.linkedCluster ? `${ clusterName(c.linkedCluster) } / ${ c.linkedNamespace } / ${ c.linkedApp }` : '';
}

function connectionFor(install: SprInstall): Connection | undefined {
  return connections.value.find((c) => c.linkedCluster === install.clusterId && c.linkedNamespace === install.namespace && c.linkedApp === install.releaseName);
}

function probeAll(force = false) {
  connections.value.forEach((c) => probe(c, { force, allowed: allowList.isAllowed(c.host) }));
}

/** Row "Test": the button shows the outcome, the Status column shows why it failed */
async function testRow(connection: Connection, btnCb: (ok: boolean) => void) {
  const result = await probe(connection, { force: true, allowed: allowList.isAllowed(connection.host) });

  btnCb(result.state === CONNECTION_STATE.CONNECTED);
}

function openForm(connection?: Connection, prefill?: SprInstall) {
  shell.modal.open(ConnectionForm, {
    props: {
      connection, prefill, installs: discovery.installs.value
    },
    width:               '700px',
    closeOnClickOutside: false,
  });
}

function openRemove(connection: Connection) {
  shell.modal.open(RemoveConnectionDialog, { props: { connection }, width: '500px' });
}

onMounted(async() => {
  await Promise.all([load(), allowList.load()]);
  probeAll();
});

// New / edited connections (resourceVersion changes the probe key) and allow-list changes
watch([connections, () => allowList.allowedDomains.value], () => probeAll());
</script>

<template>
  <SprPage
    :title="t('spr.settings.title')"
    allow-empty
  >
    <template #actions>
      <button
        type="button"
        class="btn role-secondary"
        :disabled="discovery.running.value"
        data-testid="spr-settings-detect"
        @click="discovery.discover()"
      >
        <i
          v-if="discovery.running.value"
          class="icon icon-spinner icon-spin mr-5"
        />
        {{ discovery.running.value ? t('spr.discovery.progress', discovery.progress.value) : t('spr.discovery.action') }}
      </button>
      <button
        v-if="canManage"
        type="button"
        class="btn role-primary"
        data-testid="spr-settings-add"
        @click="openForm()"
      >
        {{ t('spr.settings.add') }}
      </button>
    </template>

    <Banner
      v-if="!canManage"
      color="info"
      :label="t('spr.settings.readOnly')"
    />

    <h2 class="mt-10">
      {{ t('spr.settings.connections') }}
    </h2>
    <SortableTable
      :headers="headers"
      :rows="connections"
      key-field="id"
      :table-actions="false"
      :row-actions="false"
      :search="connections.length > 10"
      no-rows-key="spr.settings.noRows"
      default-sort-by="name"
      data-testid="spr-settings-connections"
    >
      <template #cell:url="{ row }">
        <a
          :href="row.url"
          target="_blank"
          rel="noopener noreferrer nofollow"
        >{{ row.url }}</a>
      </template>
      <template #cell:proxy="{ row }">
        <i
          v-if="allowList.isAllowed(row.host)"
          v-clean-tooltip="t('spr.settings.proxyAllowed')"
          class="icon icon-checkmark text-success"
        />
        <i
          v-else
          v-clean-tooltip="t('spr.settings.proxyMissing')"
          class="icon icon-warning text-warning"
        />
      </template>
      <template #cell:status="{ row }">
        <ConnectionStateBadge :result="resultFor(row)" />
      </template>
      <template #cell:linked="{ row }">
        <span v-if="row.linkedCluster">{{ linkedLabel(row) }}</span>
        <span
          v-else
          class="text-muted"
        >&mdash;</span>
      </template>
      <template #cell:actions="{ row }">
        <div class="spr-settings__row-actions">
          <AsyncButton
            mode="edit"
            size="sm"
            action-color="role-secondary"
            :action-label="t('spr.settings.test')"
            :waiting-label="t('spr.connectionForm.test.waiting')"
            :success-label="t('spr.connectionForm.test.ok')"
            :error-label="t('spr.connectionForm.test.failed')"
            :data-testid="`spr-settings-test-${ row.id }`"
            @click="testRow(row, $event)"
          />
          <button
            v-if="canManage"
            type="button"
            class="btn btn-sm role-secondary"
            :data-testid="`spr-settings-edit-${ row.id }`"
            @click="openForm(row)"
          >
            {{ t('spr.settings.edit') }}
          </button>
          <button
            v-if="canManage"
            type="button"
            class="btn btn-sm role-secondary"
            :data-testid="`spr-settings-delete-${ row.id }`"
            @click="openRemove(row)"
          >
            {{ t('spr.settings.delete') }}
          </button>
        </div>
      </template>
    </SortableTable>

    <template v-if="discovery.running.value || installRows.length || discovery.failedClusters.value.length || discovery.error.value">
      <h2 class="mt-30">
        {{ t('spr.discovery.title') }}
      </h2>
      <Banner
        v-if="discovery.error.value"
        color="error"
        :label="discovery.error.value?.message || `${ discovery.error.value }`"
      />
      <Banner
        v-if="discovery.failedClusters.value.length"
        color="warning"
        :label="t('spr.discovery.failed', { clusters: discovery.failedClusters.value.map((c) => c.name).join(', ') })"
      />
      <SortableTable
        :headers="installHeaders"
        :rows="installRows"
        key-field="key"
        :loading="discovery.running.value && !installRows.length"
        :table-actions="false"
        :row-actions="false"
        :search="false"
        no-rows-key="spr.discovery.none"
        data-testid="spr-settings-installs"
      >
        <template #cell:actions="{ row }">
          <span
            v-if="connectionFor(row)"
            class="text-muted"
          >{{ t('spr.discovery.connected') }}</span>
          <button
            v-else-if="canManage"
            type="button"
            class="btn btn-sm role-primary"
            @click="openForm(undefined, row)"
          >
            {{ t('spr.discovery.connect') }}
          </button>
        </template>
      </SortableTable>
    </template>

    <div class="spr-settings__help mt-30">
      <h3>{{ t('spr.settings.help.title') }}</h3>
      <p>{{ t('spr.connectionForm.help.tls') }}</p>
      <p>{{ t('spr.connectionForm.help.credentials') }}</p>
      <p>{{ t('spr.connectionForm.help.visibility') }}</p>
      <p>{{ t('spr.settings.help.proxy') }}</p>
    </div>
  </SprPage>
</template>

<style lang="scss" scoped>
.spr-settings__row-actions {
  display: flex;
  justify-content: flex-end;
  gap: 5px;
}

.spr-settings__help {
  p {
    margin-bottom: 8px;
  }
}
</style>
