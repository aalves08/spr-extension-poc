<script setup lang="ts">
import { computed, ref } from 'vue';
import { useStore } from 'vuex';
import { Card } from '@components/Card';
import { Banner } from '@components/Banner';
import LabeledSelect from '@shell/components/form/LabeledSelect.vue';
import AsyncButton from '@shell/components/AsyncButton.vue';
import { useShell } from '@shell/apis';
import { NotificationLevel } from '@shell/types/notifications';
import { useSprI18n } from '../composables/useSprI18n';
import { ImageFixCandidate, updateContainerImage } from '../composables/useImageFixes';
import { errorMessage } from '../utils/k8s';

type Callback = () => void;

/**
 * Before/after confirmation for changing one container image of a workload.
 */
const props = defineProps<{
  resource: any;
  container: string;
  init: boolean;
  current: string;
  /** One or more replacement images; a select is shown when there's a choice */
  candidates: ImageFixCandidate[];
  title: string;
  description: string;
  /** Called after a successful save */
  afterSave?: Callback;
}>();

const emit = defineEmits<{(e: 'close'): void}>();

const store = useStore();
const shell = useShell();
const { t } = useSprI18n(store);

const selected = ref(props.candidates[0]?.image || '');
const error = ref<string | null>(null);

const options = computed(() => props.candidates.map((c) => ({ label: c.label, value: c.image })));

async function apply(btnCb: (ok: boolean) => void) {
  error.value = null;

  try {
    await updateContainerImage(store, props.resource, { container: props.container, init: props.init }, selected.value);
    btnCb(true);
    shell.notification.send(NotificationLevel.Success, props.title, t('spr.imageFix.success', { container: props.container }));
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
    data-testid="spr-image-fix"
  >
    <template #title>
      <h4 class="text-default-text">
        {{ props.title }}
      </h4>
    </template>
    <template #body>
      <div class="spr-image-fix__body">
        <p>{{ props.description }}</p>
        <LabeledSelect
          v-if="props.candidates.length > 1"
          v-model:value="selected"
          :options="options"
          :label="t('spr.imageFix.choose')"
          data-testid="spr-image-fix-choice"
        />
        <dl class="spr-image-fix__change">
          <dt class="text-muted">
            {{ t('spr.imageFix.container', { container: props.container }) }} &middot; {{ t('spr.imageFix.before') }}
          </dt>
          <dd><code>{{ props.current }}</code></dd>
          <dt class="text-muted">
            {{ t('spr.imageFix.after') }}
          </dt>
          <dd><code>{{ selected }}</code></dd>
        </dl>
        <Banner
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
      <div class="spr-image-fix__actions">
        <button
          type="button"
          class="btn role-secondary"
          @click="emit('close')"
        >
          {{ t('generic.cancel') }}
        </button>
        <AsyncButton
          :disabled="!selected || selected === props.current"
          :action-label="t('spr.imageFix.apply')"
          :waiting-label="t('spr.imageFix.applying')"
          data-testid="spr-image-fix-confirm"
          @click="apply"
        />
      </div>
    </template>
  </Card>
</template>

<style lang="scss" scoped>
.spr-image-fix__body {
  display: flex;
  flex-direction: column;
  gap: 15px;

  p {
    margin: 0;
  }
}

.spr-image-fix__change {
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

.spr-image-fix__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  width: 100%;
}
</style>
