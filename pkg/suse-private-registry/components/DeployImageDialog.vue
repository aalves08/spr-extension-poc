<script setup lang="ts">
import {
  computed, onMounted, reactive, ref, Ref, watch
} from 'vue';
import { useStore } from 'vuex';
import { useRouter } from 'vue-router';
import { Card } from '@components/Card';
import { Banner } from '@components/Banner';
import { LabeledInput } from '@components/Form/LabeledInput';
import LabeledSelect from '@shell/components/form/LabeledSelect.vue';
import AsyncButton from '@shell/components/AsyncButton.vue';
import { useShell } from '@shell/apis';
import { NotificationLevel } from '@shell/types/notifications';
import { useSprI18n } from '../composables/useSprI18n';
import { Connection } from '../types/connection';
import { HarborArtifact } from '../types/harbor';
import { useHarbor } from '../composables/useHarbor';
import { ClusterRef, readyClusters, steveList } from '../composables/useSprDiscovery';
import { tagNames } from '../utils/artifact';
import { shortDigest } from '../utils/image-ref';
import {
  SECRET_TYPE, WORKLOAD_SELECTOR_LABEL, dockerConfigHosts, errorMessage, explorerCreateRoute, explorerResourceRoute, isDnsLabel, steveCreate, toDnsLabel
} from '../utils/k8s';

/**
 * Deploy an SPR image as a Deployment in a cluster the user picks. Private projects need an existing
 * `dockerconfigjson` pull secret for the registry in the target namespace (the extension doesn't create credentials).
 */
const props = defineProps<{
  connection: Connection;
  project: string;
  repo: string;
  artifact: HarborArtifact;
}>();

const emit = defineEmits<{(e: 'close'): void}>();

// Value of the reference select for "by digest"
const BY_DIGEST = '@digest';

const store = useStore();
const router = useRouter();
const shell = useShell();
const { t } = useSprI18n(store);
const { clientFor } = useHarbor();

const clusters: Ref<ClusterRef[]> = ref([]);
const namespaces: Ref<string[]> = ref([]);
const pullSecrets: Ref<string[]> = ref([]);
const isPublic = ref<boolean | undefined>(undefined);
const loadingClusters = ref(true);
const loadingNamespaces = ref(false);
const loadingSecrets = ref(false);
const error = ref<string | null>(null);

const tags = computed(() => tagNames(props.artifact));
const imageBase = computed(() => `${ props.connection.host }/${ props.project }/${ props.repo }`);

const form = reactive({
  cluster:    '',
  namespace:  '',
  name:       toDnsLabel(props.repo.split('/').pop() || props.repo),
  reference:  BY_DIGEST,
  replicas:   '1',
  port:       '',
  pullSecret: '',
});

const referenceOptions = computed(() => [
  { label: t('spr.deploy.byDigest', { digest: shortDigest(props.artifact.digest) }), value: BY_DIGEST },
  ...tags.value.map((tag) => ({ label: t('spr.deploy.byTag', { tag }), value: tag })),
]);

const image = computed(() => (form.reference === BY_DIGEST ? `${ imageBase.value }@${ props.artifact.digest }` : `${ imageBase.value }:${ form.reference }`));

const clusterOptions = computed(() => clusters.value.map((c) => ({ label: c.name, value: c.id })));
const pullSecretOptions = computed(() => [
  { label: t('spr.deploy.noPullSecret'), value: '' },
  ...pullSecrets.value.map((name) => ({ label: name, value: name })),
]);

const nameError = computed(() => (form.name && !isDnsLabel(form.name) ? t('spr.deploy.nameInvalid') : undefined));
const replicas = computed(() => parseInt(form.replicas, 10));
const port = computed(() => (form.port ? parseInt(form.port, 10) : undefined));
const portInvalid = computed(() => port.value !== undefined && (Number.isNaN(port.value) || port.value < 1 || port.value > 65535));
const needsSecret = computed(() => isPublic.value === false);
const missingSecret = computed(() => needsSecret.value && !!form.namespace && !loadingSecrets.value && !pullSecrets.value.length);

const canDeploy = computed(() => !!form.cluster && !!form.namespace && !!form.name && !nameError.value &&
  !Number.isNaN(replicas.value) && replicas.value >= 0 && !portInvalid.value);

const secretCreateHref = computed(() => (form.cluster ? router.resolve(explorerCreateRoute(form.cluster, 'secret')).href : undefined));

onMounted(async() => {
  try {
    const [list, project] = await Promise.all([
      readyClusters(store),
      clientFor(props.connection).project(props.project).catch(() => undefined),
    ]);

    clusters.value = list;
    isPublic.value = project ? project.metadata?.public === 'true' : undefined;

    if (list.length === 1) {
      form.cluster = list[0].id;
    }
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loadingClusters.value = false;
  }
});

watch(() => form.cluster, async(cluster) => {
  form.namespace = '';
  namespaces.value = [];

  if (!cluster) {
    return;
  }

  loadingNamespaces.value = true;

  try {
    const list = await steveList(store, cluster, 'namespace');

    namespaces.value = list.map((ns: any) => ns.metadata?.name).filter(Boolean).sort();
    form.namespace = namespaces.value.includes('default') ? 'default' : '';
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loadingNamespaces.value = false;
  }
});

// Only secrets with credentials for this registry's host
watch([() => form.cluster, () => form.namespace, needsSecret], async([cluster, namespace, needed]) => {
  form.pullSecret = '';
  pullSecrets.value = [];

  if (!cluster || !namespace || !needed) {
    return;
  }

  loadingSecrets.value = true;

  try {
    const secrets = await steveList(store, cluster, 'secret', namespace);

    // The user picked another namespace meanwhile
    if (form.cluster !== cluster || form.namespace !== namespace) {
      return;
    }

    pullSecrets.value = secrets
      .filter((s: any) => s._type === SECRET_TYPE.DOCKER_CONFIG_JSON || s.type === SECRET_TYPE.DOCKER_CONFIG_JSON)
      .filter((s: any) => dockerConfigHosts(s).includes(props.connection.host))
      .map((s: any) => s.metadata?.name)
      .sort();
    form.pullSecret = pullSecrets.value[0] || '';
  } catch {
    // Can't read secrets: deploy without one, the banner below explains
  } finally {
    loadingSecrets.value = false;
  }
});

function deployment() {
  const selector = { [WORKLOAD_SELECTOR_LABEL]: `apps.deployment-${ form.namespace }-${ form.name }` };
  const container: any = {
    name:            form.name,
    image:           image.value,
    imagePullPolicy: 'IfNotPresent',
  };

  if (port.value) {
    container.ports = [{ containerPort: port.value, protocol: 'TCP' }];
  }

  return {
    type:     'apps.deployment',
    metadata: {
      name: form.name, namespace: form.namespace, labels: selector
    },
    spec: {
      replicas: replicas.value,
      selector: { matchLabels: selector },
      template: {
        metadata: { labels: selector },
        spec:     {
          containers: [container],
          ...(form.pullSecret ? { imagePullSecrets: [{ name: form.pullSecret }] } : {}),
        },
      },
    },
  };
}

async function deploy(btnCb: (ok: boolean) => void) {
  error.value = null;

  try {
    await steveCreate(store, form.cluster, 'apps.deployments', deployment());
    btnCb(true);
    shell.notification.send(NotificationLevel.Success, t('spr.deploy.successTitle'), t('spr.deploy.success', { name: form.name, namespace: form.namespace }));
    emit('close');
    router.push(explorerResourceRoute(form.cluster, 'apps.deployment', form.name, form.namespace));
  } catch (e) {
    error.value = errorMessage(e);
    btnCb(false);
  }
}
</script>

<template>
  <Card
    :show-highlight-border="false"
    data-testid="spr-deploy-image"
  >
    <template #title>
      <h4 class="text-default-text">
        {{ t('spr.deploy.title') }}
      </h4>
    </template>
    <template #body>
      <div class="spr-deploy__body">
        <p class="text-muted">
          {{ t('spr.deploy.description') }}
        </p>

        <div class="spr-deploy__row">
          <LabeledSelect
            v-model:value="form.cluster"
            :options="clusterOptions"
            :loading="loadingClusters"
            :label="t('spr.deploy.cluster')"
            required
            data-testid="spr-deploy-cluster"
          />
          <LabeledSelect
            v-model:value="form.namespace"
            :options="namespaces"
            :loading="loadingNamespaces"
            :disabled="!form.cluster"
            :label="t('spr.deploy.namespace')"
            required
            data-testid="spr-deploy-namespace"
          />
        </div>

        <div class="spr-deploy__row">
          <LabeledInput
            v-model:value="form.name"
            :label="t('spr.deploy.name')"
            :status="nameError ? 'error' : undefined"
            :sub-label="nameError"
            required
            data-testid="spr-deploy-name"
          />
          <LabeledSelect
            v-model:value="form.reference"
            :options="referenceOptions"
            :label="t('spr.deploy.reference')"
            :tooltip="t('spr.deploy.referenceTooltip')"
            data-testid="spr-deploy-reference"
          />
        </div>

        <div class="spr-deploy__row">
          <LabeledInput
            v-model:value="form.replicas"
            type="number"
            min="0"
            :label="t('spr.deploy.replicas')"
            data-testid="spr-deploy-replicas"
          />
          <LabeledInput
            v-model:value="form.port"
            type="number"
            min="1"
            max="65535"
            :label="t('spr.deploy.port')"
            :tooltip="t('spr.deploy.portTooltip')"
            :status="portInvalid ? 'error' : undefined"
            data-testid="spr-deploy-port"
          />
        </div>

        <LabeledSelect
          v-if="needsSecret"
          v-model:value="form.pullSecret"
          :options="pullSecretOptions"
          :loading="loadingSecrets"
          :disabled="!form.namespace"
          :label="t('spr.deploy.pullSecret')"
          :tooltip="t('spr.deploy.pullSecretTooltip', { host: props.connection.host })"
          data-testid="spr-deploy-pull-secret"
        />
        <Banner
          v-if="missingSecret"
          color="warning"
        >
          <span>{{ t('spr.deploy.missingSecret', { host: props.connection.host, namespace: form.namespace }) }}</span>
          <a
            v-if="secretCreateHref"
            :href="secretCreateHref"
            target="_blank"
            rel="noopener noreferrer"
            class="ml-5"
          >{{ t('spr.deploy.createSecret') }} <i class="icon icon-external-link" /></a>
        </Banner>
        <p
          v-else-if="isPublic"
          class="text-muted"
        >
          {{ t('spr.deploy.publicProject') }}
        </p>

        <div class="spr-deploy__image">
          <span class="text-muted">{{ t('spr.deploy.image') }}</span>
          <code>{{ image }}</code>
        </div>

        <Banner
          v-if="error"
          color="error"
          :label="error"
        />
      </div>
    </template>
    <template #actions>
      <div class="spr-deploy__actions">
        <button
          type="button"
          class="btn role-secondary"
          @click="emit('close')"
        >
          {{ t('generic.cancel') }}
        </button>
        <AsyncButton
          :disabled="!canDeploy"
          :action-label="t('spr.deploy.action')"
          :waiting-label="t('spr.deploy.deploying')"
          data-testid="spr-deploy-confirm"
          @click="deploy"
        />
      </div>
    </template>
  </Card>
</template>

<style lang="scss" scoped>
.spr-deploy__body {
  display: flex;
  flex-direction: column;
  gap: 15px;

  p {
    margin: 0;
  }
}

.spr-deploy__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 15px;
}

.spr-deploy__image {
  display: flex;
  flex-direction: column;
  gap: 4px;

  code {
    overflow-wrap: anywhere;
  }
}

.spr-deploy__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  width: 100%;
}
</style>
