<script setup lang="ts">
import { computed, onMounted, ref, Ref } from 'vue';
import { useStore } from 'vuex';
import { useRoute } from 'vue-router';
import { Banner } from '@components/Banner';
import { RcDropdown, RcDropdownItem, RcDropdownTrigger } from '@components/RcDropdown';
import SortableTable from '@shell/components/SortableTable/index.vue';
import { useShell } from '@shell/apis';
import { useSprI18n } from '../../composables/useSprI18n';
import { Connection } from '../../types/connection';
import { HarborArtifact, HarborProxyCache } from '../../types/harbor';
import { useConnections } from '../../composables/useConnections';
import { useHarbor } from '../../composables/useHarbor';
import { stateForError } from '../../composables/useConnectionProbe';
import {
  MatchedImage, containerImages, fetchArtifactCached, matchImage, podSpecOf, podsForResource
} from '../../composables/useImageMatching';
import { pinnableDigest, proxyCandidates } from '../../composables/useImageFixes';
import {
  artifactRoute, hasSbom, isScannable, isSigned, scanSummary
} from '../../utils/artifact';
import { parseImageRef, pinImage, shortDigest } from '../../utils/image-ref';
import SeverityBar from '../SeverityBar.vue';
import BooleanMark from '../BooleanMark.vue';
import ImageFixDialog from '../ImageFixDialog.vue';
import SwitchTagDialog from '../SwitchTagDialog.vue';

interface Row extends MatchedImage {
  key: string;
  artifact?: HarborArtifact;
  loading: boolean;
  /** Connection state key when the artifact lookup failed */
  errorState?: string;
}

const props = defineProps<{
  resource: any;
}>();

const store = useStore();
const route = useRoute();
const { t } = useSprI18n(store);
const { schema, connections, load: loadConnections } = useConnections(store);
const { clientFor } = useHarbor();
const shell = useShell();

const rows: Ref<Row[]> = ref([]);
/** Proxy-cache projects of every connection, for "Pull through SPR" on external images */
const proxyCaches: Ref<{ connection: Connection; proxies: HarborProxyCache[] }[]> = ref([]);
const loading = ref(true);
const podError: Ref<any> = ref(null);

const noAccess = computed(() => !schema.value);
const clusterId = computed(() => (route.params.cluster as string) || store.getters['currentCluster']?.id);

// Fixes edit the pod template: workloads only, not pods or workloads owned by another one (a CronJob's Jobs)
const canEdit = computed(() => props.resource?.type !== 'pod' && !props.resource?.metadata?.ownerReferences?.length && !!props.resource?.canUpdate);

const columns = [
  {
    name: 'container', labelKey: 'spr.imageSecurity.headers.container', value: 'container'
  },
  {
    name: 'image', labelKey: 'spr.imageSecurity.headers.image', value: 'image'
  },
  { name: 'source', labelKey: 'spr.imageSecurity.headers.source' },
  { name: 'scan', labelKey: 'spr.imageSecurity.headers.scan' },
  { name: 'vulnerabilities', labelKey: 'spr.imageSecurity.headers.vulnerabilities' },
  {
    name: 'signed', labelKey: 'spr.imageSecurity.headers.signed', width: 80
  },
  {
    name: 'sbom', labelKey: 'spr.imageSecurity.headers.sbom', width: 80
  },
  {
    name: 'link', labelKey: 'spr.imageSecurity.headers.link', width: 90
  },
];

const headers = computed(() => (canEdit.value ? [...columns, {
  name: 'actions', label: ' ', width: 50
}] : columns));

// ---- Fixes ----------------------------------------------------------------------------------------------------------

/** Running digest, else the digest the SPR tag resolves to now; undefined when already pinned */
function pinDigest(row: Row): string | undefined {
  return pinnableDigest(row) || (row.artifact && !parseImageRef(row.image)?.digest ? row.artifact.digest : undefined);
}

function canSwitchTag(row: Row): boolean {
  return !!row.connection && !!row.project && !!row.repo && isScannable(row.artifact);
}

function proxiesFor(row: Row) {
  return row.connection ? [] : proxyCandidates(row, proxyCaches.value);
}

function hasFixes(row: Row): boolean {
  return !!pinDigest(row) || canSwitchTag(row) || !!proxiesFor(row).length;
}

function openPin(row: Row) {
  const digest = pinDigest(row) as string;

  shell.modal.open(ImageFixDialog, {
    props: {
      resource:    props.resource,
      container:   row.container,
      init:        row.init,
      current:     row.image,
      candidates:  [{ label: shortDigest(digest), image: pinImage(row.image, digest) }],
      title:       t('spr.imageFix.pin.title'),
      description: t('spr.imageFix.pin.description', { digest: shortDigest(digest) }),
      afterSave:   () => load(),
    },
    width:               '700px',
    closeOnClickOutside: false,
  });
}

function openSwitchTag(row: Row) {
  shell.modal.open(SwitchTagDialog, {
    props: {
      connection:    row.connection,
      project:       row.project,
      repo:          row.repo,
      resource:      props.resource,
      container:     row.container,
      init:          row.init,
      current:       row.image,
      currentDigest: row.artifact?.digest,
      afterSave:     () => load(),
    },
    width:               '800px',
    closeOnClickOutside: false,
  });
}

function openProxy(row: Row) {
  const candidates = proxiesFor(row);

  shell.modal.open(ImageFixDialog, {
    props: {
      resource:    props.resource,
      container:   row.container,
      init:        row.init,
      current:     row.image,
      candidates:  candidates.map((c) => ({ label: `${ c.connection.displayName } / ${ c.proxy.project }`, image: c.image })),
      title:       t('spr.imageFix.proxy.title'),
      description: t('spr.imageFix.proxy.description', { host: candidates[0]?.proxy.host }),
      afterSave:   () => load(),
    },
    width:               '700px',
    closeOnClickOutside: false,
  });
}

async function loadProxyCaches() {
  if (!canEdit.value || noAccess.value || !rows.value.some((r) => !r.connection)) {
    return;
  }

  const found = await Promise.all(connections.value.map(async(connection) => ({
    connection,
    proxies: await clientFor(connection).proxyCaches().catch(() => [] as HarborProxyCache[]),
  })));

  proxyCaches.value = found.filter((f) => f.proxies.length);
}

async function load() {
  loading.value = true;
  podError.value = null;

  await loadConnections();

  let pod: any;

  try {
    const pods = await podsForResource(store, clusterId.value, props.resource);

    pod = pods.find((p) => (p.status?.containerStatuses || []).some((s: any) => s.imageID)) || pods[0];
  } catch (e) {
    // Without pods we still match on the spec image (tag instead of digest)
    podError.value = e;
  }

  const images = containerImages(podSpecOf(props.resource), pod);

  rows.value = images.map((img) => {
    const matched = noAccess.value ? { ...img } : matchImage(img, connections.value);

    return {
      ...matched,
      key:     `${ img.init ? 'init' : 'main' }/${ img.container }`,
      loading: !!matched.connection,
    };
  });

  loading.value = false;

  loadProxyCaches();

  await Promise.all(rows.value.map(async(row, idx) => {
    if (!row.connection || !row.project || !row.repo || !row.reference) {
      return;
    }

    try {
      const artifact = await fetchArtifactCached(clientFor(row.connection), row.project, row.repo, row.reference);

      rows.value[idx] = {
        ...rows.value[idx], artifact, loading: false
      };
    } catch (e) {
      rows.value[idx] = {
        ...rows.value[idx], errorState: stateForError(e), loading: false
      };
    }
  }));
}

onMounted(load);
</script>

<template>
  <div
    class="spr-image-security"
    data-testid="spr-image-security"
  >
    <Banner
      v-if="noAccess"
      color="info"
      :label="t('spr.imageSecurity.noAccess')"
    />
    <Banner
      v-else-if="!loading && !connections.length"
      color="info"
      :label="t('spr.imageSecurity.noConnections')"
    />
    <Banner
      v-if="podError"
      color="warning"
      :label="t('spr.imageSecurity.noPods')"
    />

    <SortableTable
      :headers="headers"
      :rows="rows"
      key-field="key"
      :loading="loading"
      :table-actions="false"
      :row-actions="false"
      :search="false"
      no-rows-key="spr.imageSecurity.none"
    >
      <template #cell:container="{ row }">
        {{ row.container }}
        <span
          v-if="row.init"
          class="text-muted"
        >({{ t('spr.imageSecurity.init') }})</span>
      </template>
      <template #cell:image="{ row }">
        <span class="spr-image-security__image">{{ row.image }}</span>
      </template>
      <template #cell:source="{ row }">
        <span v-if="row.connection">{{ row.connection.displayName }}</span>
        <span
          v-else
          class="text-muted"
        >{{ t('spr.imageSecurity.external') }}</span>
      </template>
      <template #cell:scan="{ row }">
        <i
          v-if="row.loading"
          class="icon icon-spinner icon-spin"
        />
        <span
          v-else-if="row.errorState"
          class="text-warning"
        >{{ t(`spr.state.${ row.errorState }`) }}</span>
        <span v-else-if="row.artifact">{{ scanSummary(row.artifact)?.scan_status || t('spr.scan.notScanned') }}</span>
        <span
          v-else
          class="text-muted"
        >&mdash;</span>
      </template>
      <template #cell:vulnerabilities="{ row }">
        <SeverityBar
          v-if="row.artifact"
          :summary="scanSummary(row.artifact)?.summary?.summary"
        />
        <span
          v-else
          class="text-muted"
        >&mdash;</span>
      </template>
      <template #cell:signed="{ row }">
        <BooleanMark
          v-if="row.artifact"
          :value="isSigned(row.artifact)"
          :label="t(isSigned(row.artifact) ? 'spr.artifacts.signed' : 'spr.artifacts.unsigned')"
        />
      </template>
      <template #cell:sbom="{ row }">
        <BooleanMark
          v-if="row.artifact"
          :value="hasSbom(row.artifact)"
          :label="t(hasSbom(row.artifact) ? 'spr.artifacts.sbom' : 'spr.artifacts.noSbom')"
        />
      </template>
      <template #cell:link="{ row }">
        <router-link
          v-if="row.artifact && row.connection"
          :to="artifactRoute(row.connection.id, row.project, row.repo, row.artifact.digest)"
        >
          {{ t('spr.imageSecurity.view') }}
        </router-link>
      </template>
      <template #cell:actions="{ row }">
        <RcDropdown
          v-if="!row.loading && hasFixes(row)"
          :aria-label="t('spr.imageFix.menu')"
        >
          <RcDropdownTrigger
            variant="link"
            size="medium"
            :aria-label="t('spr.imageFix.menu')"
            :data-testid="`spr-image-fix-${ row.key }`"
          >
            <i class="icon icon-actions" />
          </RcDropdownTrigger>
          <template #dropdownCollection>
            <RcDropdownItem
              v-if="pinDigest(row)"
              @click="openPin(row)"
            >
              {{ t('spr.imageFix.pin.action') }}
            </RcDropdownItem>
            <RcDropdownItem
              v-if="canSwitchTag(row)"
              @click="openSwitchTag(row)"
            >
              {{ t('spr.imageFix.switchTag.action') }}
            </RcDropdownItem>
            <RcDropdownItem
              v-if="proxiesFor(row).length"
              @click="openProxy(row)"
            >
              {{ t('spr.imageFix.proxy.action') }}
            </RcDropdownItem>
          </template>
        </RcDropdown>
      </template>
    </SortableTable>
  </div>
</template>

<style lang="scss" scoped>
.spr-image-security__image {
  word-break: break-all;
}
</style>
