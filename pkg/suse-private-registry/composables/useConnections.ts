import { computed, ComputedRef, ref, Ref } from 'vue';
import { Store, useStore } from 'vuex';
import { SECRET } from '@shell/config/types';
import { base64Decode, base64Encode } from '@shell/utils/crypto';
import {
  ANNOTATIONS, CONNECTION_LABEL, CONNECTION_NAME_PREFIX, CONNECTION_NAMESPACE, CONNECTION_SELECTOR, SECRET_KEYS
} from '../config/constants';
import { Connection, ConnectionInput } from '../types/connection';
import { hostFromUrl } from '../utils/image-ref';

const loading = ref(false);
const loaded = ref(false);
const loadError: Ref<any> = ref(null);
let loadPromise: Promise<void> | null = null;

export function connectionFromSecret(secret: any): Connection {
  const annotations = secret.metadata?.annotations || {};
  const url = (annotations[ANNOTATIONS.URL] || '').replace(/\/+$/, '');
  let username = '';

  try {
    username = secret.data?.[SECRET_KEYS.USERNAME] ? base64Decode(secret.data[SECRET_KEYS.USERNAME]) : '';
  } catch {
    username = '';
  }

  return {
    id:                secret.metadata?.name,
    displayName:       annotations[ANNOTATIONS.DISPLAY_NAME] || secret.metadata?.name,
    url,
    host:              hostFromUrl(url),
    username,
    linkedCluster:     annotations[ANNOTATIONS.LINKED_CLUSTER] || undefined,
    linkedNamespace:   annotations[ANNOTATIONS.LINKED_NAMESPACE] || undefined,
    linkedApp:         annotations[ANNOTATIONS.LINKED_APP] || undefined,
    creationTimestamp: secret.metadata?.creationTimestamp,
    credentialId:      `${ CONNECTION_NAMESPACE }:${ secret.metadata?.name }`,
    secret,
  };
}

function applyAnnotations(metadata: any, input: ConnectionInput) {
  const annotations = { ...(metadata.annotations || {}) };

  annotations[ANNOTATIONS.DISPLAY_NAME] = input.displayName.trim();
  annotations[ANNOTATIONS.URL] = input.url.trim().replace(/\/+$/, '');

  const optional: [string, string | undefined][] = [
    [ANNOTATIONS.LINKED_CLUSTER, input.linkedCluster],
    [ANNOTATIONS.LINKED_NAMESPACE, input.linkedNamespace],
    [ANNOTATIONS.LINKED_APP, input.linkedApp],
  ];

  optional.forEach(([key, value]) => {
    if (value) {
      annotations[key] = value;
    } else {
      delete annotations[key];
    }
  });

  metadata.annotations = annotations;
}

/**
 * Connection Secrets (one per SPR instance) in `cattle-global-data`.
 */
export function useConnections(storeArg?: Store<any>) {
  const store = storeArg || useStore();

  const schema = computed(() => store.getters['management/schemaFor'](SECRET));

  const canManage: ComputedRef<boolean> = computed(() => {
    const methods: string[] = (schema.value?.collectionMethods || []).map((m: string) => m.toLowerCase());

    return methods.includes('post');
  });

  const connections: ComputedRef<Connection[]> = computed(() => {
    if (!schema.value) {
      return [];
    }

    const secrets = store.getters['management/matching'](SECRET, CONNECTION_SELECTOR, CONNECTION_NAMESPACE) || [];

    return secrets
      .map(connectionFromSecret)
      .sort((a: Connection, b: Connection) => a.displayName.localeCompare(b.displayName));
  });

  async function load(force = false): Promise<void> {
    if (!schema.value) {
      loaded.value = true;

      return;
    }

    if (loadPromise && !force) {
      return loadPromise;
    }

    loading.value = true;
    loadError.value = null;

    loadPromise = store.dispatch('management/findMatching', {
      type:      SECRET,
      selector:  CONNECTION_SELECTOR,
      namespace: CONNECTION_NAMESPACE,
      opt:       { force },
    }).then(() => {
      loaded.value = true;
    }).catch((e: any) => {
      loadError.value = e;
      loaded.value = true;
      loadPromise = null;
    }).finally(() => {
      loading.value = false;
    });

    return loadPromise;
  }

  function byId(id?: string | null): Connection | undefined {
    if (!id) {
      return undefined;
    }

    return connections.value.find((c) => c.id === id);
  }

  async function create(input: ConnectionInput): Promise<Connection> {
    const metadata: any = {
      namespace:    CONNECTION_NAMESPACE,
      generateName: CONNECTION_NAME_PREFIX,
      labels:       { [CONNECTION_LABEL]: 'true' },
    };

    applyAnnotations(metadata, input);

    const secret = await store.dispatch('management/create', {
      type:  SECRET,
      _type: 'Opaque',
      metadata,
      data:  {
        [SECRET_KEYS.USERNAME]: base64Encode(input.username.trim()),
        [SECRET_KEYS.PASSWORD]: base64Encode(input.password),
      },
    });

    const saved = await secret.save();

    return connectionFromSecret(saved);
  }

  async function update(connection: Connection, input: ConnectionInput): Promise<Connection> {
    const secret = await store.dispatch('management/find', {
      type: SECRET,
      id:   `${ CONNECTION_NAMESPACE }/${ connection.id }`,
      opt:  { force: true },
    });

    applyAnnotations(secret.metadata, input);
    secret.data = { ...(secret.data || {}) };
    secret.data[SECRET_KEYS.USERNAME] = base64Encode(input.username.trim());

    if (input.password) {
      secret.data[SECRET_KEYS.PASSWORD] = base64Encode(input.password);
    }

    const saved = await secret.save();

    return connectionFromSecret(saved);
  }

  async function remove(connection: Connection): Promise<void> {
    await connection.secret.remove();
  }

  return {
    schema,
    canManage,
    connections,
    loading,
    loaded,
    loadError,
    load,
    byId,
    create,
    update,
    remove,
  };
}
