<script setup lang="ts">
import { computed, onMounted, ref, Ref } from 'vue';
import { useStore } from 'vuex';
import { Card } from '@components/Card';
import { Banner } from '@components/Banner';
import Loading from '@shell/components/Loading.vue';
import { useSprI18n } from '../composables/useSprI18n';
import { Connection } from '../types/connection';
import { normaliseHarborError, useHarbor } from '../composables/useHarbor';
import { CveAffectedArtifact, cveExposureTargets } from '../composables/useCveExposure';
import { artifactRoute } from '../utils/artifact';
import { shortDigest } from '../utils/image-ref';
import RunningInTable from './RunningInTable.vue';
import SeverityBadge from './SeverityBadge.vue';

// Affected artifacts listed before collapsing into "and N more"
const LIST_LIMIT = 8;

/**
 * "Who's exposed?": artifacts affected by a CVE (Security Hub), then the workloads running them in every ready cluster.
 */
const props = withDefaults(defineProps<{
  connection: Connection;
  cveId: string;
  /** Always searched, also when Security Hub can't be read (e.g. the artifact the dialog was opened from) */
  knownDigests?: string[];
}>(), { knownDigests: () => [] });

const emit = defineEmits<{(e: 'close'): void}>();

const store = useStore();
const { t } = useSprI18n(store);
const { clientFor } = useHarbor();

const loading = ref(true);
const hubError = ref<string | null>(null);
const artifacts: Ref<CveAffectedArtifact[]> = ref([]);
const digests: Ref<string[]> = ref([]);
const showAll = ref(false);

const repoCount = computed(() => new Set(artifacts.value.map((a) => `${ a.project }/${ a.repo }`)).size);
const listed = computed(() => (showAll.value ? artifacts.value : artifacts.value.slice(0, LIST_LIMIT)));

onMounted(async() => {
  try {
    const targets = await cveExposureTargets(clientFor(props.connection), props.cveId);

    artifacts.value = targets.artifacts;
    digests.value = [...new Set([...targets.digests, ...props.knownDigests])];
  } catch (e) {
    hubError.value = normaliseHarborError(e).message;
    digests.value = [...props.knownDigests];
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <Card
    :show-highlight-border="false"
    data-testid="spr-cve-exposure"
  >
    <template #title>
      <h4 class="text-default-text">
        {{ t('spr.exposure.title', { cve: props.cveId }) }}
      </h4>
    </template>
    <template #body>
      <div class="spr-exposure__body">
        <Loading
          v-if="loading"
          mode="relative"
        />
        <template v-else>
          <Banner
            v-if="hubError"
            color="warning"
            :label="t(props.knownDigests.length ? 'spr.exposure.hubFailedKnown' : 'spr.exposure.hubFailed', { error: hubError })"
          />
          <template v-else>
            <p>{{ t('spr.exposure.summary', { artifacts: artifacts.length, repositories: repoCount }) }}</p>
            <ul
              v-if="artifacts.length"
              class="spr-exposure__artifacts"
            >
              <li
                v-for="a in listed"
                :key="a.key"
              >
                <SeverityBadge
                  v-if="a.severity"
                  :severity="a.severity"
                />
                <router-link
                  :to="artifactRoute(props.connection.id, a.project, a.repo, a.digest)"
                  @click="emit('close')"
                >
                  {{ a.project }}/{{ a.repo }}:{{ a.tags[0] || shortDigest(a.digest) }}
                </router-link>
                <span
                  v-if="a.packages.length"
                  class="text-muted"
                >{{ a.packages.join(', ') }}</span>
              </li>
            </ul>
            <a
              v-if="artifacts.length > LIST_LIMIT && !showAll"
              href="#"
              @click.prevent="showAll = true"
            >{{ t('spr.exposure.showAll', { count: artifacts.length - LIST_LIMIT }) }}</a>
          </template>

          <RunningInTable
            v-if="digests.length"
            :host="props.connection.host"
            :digests="digests"
            auto-start
            show-repository
            @navigate="emit('close')"
          />
        </template>
      </div>
    </template>
    <template #actions>
      <div class="spr-exposure__actions">
        <button
          type="button"
          class="btn role-secondary"
          @click="emit('close')"
        >
          {{ t('generic.close') }}
        </button>
      </div>
    </template>
  </Card>
</template>

<style lang="scss" scoped>
.spr-exposure__body {
  display: flex;
  flex-direction: column;
  gap: 15px;
  min-height: 120px;
  max-height: 70vh;
  overflow-y: auto;

  p {
    margin: 0;
  }
}

.spr-exposure__artifacts {
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 0;
  }
}

.spr-exposure__actions {
  display: flex;
  justify-content: flex-end;
  width: 100%;
}
</style>
