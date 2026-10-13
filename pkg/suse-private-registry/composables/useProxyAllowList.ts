import { computed, ComputedRef, ref, Ref } from 'vue';
import { Store, useStore } from 'vuex';
import { MANAGEMENT } from '@shell/config/types';
import { useShell } from '@shell/apis';
import { PROXY_ENDPOINT_NAME } from '../config/constants';

const loaded = ref(false);
const externallyAllowed: Ref<Record<string, boolean>> = ref({});
let loadPromise: Promise<void> | null = null;

function hasMethod(methods: string[] | undefined, method: string): boolean {
  return (methods || []).some((m) => m.toLowerCase() === method);
}

/**
 * Manages the `/meta/proxy` allow-list for SPR hosts via our own `ProxyEndpoint` CR (`suse-private-registry`).
 *
 * The CRs are loaded with a watch, so deleting the CR (or a route) is picked up without a reload.
 */
export function useProxyAllowList(storeArg?: Store<any>) {
  const store = storeArg || useStore();
  const shell = useShell();

  const schema = computed(() => store.getters['management/schemaFor'](MANAGEMENT.PROXY_ENDPOINT));

  const canList = computed(() => !!schema.value);
  const canCreate = computed(() => hasMethod(schema.value?.collectionMethods, 'post'));
  const canUpdate = computed(() => hasMethod(schema.value?.resourceMethods, 'put'));

  const endpoints: ComputedRef<any[]> = computed(() => {
    if (!canList.value || !loaded.value) {
      return [];
    }

    return store.getters['management/all'](MANAGEMENT.PROXY_ENDPOINT) || [];
  });

  const ownEndpoint = computed(() => endpoints.value.find((e: any) => e.metadata?.name === PROXY_ENDPOINT_NAME));

  /** All allowed domains across every ProxyEndpoint, lower-cased */
  const allowedDomains: ComputedRef<Set<string>> = computed(() => {
    const out = new Set<string>();

    endpoints.value.forEach((e: any) => {
      (e.spec?.routes || []).forEach((r: { domain?: string }) => {
        if (r.domain) {
          out.add(r.domain.toLowerCase());
        }
      });
    });

    return out;
  });

  /** The proxy matches on host only (no port) */
  function domainFor(host: string): string {
    return host.toLowerCase().replace(/:\d+$/, '');
  }

  function isAllowed(host: string): boolean {
    const domain = domainFor(host);

    if (allowedDomains.value.has(domain) || externallyAllowed.value[domain]) {
      return true;
    }

    // Wildcard routes use `%` as the wildcard character (e.g. `%.example.com`)
    return [...allowedDomains.value].some((pattern) => {
      if (!pattern.includes('%')) {
        return false;
      }
      const re = new RegExp(`^${ pattern.split('%').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^.]+') }$`);

      return re.test(domain);
    });
  }

  function missingHosts(hosts: string[]): string[] {
    const unique = [...new Set(hosts.filter(Boolean).map(domainFor))];

    return unique.filter((h) => !isAllowed(h));
  }

  async function load(): Promise<void> {
    if (!canList.value) {
      loaded.value = true;

      return;
    }

    if (!loadPromise) {
      loadPromise = store.dispatch('management/findAll', { type: MANAGEMENT.PROXY_ENDPOINT })
        .then(() => {
          loaded.value = true;
        })
        .catch(() => {
          loaded.value = true;
          loadPromise = null;
        });
    }

    return loadPromise;
  }

  /**
   * Hosts could be allowed by a CR we can't see (or one created after load). Double check through the shell API once.
   */
  async function recheck(hosts: string[]): Promise<void> {
    await Promise.all(hosts.map(async(h) => {
      try {
        if (await shell.proxy.isDomainAllowed(domainFor(h))) {
          externallyAllowed.value = { ...externallyAllowed.value, [domainFor(h)]: true };
        }
      } catch {
        // Ignore, the banner stays visible
      }
    }));
  }

  /**
   * Add hosts to our ProxyEndpoint. `allowDomains` always creates a new CR, so we only use it when ours doesn't exist.
   */
  async function allow(hosts: string[]): Promise<void> {
    const domains = [...new Set(hosts.map(domainFor))];

    if (!domains.length) {
      return;
    }

    const existing = ownEndpoint.value || await findOwn();

    if (!existing) {
      await shell.proxy.allowDomains(domains, PROXY_ENDPOINT_NAME);
    } else {
      const routes: { domain: string }[] = [...(existing.spec?.routes || [])];
      const current = new Set(routes.map((r) => r.domain?.toLowerCase()));

      domains.forEach((d) => {
        if (!current.has(d)) {
          routes.push({ domain: d });
        }
      });

      existing.spec = { ...(existing.spec || {}), routes };
      await existing.save();
    }

    await store.dispatch('management/findAll', { type: MANAGEMENT.PROXY_ENDPOINT, opt: { force: true } });
  }

  /**
   * Remove hosts from our ProxyEndpoint (used when the last connection for a host is deleted).
   */
  async function disallow(hosts: string[]): Promise<void> {
    const existing = ownEndpoint.value || await findOwn();

    if (!existing) {
      return;
    }

    const remove = new Set(hosts.map(domainFor));
    const routes = (existing.spec?.routes || []).filter((r: { domain: string }) => !remove.has(r.domain?.toLowerCase()));

    if (!routes.length) {
      await existing.remove();
    } else {
      existing.spec = { ...(existing.spec || {}), routes };
      await existing.save();
    }
  }

  async function findOwn(): Promise<any | undefined> {
    try {
      return await store.dispatch('management/find', {
        type: MANAGEMENT.PROXY_ENDPOINT,
        id:   PROXY_ENDPOINT_NAME,
        opt:  { force: true },
      });
    } catch (e: any) {
      if (e?._status === 404 || e?.status === 404) {
        return undefined;
      }
      throw e;
    }
  }

  const canFix = computed(() => (ownEndpoint.value ? canUpdate.value : canCreate.value));

  return {
    loaded,
    canList,
    canFix,
    ownEndpoint,
    allowedDomains,
    isAllowed,
    missingHosts,
    load,
    recheck,
    allow,
    disallow,
  };
}
