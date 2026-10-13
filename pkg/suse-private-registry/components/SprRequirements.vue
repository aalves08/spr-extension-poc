<script setup lang="ts">
import { useStore } from 'vuex';
import { Banner } from '@components/Banner';
import { useSprI18n } from '../composables/useSprI18n';
import { SPR_DOCS_REQUIREMENTS_URL } from '../config/constants';

const store = useStore();
const { t } = useSprI18n(store);
</script>

<template>
  <Banner
    color="info"
    class="spr-requirements"
    data-testid="spr-requirements"
  >
    <div class="spr-requirements__body">
      <strong>{{ t('spr.requirements.title') }}</strong>
      <span>{{ t('spr.requirements.intro') }}</span>
      <ul>
        <li>{{ t('spr.requirements.where') }}</li>
        <li>{{ t('spr.requirements.cluster') }}</li>
        <li>{{ t('spr.requirements.storage') }}</li>
        <li>{{ t('spr.requirements.network') }}</li>
      </ul>
      <a
        :href="SPR_DOCS_REQUIREMENTS_URL"
        target="_blank"
        rel="noopener noreferrer nofollow"
      >
        {{ t('spr.requirements.link') }} <i class="icon icon-external-link" />
      </a>
    </div>
  </Banner>
</template>

<style lang="scss" scoped>
.spr-requirements {
  text-align: left;
}

.spr-requirements__body {
  display: flex;
  flex-direction: column;
  gap: 5px;

  ul {
    margin: 0;
    padding-left: 20px;
  }
}
</style>
