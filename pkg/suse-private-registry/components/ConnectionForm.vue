<script setup lang="ts">
import { computed, reactive, ref, Ref } from 'vue';
import { useStore } from 'vuex';
import { Card } from '@components/Card';
import { Banner } from '@components/Banner';
import { LabeledInput } from '@components/Form/LabeledInput';
import { Checkbox } from '@components/Form/Checkbox';
import LabeledSelect from '@shell/components/form/LabeledSelect.vue';
import Password from '@shell/components/form/Password.vue';
import AsyncButton from '@shell/components/AsyncButton.vue';
import { useSprI18n } from '../composables/useSprI18n';
import { useShell } from '@shell/apis';
import { NotificationLevel } from '@shell/types/notifications';
import { _CREATE, _EDIT } from '@shell/config/query-params';
import { Connection, ConnectionInput, SprInstall } from '../types/connection';
import { useConnections } from '../composables/useConnections';
import { useProxyAllowList } from '../composables/useProxyAllowList';
import { HarborClient, invalidateHarborCache, normaliseHarborError } from '../composables/useHarbor';
import { hostFromUrl } from '../utils/image-ref';
import { canRancherSignBasicAuth } from '../utils/harbor-encoding';
import { sprReleaseForHarbor, sprVersionFromHarborVersion } from '../utils/spr-releases';
import SprRequirements from './SprRequirements.vue';

const props = defineProps<{
  connection?: Connection;
  /** Prefill from a detected install ("Connect" in discovery) */
  prefill?: SprInstall;
  /** Detected installs to offer in the "Linked install" select */
  installs?: SprInstall[];
}>();

const emit = defineEmits<{(e: 'close'): void}>();

const store = useStore();
const { t } = useSprI18n(store);
const shell = useShell();
const { create, update } = useConnections(store);
const allowList = useProxyAllowList(store);

const isEdit = computed(() => !!props.connection);

function installKey(i?: { clusterId?: string; namespace?: string; releaseName?: string }): string {
  return i?.clusterId && i?.namespace && i?.releaseName ? `${ i.clusterId }/${ i.namespace }/${ i.releaseName }` : '';
}

const form = reactive({
  displayName: props.connection?.displayName || props.prefill?.releaseName || '',
  url:         props.connection?.url || props.prefill?.externalUrl || '',
  username:    props.connection?.username || '',
  password:    '',
  linked:      props.connection ? installKey({
    clusterId: props.connection.linkedCluster, namespace: props.connection.linkedNamespace, releaseName: props.connection.linkedApp
  }) : installKey(props.prefill),
});

const addToAllowList = ref(true);
const testResult: Ref<{ ok: boolean; message: string } | null> = ref(null);
const saveError: Ref<string | null> = ref(null);

const installOptions = computed(() => {
  const list = [...(props.installs || [])];

  if (props.prefill && !list.find((i) => installKey(i) === installKey(props.prefill))) {
    list.push(props.prefill);
  }

  const options = list.map((i) => ({ label: `${ i.clusterName } / ${ i.namespace } / ${ i.releaseName }`, value: installKey(i) }));

  // Keep the current link visible even if discovery hasn't run
  if (form.linked && !options.find((o) => o.value === form.linked)) {
    options.push({ label: form.linked, value: form.linked });
  }

  return [{ label: t('spr.connectionForm.linkedNone'), value: '' }, ...options];
});

function onLinkedChange(value: string) {
  form.linked = value;
  const install = [...(props.installs || []), ...(props.prefill ? [props.prefill] : [])].find((i) => installKey(i) === value);

  if (install?.externalUrl && !form.url) {
    form.url = install.externalUrl;
  }
}

const urlError = computed(() => {
  if (!form.url) {
    return '';
  }

  try {
    const u = new URL(form.url);

    return u.protocol === 'https:' ? '' : t('spr.connectionForm.errors.https');
  } catch {
    return t('spr.connectionForm.errors.url');
  }
});

const host = computed(() => (urlError.value ? '' : hostFromUrl(form.url)));
const hostAllowed = computed(() => !host.value || allowList.isAllowed(host.value));

// Only checkable when a new password is typed; the stored one never reaches the browser
const unsignable = computed(() => !!form.password && !canRancherSignBasicAuth(form.username, form.password));

const valid = computed(() => !!form.displayName.trim() &&
  !!form.url && !urlError.value &&
  !!form.username.trim() &&
  (isEdit.value || !!form.password) &&
  !unsignable.value);

const canTest = computed(() => !!host.value && hostAllowed.value && !!form.username.trim() && (!!form.password || isEdit.value));

allowList.load();

function input(): ConnectionInput {
  const [linkedCluster, linkedNamespace, linkedApp] = form.linked ? form.linked.split('/') : [];

  return {
    displayName: form.displayName,
    url:         form.url,
    username:    form.username,
    password:    form.password,
    linkedCluster,
    linkedNamespace,
    linkedApp,
  };
}

async function allowHost(btnCb: (ok: boolean) => void) {
  try {
    await allowList.allow([host.value]);
    btnCb(true);
  } catch (e: any) {
    shell.notification.send(NotificationLevel.Error, t('spr.proxyBanner.allowFailed'), e?.message || `${ e }`);
    btnCb(false);
  }
}

async function test(btnCb: (ok: boolean) => void) {
  testResult.value = null;

  // Without a new password on edit, test with the stored Secret (signed server-side)
  const useStored = isEdit.value && !form.password;
  const client = new HarborClient(shell.proxy, store, {
    url:          form.url,
    credentialId: useStored ? props.connection?.credentialId : undefined,
  });
  const basic = useStored ? undefined : { username: form.username.trim(), password: form.password };

  try {
    await client.systemInfo({ anonymous: true, force: true });
    const creds = await client.validateCredentials({ basic });
    // The version is only returned to authenticated callers
    const info = await client.systemInfo({ basic, force: true }).catch(() => undefined);
    const harborVersion = info?.harbor_version;
    const version = sprVersionFromHarborVersion(harborVersion) || sprReleaseForHarbor(harborVersion)?.spr || 'unknown';

    testResult.value = {
      ok:      true,
      message: t(creds.robot ? 'spr.connectionForm.test.successRobot' : 'spr.connectionForm.test.success', { version, user: creds.username || form.username }),
    };
    btnCb(true);
  } catch (e) {
    const err = normaliseHarborError(e);

    testResult.value = { ok: false, message: `${ t(`spr.errors.${ err.kind }`) }${ err.message ? ` (${ err.message })` : '' }` };
    btnCb(false);
  }
}

async function save(btnCb: (ok: boolean) => void) {
  saveError.value = null;

  try {
    if (!hostAllowed.value && addToAllowList.value && allowList.canFix.value) {
      await allowList.allow([host.value]);
    }

    if (props.connection) {
      await update(props.connection, input());
      invalidateHarborCache(props.connection.id);
    } else {
      await create(input());
    }

    btnCb(true);
    shell.notification.send(NotificationLevel.Success, t(isEdit.value ? 'spr.connectionForm.updated' : 'spr.connectionForm.created', { name: form.displayName }));
    emit('close');
  } catch (e: any) {
    saveError.value = e?.message || e?._statusText || `${ e }`;
    btnCb(false);
  }
}
</script>

<template>
  <Card
    class="spr-connection-form"
    :show-highlight-border="false"
    data-testid="spr-connection-form"
  >
    <template #title>
      <h4 class="text-default-text">
        {{ t(isEdit ? 'spr.connectionForm.titleEdit' : 'spr.connectionForm.titleAdd') }}
      </h4>
    </template>

    <template #body>
      <div class="spr-connection-form__body">
        <LabeledInput
          v-model:value="form.displayName"
          :label="t('spr.connectionForm.name')"
          :mode="isEdit ? _EDIT : _CREATE"
          required
          data-testid="spr-connection-name"
        />

        <LabeledSelect
          :value="form.linked"
          :options="installOptions"
          :label="t('spr.connectionForm.linked')"
          :tooltip="t('spr.connectionForm.linkedTooltip')"
          data-testid="spr-connection-linked"
          @update:value="onLinkedChange"
        />

        <LabeledInput
          v-model:value="form.url"
          :label="t('spr.connectionForm.url')"
          :placeholder="t('spr.connectionForm.urlPlaceholder')"
          :status="urlError ? 'error' : undefined"
          :sub-label="urlError"
          required
          data-testid="spr-connection-url"
        />

        <LabeledInput
          v-model:value="form.username"
          :label="t('spr.connectionForm.username')"
          :tooltip="t('spr.connectionForm.usernameTooltip')"
          required
          data-testid="spr-connection-username"
        />

        <Password
          v-model:value="form.password"
          :label="t(isEdit ? 'spr.connectionForm.passwordEdit' : 'spr.connectionForm.password')"
          :required="!isEdit"
          :mode="isEdit ? _EDIT : _CREATE"
          autocomplete="new-password"
          data-testid="spr-connection-password"
        />

        <Banner
          v-if="unsignable"
          color="warning"
          :label="t('spr.connectionForm.errors.unsignable')"
          data-testid="spr-connection-unsignable"
        />

        <template v-if="host && !hostAllowed">
          <Banner color="warning">
            <div class="spr-connection-form__allow">
              <span>{{ t('spr.connectionForm.hostNotAllowed', { host }) }}</span>
              <AsyncButton
                v-if="allowList.canFix.value"
                mode="edit"
                :action-label="t('spr.connectionForm.allowHost')"
                :waiting-label="t('spr.proxyBanner.allowing')"
                :success-label="t('spr.proxyBanner.allowed')"
                data-testid="spr-connection-allow-host"
                @click="allowHost"
              />
            </div>
          </Banner>
          <Checkbox
            v-if="allowList.canFix.value"
            v-model:value="addToAllowList"
            :label="t('spr.connectionForm.addToAllowList')"
            data-testid="spr-connection-add-allowlist"
          />
        </template>

        <Banner
          v-if="testResult"
          :color="testResult.ok ? 'success' : 'error'"
          :label="testResult.message"
          data-testid="spr-connection-test-result"
        />

        <Banner
          v-if="saveError"
          color="error"
          :label="saveError"
        />

        <p class="text-muted">
          {{ t('spr.connectionForm.help.tls') }}
        </p>
        <p class="text-muted">
          {{ t('spr.connectionForm.help.credentials') }}
        </p>
        <p class="text-muted">
          {{ t('spr.connectionForm.help.visibility') }}
        </p>

        <SprRequirements v-if="!isEdit" />
      </div>
    </template>

    <template #actions>
      <div class="spr-connection-form__actions">
        <AsyncButton
          v-clean-tooltip="!hostAllowed ? t('spr.connectionForm.testNeedsAllow') : ''"
          mode="edit"
          :disabled="!canTest"
          action-color="role-secondary"
          :action-label="t('spr.connectionForm.test.action')"
          :waiting-label="t('spr.connectionForm.test.waiting')"
          :success-label="t('spr.connectionForm.test.ok')"
          :error-label="t('spr.connectionForm.test.failed')"
          data-testid="spr-connection-test"
          @click="test"
        />
        <div class="spr-connection-form__actions-right">
          <button
            type="button"
            class="btn role-secondary"
            data-testid="spr-connection-cancel"
            @click="emit('close')"
          >
            {{ t('generic.cancel') }}
          </button>
          <AsyncButton
            :mode="isEdit ? 'edit' : 'create'"
            :disabled="!valid"
            data-testid="spr-connection-save"
            @click="save"
          />
        </div>
      </div>
    </template>
  </Card>
</template>

<style lang="scss" scoped>
.spr-connection-form {
  margin: 0;
  box-shadow: none;
}

.spr-connection-form__body {
  display: flex;
  flex-direction: column;
  gap: 15px;
  width: 100%;

  p {
    margin: 0;
  }
}

.spr-connection-form__allow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
}

.spr-connection-form__actions {
  display: flex;
  justify-content: space-between;
  width: 100%;
}

.spr-connection-form__actions-right {
  display: flex;
  gap: 10px;
}
</style>
