<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { useStore } from 'vuex';
import { copyTextToClipboard } from '@shell/utils/clipboard';
import { useSprI18n } from '../composables/useSprI18n';
import { shortDigest } from '../utils/image-ref';

/**
 * Short digest with an icon-only copy button (copies the full digest).
 * Shell's CopyToClipboard is a full "Copy" button, too heavy for table cells and metadata.
 */
const props = defineProps<{
  digest: string;
}>();

const store = useStore();
const { t } = useSprI18n(store);

const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

async function copy() {
  try {
    await copyTextToClipboard(props.digest);
    copied.value = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      copied.value = false;
    }, 1500);
  } catch {
    copied.value = false;
  }
}

onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <span
    class="spr-digest-copy"
    :title="props.digest"
  >
    <code>{{ shortDigest(props.digest) }}</code>
    <button
      v-clean-tooltip="t(copied ? 'spr.artifacts.digestCopied' : 'spr.artifacts.copyDigest')"
      type="button"
      class="btn btn-sm role-link spr-digest-copy__btn"
      :aria-label="t('spr.artifacts.copyDigest')"
      data-testid="spr-digest-copy"
      @click.stop.prevent="copy"
    >
      <i
        class="icon"
        :class="copied ? 'icon-checkmark' : 'icon-copy'"
      />
    </button>
  </span>
</template>

<style lang="scss" scoped>
.spr-digest-copy {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  white-space: nowrap;
}

.spr-digest-copy__btn {
  min-height: 24px;
  padding: 0 4px;
  line-height: 24px;
}
</style>
