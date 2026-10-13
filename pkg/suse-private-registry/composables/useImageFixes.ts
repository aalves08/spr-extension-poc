import { Store } from 'vuex';
import { Connection } from '../types/connection';
import { HarborProxyCache } from '../types/harbor';
import { ContainerImage, podSpecOf } from './useImageMatching';
import { parseImageRef, proxyImage } from '../utils/image-ref';

export interface ImageFixCandidate {
  label: string;
  image: string;
}

export interface ProxyCandidate {
  connection: Connection;
  proxy: HarborProxyCache;
  image: string;
}

/**
 * Digest the container is actually running, to pin its image to. Only when the pod's resolved image is the same
 * repository as the spec image (not a mirror) and the spec isn't pinned already.
 */
export function pinnableDigest(image: ContainerImage): string | undefined {
  const spec = parseImageRef(image.image);
  const running = parseImageRef(image.imageID);

  if (!spec || spec.digest || !running?.digest || running.host !== spec.host || running.path !== spec.path) {
    return undefined;
  }

  return running.digest;
}

/** Proxy-cache projects (in any connected SPR) whose upstream serves this external image */
export function proxyCandidates(image: ContainerImage, caches: { connection: Connection; proxies: HarborProxyCache[] }[]): ProxyCandidate[] {
  const ref = parseImageRef(image.image);

  if (!ref) {
    return [];
  }

  return caches.flatMap(({ connection, proxies }) => proxies
    .filter((p) => p.host === ref.host)
    .map((proxy) => ({
      connection, proxy, image: proxyImage(ref, connection.host, proxy.project)
    })));
}

/**
 * Set a container's image on the workload (pod template). Saving triggers a rollout.
 */
export async function updateContainerImage(store: Store<any>, resource: any, container: { container: string; init: boolean }, image: string): Promise<void> {
  const clone = await store.dispatch('cluster/clone', { resource });
  const spec = podSpecOf(clone);
  const list: any[] = (container.init ? spec?.initContainers : spec?.containers) || [];
  const target = list.find((c) => c.name === container.container);

  if (!target) {
    throw new Error(`Container ${ container.container } not found`);
  }

  target.image = image;
  await clone.save();
}
