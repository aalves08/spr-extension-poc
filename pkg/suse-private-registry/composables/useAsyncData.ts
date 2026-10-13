import { ref, Ref } from 'vue';

/**
 * Small loader for independently loading page sections (Overview tiles, detail headers).
 * A newer `run()` wins over an older one still in flight.
 * `silent` (polling) keeps the current data on screen: no loading state, errors are ignored.
 */
export function useAsyncData<T>(fn: () => Promise<T>) {
  const data: Ref<T | undefined> = ref();
  const loading = ref(false);
  const error: Ref<any> = ref(null);
  let generation = 0;

  async function run(opts: { silent?: boolean } = {}): Promise<void> {
    const mine = ++generation;

    if (!opts.silent) {
      loading.value = true;
      error.value = null;
    }

    try {
      const res = await fn();

      if (mine === generation) {
        data.value = res;
      }
    } catch (e) {
      if (mine === generation && !opts.silent) {
        error.value = e;
        data.value = undefined;
      }
    } finally {
      if (mine === generation) {
        loading.value = false;
      }
    }
  }

  return {
    data, loading, error, run
  };
}
