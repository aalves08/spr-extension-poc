import { Store } from 'vuex';
import { base64Decode } from '@shell/utils/crypto';
import { normaliseHost } from './image-ref';

export const SECRET_TYPE = { DOCKER_CONFIG_JSON: 'kubernetes.io/dockerconfigjson' } as const;

/** Rancher's workload selector label, so created Deployments look like ones made in the Cluster Explorer */
export const WORKLOAD_SELECTOR_LABEL = 'workload.user.cattle.io/workloadselector';

const DNS_LABEL_MAX = 63;
const DNS_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

/**
 * Create a resource in a downstream cluster through Steve. `type` is the plural collection, e.g. `apps.deployments`.
 */
export function steveCreate(store: Store<any>, clusterId: string, type: string, body: any): Promise<any> {
  return store.dispatch('management/request', {
    url:                  `/k8s/clusters/${ clusterId }/v1/${ type }`,
    method:               'POST',
    data:                 body,
    redirectUnauthorized: false,
  });
}

export function errorMessage(e: any): string {
  return e?.message || e?._statusText || (typeof e === 'string' ? e : JSON.stringify(e));
}

export function isDnsLabel(value: string): boolean {
  return value.length <= DNS_LABEL_MAX && DNS_LABEL.test(value);
}

/** Lower-case, non-alphanumerics to `-`, trimmed to a valid DNS-1123 label */
export function toDnsLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, DNS_LABEL_MAX)
    .replace(/^-+|-+$/g, '');
}

/**
 * Registry hosts a `kubernetes.io/dockerconfigjson` secret has credentials for.
 * Keys can be a bare host or a URL (`https://index.docker.io/v1/`).
 */
export function dockerConfigHosts(secret: any): string[] {
  const raw = secret?.data?.['.dockerconfigjson'];

  if (!raw) {
    return [];
  }

  try {
    const auths = JSON.parse(base64Decode(raw))?.auths || {};

    return Object.keys(auths).map((key) => normaliseHost(key.replace(/^[a-z]+:\/\//, '').split('/')[0]));
  } catch {
    return [];
  }
}

export function explorerResourceRoute(clusterId: string, resource: string, name: string, namespace?: string) {
  return namespace ? {
    name:   'c-cluster-product-resource-namespace-id',
    params: {
      cluster: clusterId, product: 'explorer', resource, namespace, id: name
    },
  } : {
    name:   'c-cluster-product-resource-id',
    params: {
      cluster: clusterId, product: 'explorer', resource, id: name
    },
  };
}

export function explorerCreateRoute(clusterId: string, resource: string) {
  return {
    name:   'c-cluster-product-resource-create',
    params: {
      cluster: clusterId, product: 'explorer', resource
    },
  };
}
