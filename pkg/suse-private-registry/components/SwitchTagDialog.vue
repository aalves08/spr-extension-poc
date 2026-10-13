<script setup lang="ts">
import { computed, onMounted, ref, Ref } from 'vue';
import { useStore } from 'vuex';
import { Card } from '@components/Card';
import { Banner } from '@components/Banner';
import { RadioButton } from '@components/Form/Radio';
import LiveDate from '@shell/components/formatter/LiveDate.vue';
import Loading from '@shell/components/Loading.vue';
import AsyncButton from '@shell/components/AsyncButton.vue';
import { useShell } from '@shell/apis';
import { NotificationLevel } from '@shell/types/notifications';
import { useSprI18n } from '../composables/useSprI18n';
import { Connection } from '../types/connection';
import { HarborArtifact } from '../types/harbor';
import { normaliseHarborError, useHarbor } from '../composables/useHarbor';
import { updateContainerImage } from '../composables/useImageFixes';
import { isScannable, scanSummary, tagNames } from '../utils/artifact';
import { parseImageRef } from '../utils/image-ref';
import { errorMessage } from '../utils/k8s';
import SeverityBar from './SeverityBar.vue';

interface Candidate {
  tag: string;
  artifact: HarborArtifact;
  summary?: Record<string, number>;
  /** Lower is better; undefined when not scanned */
  score?: number;
  current: boolean;
}

type Callback = () => void;

// Weight so one critical outranks any number of lower findings in practice
const WEIGHTS: Record<string, number> = {
  Critical: 1e9, High: 1e6, Medium: 1e3, Low: 1
};

/**
 * Pick another tag of the same SPR repository, ranked by vulnerabilities, and set it on the container.
 */
const props = defineProps<{
  connection: Connection;
  project: string;
  repo: string;
  resource: any;
  container: string;
  init: boolean;
  /** Spec image */
  current: string;
  /** Digest of the artifact the container runs */
  currentDigest?: string;
  afterSave?: Callback;
}>();

const emit = defineEmits<{(e: 'close'): void}>();

const store = useStore();
const shell = useShell();
const { t } = useSprI18n(store);
const { clientFor } = useHarbor();

const loading = ref(true);
const loadError = ref<string | null>(null);
const error = ref<string | null>(null);
const candidates: Ref<Candidate[]> = ref([]);
const selected = ref('');

function score(summary?: Record<string, number>): number | undefined {
  return summary ? Object.entries(WEIGHTS).reduce((sum, [sev, w]) => sum + (summary[sev] || 0) * w, 0) : undefined;
}

const currentScore = computed(() => candidates.value.find((c) => c.current)?.score);

function better(c: Candidate): boolean {
  return !c.current && c.score !== undefined && currentScore.value !== undefined && c.score < currentScore.value;
}

// Keep the digest pin if the container is pinned today
const pinned = computed(() => !!parseImageRef(props.current)?.digest);
const base = computed(() => `${ props.connection.host }/${ props.project }/${ props.repo }`);
const selectedCandidate = computed(() => candidates.value.find((c) => c.tag === selected.value));
const newImage = computed(() => {
  const c = selectedCandidate.value;

  return c ? `${ base.value }:${ c.tag }${ pinned.value ? `@${ c.artifact.digest }` : '' }` : '';
});

onMounted(async() => {
  try {
    const artifacts = await clientFor(props.connection).artifacts(props.project, props.repo);

    candidates.value = artifacts
      .filter(isScannable)
      .flatMap((a) => tagNames(a).map((tag) => {
        const summary = scanSummary(a)?.summary?.summary;

        return {
          tag, artifact: a, summary, score: score(summary), current: a.digest === props.currentDigest
        };
      }))
      .sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity) || (b.artifact.push_time || '').localeCompare(a.artifact.push_time || ''));
  } catch (e) {
    loadError.value = normaliseHarborError(e).message;
  } finally {
    loading.value = false;
  }
});

async function apply(btnCb: (ok: boolean) => void) {
  error.value = null;

  try {
    await updateContainerImage(store, props.resource, { container: props.container, init: props.init }, newImage.value);
    btnCb(true);
    shell.notification.send(NotificationLevel.Success, t('spr.imageFix.switchTag.title'), t('spr.imageFix.success', { container: props.container }));
    props.afterSave?.();
    emit('close');
  } catch (e) {
    error.value = errorMessage(e);
    btnCb(false);
  }
}
</script>

<template>
  <Card
    :show-highlight-border="false"
    data-testid="spr-switch-tag"
  >
    <template #title>
      <h4 class="text-default-text">
        {{ t('spr.imageFix.switchTag.title') }}
      </h4>
    </template>
    <template #body>
      <div class="spr-switch-tag__body">
        <p>{{ t('spr.imageFix.switchTag.description', { repo: `${ props.project }/${ props.repo }`, container: props.container }) }}</p>
        <Loading
          v-if="loading"
          mode="relative"
        />
        <Banner
          v-else-if="loadError"
          color="error"
          :label="loadError"
        />
        <p
          v-else-if="!candidates.length"
          class="text-muted"
        >
          {{ t('spr.imageFix.switchTag.none') }}
        </p>
        <ul
          v-else
          class="spr-switch-tag__list"
        >
          <li
            v-for="c in candidates"
            :key="c.tag"
            :class="{ 'spr-switch-tag__item--current': c.current }"
          >
            <RadioButton
              name="spr-switch-tag"
              :val="c.tag"
              :value="selected"
              :disabled="c.current"
              :label="c.tag"
              @update:value="selected = $event"
            />
            <span class="spr-switch-tag__badges">
              <span
                v-if="c.current"
                class="text-muted"
              >{{ t('spr.imageFix.switchTag.current') }}</span>
              <span
                v-else-if="better(c)"
                class="text-success"
              >{{ t('spr.imageFix.switchTag.better') }}</span>
            </span>
            <SeverityBar
              class="spr-switch-tag__severity"
              :summary="c.summary"
              :empty-label="t('spr.scan.notScanned')"
            />
            <LiveDate
              class="spr-switch-tag__pushed text-muted"
              :value="c.artifact.push_time"
              add-suffix
            />
          </li>
        </ul>

        <dl
          v-if="newImage"
          class="spr-switch-tag__change"
        >
          <dt class="text-muted">
            {{ t('spr.imageFix.container', { container: props.container }) }} &middot; {{ t('spr.imageFix.before') }}
          </dt>
          <dd><code>{{ props.current }}</code></dd>
          <dt class="text-muted">
            {{ t('spr.imageFix.after') }}
          </dt>
          <dd><code>{{ newImage }}</code></dd>
        </dl>
        <Banner
          v-if="newImage"
          color="info"
          :label="t('spr.imageFix.rollout')"
        />
        <Banner
          v-if="error"
          color="error"
          :label="error"
        />
      </div>
    </template>
    <template #actions>
      <div class="spr-switch-tag__actions">
        <button
          type="button"
          class="btn role-secondary"
          @click="emit('close')"
        >
          {{ t('generic.cancel') }}
        </button>
        <AsyncButton
          :disabled="!newImage"
          :action-label="t('spr.imageFix.apply')"
          :waiting-label="t('spr.imageFix.applying')"
          data-testid="spr-switch-tag-confirm"
          @click="apply"
        />
      </div>
    </template>
  </Card>
</template>

<style lang="scss" scoped>
.spr-switch-tag__body {
  display: flex;
  flex-direction: column;
  gap: 15px;
  max-height: 70vh;
  overflow-y: auto;

  p {
    margin: 0;
  }
}

.spr-switch-tag__list {
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 8px;
    border-radius: 4px;

    &:hover {
      background: var(--sortable-table-selected-bg);
    }
  }
}

.spr-switch-tag__item--current {
  font-weight: 600;
}

.spr-switch-tag__badges {
  width: 110px;
  flex-shrink: 0;
  font-size: 12px;
}

.spr-switch-tag__severity {
  flex: 1;
  min-width: 0;
}

.spr-switch-tag__pushed {
  width: 110px;
  flex-shrink: 0;
  text-align: right;
}

.spr-switch-tag__change {
  margin: 0;

  dt {
    margin-bottom: 4px;
    font-weight: normal;
  }

  dd {
    margin: 0 0 12px;
    overflow-wrap: anywhere;
  }
}

.spr-switch-tag__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  width: 100%;
}
</style>
