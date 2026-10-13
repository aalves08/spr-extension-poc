<script setup lang="ts">
import { computed } from 'vue';
import { HarborDangerousArtifact } from '../../types/harbor';
import { artifactRoute } from '../../utils/artifact';
import { splitProjectRepo } from '../../utils/image-ref';
import SeverityAmountBar from '../SeverityAmountBar.vue';

const ROWS = 5;
// Harbor's dangerous artifacts only count these
const COUNTED = ['Critical', 'High', 'Medium'] as const;

/**
 * Top 5 artifacts: name link + segmented severity bar. Pads to 5 rows so the strip keeps its height.
 */
const props = defineProps<{
  connectionId: string;
  artifacts: HarborDangerousArtifact[];
}>();

const rows = computed(() => props.artifacts.slice(0, ROWS).map((a) => {
  const split = splitProjectRepo(a.repository_name);

  return {
    key:     `${ a.repository_name }@${ a.digest }`,
    name:    a.repository_name,
    short:   a.digest?.substring(0, 15),
    to:      split ? artifactRoute(props.connectionId, split.project, split.repo, a.digest) : undefined,
    summary: {
      Critical: a.critical_cnt || 0, High: a.high_cnt || 0, Medium: a.medium_cnt || 0
    },
  };
}));

const padding = computed(() => Math.max(0, ROWS - rows.value.length));
</script>

<template>
  <div
    class="spr-top-artifacts"
    data-testid="spr-top-artifacts"
  >
    <div
      v-for="r in rows"
      :key="r.key"
      class="spr-top-artifacts__row"
    >
      <span
        class="spr-top-artifacts__name"
        :title="`${ r.name }@${ r.short }`"
      >
        <router-link
          v-if="r.to"
          :to="r.to"
        >{{ r.name }}</router-link>
        <span v-else>{{ r.name }}</span>
        <span class="text-muted ml-5">{{ r.short }}</span>
      </span>
      <SeverityAmountBar
        class="spr-top-artifacts__bar"
        :summary="r.summary"
        :severities="COUNTED"
      />
    </div>
    <div
      v-for="n in padding"
      :key="`pad-${ n }`"
      class="spr-top-artifacts__row"
    />
  </div>
</template>

<style lang="scss" scoped>
.spr-top-artifacts__row {
  display: flex;
  align-items: center;
  gap: 16px;
  height: 36px;
  padding: 0 8px;
  border-radius: 4px;

  &:hover:not(:empty) {
    background: var(--sortable-table-selected-bg);
  }
}

.spr-top-artifacts__name {
  flex: 3;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.spr-top-artifacts__bar {
  flex: 2;
  min-width: 120px;
}
</style>
