<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useStore } from 'vuex';
import { useSprI18n } from '../composables/useSprI18n';
import { HarborRepository, HarborRepositoryRow } from '../types/harbor';
import { useActiveRegistry } from '../composables/useActiveRegistry';
import { useHarbor } from '../composables/useHarbor';
import { useAsyncData } from '../composables/useAsyncData';
import { repoNameWithoutProject } from '../utils/harbor-encoding';
import SprPage from '../components/SprPage.vue';
import UnavailableCard from '../components/UnavailableCard.vue';
import RepositoriesTable from '../components/RepositoriesTable.vue';

const store = useStore();
const { t } = useSprI18n(store);
const { active } = useActiveRegistry();
const { clientFor } = useHarbor();

const repositories = useAsyncData<HarborRepository[]>(async() => {
  if (!active.value) {
    return [];
  }

  return clientFor(active.value).allRepositories();
});

// Harbor repository names are `<project>/<repo>`; the repo part can contain more slashes
const rows = computed<HarborRepositoryRow[]>(() => (repositories.data.value || []).map((r) => {
  const project = r.name.split('/')[0];

  return {
    ...r, project, shortName: repoNameWithoutProject(project, r.name)
  };
}));

onMounted(() => repositories.run());
watch(() => active.value?.id, () => repositories.run());
</script>

<template>
  <SprPage
    :title="t('spr.repositories.title')"
    selector
  >
    <UnavailableCard
      v-if="repositories.error.value"
      :error="repositories.error.value"
    />
    <RepositoriesTable
      v-else
      :rows="rows"
      :loading="repositories.loading.value"
      show-project
      no-rows-key="spr.repositories.noneAll"
      data-testid="spr-all-repositories"
    />
  </SprPage>
</template>
