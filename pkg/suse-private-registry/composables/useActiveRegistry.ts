import { computed, ComputedRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ACTIVE_REGISTRY_STORAGE_KEY, REGISTRY_QUERY } from '../config/constants';
import { Connection } from '../types/connection';
import { useConnections } from './useConnections';

function readStored(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_REGISTRY_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(id: string) {
  try {
    window.localStorage.setItem(ACTIVE_REGISTRY_STORAGE_KEY, id);
  } catch {
    // Storage may be unavailable (private mode), the query param still works
  }
}

/**
 * The selected SPR connection: `?registry=<secret-name>` in the route (shareable), else the last used one,
 * else the first connection.
 */
export function useActiveRegistry() {
  const route = useRoute();
  const router = useRouter();
  const { connections, byId } = useConnections();

  const activeId: ComputedRef<string | undefined> = computed(() => {
    const fromQuery = route.query[REGISTRY_QUERY] as string | undefined;

    if (fromQuery && byId(fromQuery)) {
      return fromQuery;
    }

    const stored = readStored();

    if (stored && byId(stored)) {
      return stored;
    }

    return connections.value[0]?.id;
  });

  const active: ComputedRef<Connection | undefined> = computed(() => byId(activeId.value));

  /** The query to carry the active registry into links */
  const registryQuery = computed(() => (activeId.value ? { [REGISTRY_QUERY]: activeId.value } : {}));

  function setActive(id: string) {
    writeStored(id);

    if (route.query[REGISTRY_QUERY] !== id) {
      router.replace({ query: { ...route.query, [REGISTRY_QUERY]: id } });
    }
  }

  watch(activeId, (id) => {
    if (id) {
      writeStored(id);
    }
  }, { immediate: true });

  return {
    activeId,
    active,
    registryQuery,
    setActive,
  };
}
