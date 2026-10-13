export interface ImageRef {
  /** Registry host, lower-cased, default port stripped */
  host: string;
  /** Repository path without host, e.g. `library/nginx` */
  path: string;
  tag?: string;
  digest?: string;
}

const DOCKER_HUB = 'docker.io';
const RUNTIME_PREFIXES = /^[a-z-]+:\/\//; // docker-pullable://, docker://, containerd://

/**
 * Normalise a host so it can be compared against a connection URL host:
 * lower-case, drop default ports and Docker Hub aliases.
 */
export function normaliseHost(host: string): string {
  let out = host.toLowerCase();

  if (out.endsWith(':443')) {
    out = out.substring(0, out.length - 4);
  }

  if (out === 'index.docker.io' || out === 'registry-1.docker.io') {
    out = DOCKER_HUB;
  }

  return out;
}

/**
 * Parse an image reference (`spec.containers[].image`) or a resolved image id
 * (`status.containerStatuses[].imageID`), e.g.
 * - `nginx` -> docker.io/library/nginx:latest
 * - `spr.example.com/team/app:1.0`
 * - `docker-pullable://spr.example.com/team/app@sha256:abc...`
 * - `sha256:abc...` (no repository, returns undefined)
 */
export function parseImageRef(raw?: string): ImageRef | undefined {
  if (!raw) {
    return undefined;
  }

  let ref = raw.trim().replace(RUNTIME_PREFIXES, '');

  if (!ref || ref.startsWith('sha256:')) {
    return undefined;
  }

  let digest: string | undefined;
  const at = ref.indexOf('@');

  if (at >= 0) {
    digest = ref.substring(at + 1);
    ref = ref.substring(0, at);
  }

  let tag: string | undefined;
  const lastSlash = ref.lastIndexOf('/');
  const lastColon = ref.lastIndexOf(':');

  if (lastColon > lastSlash) {
    tag = ref.substring(lastColon + 1);
    ref = ref.substring(0, lastColon);
  }

  const parts = ref.split('/');
  let host = DOCKER_HUB;

  // The first segment is a host if it looks like one (has a dot or port, or is localhost)
  if (parts.length > 1 && (parts[0].includes('.') || parts[0].includes(':') || parts[0] === 'localhost')) {
    host = parts.shift() as string;
  }

  let path = parts.join('/');

  if (normaliseHost(host) === DOCKER_HUB && !path.includes('/')) {
    path = `library/${ path }`;
  }

  if (!tag && !digest) {
    tag = 'latest';
  }

  return {
    host: normaliseHost(host),
    path,
    tag,
    digest,
  };
}

/**
 * Split a Harbor image path into project + repository (`team/a/b` -> `team`, `a/b`).
 */
export function splitProjectRepo(path: string): { project: string; repo: string } | undefined {
  const idx = path.indexOf('/');

  if (idx <= 0 || idx === path.length - 1) {
    return undefined;
  }

  return { project: path.substring(0, idx), repo: path.substring(idx + 1) };
}

export function shortDigest(digest?: string): string {
  if (!digest) {
    return '';
  }

  const [, hex] = digest.split(':');

  return hex ? `${ digest.split(':')[0] }:${ hex.substring(0, 12) }` : digest.substring(0, 19);
}

export function hostFromUrl(url: string): string {
  try {
    return normaliseHost(new URL(url).host);
  } catch {
    return '';
  }
}

/** Image reference string; keeps the tag next to a digest for readability (`repo:tag@sha256:...`) */
export function formatImageRef(ref: ImageRef): string {
  return `${ ref.host }/${ ref.path }${ ref.tag ? `:${ ref.tag }` : '' }${ ref.digest ? `@${ ref.digest }` : '' }`;
}

/** `image` pinned to `digest`, keeping the image as written (short Docker Hub names stay short) */
export function pinImage(image: string, digest: string): string {
  const at = image.indexOf('@');

  return `${ at >= 0 ? image.substring(0, at) : image }@${ digest }`;
}

/**
 * Same image pulled through a Harbor proxy-cache project: `<spr-host>/<project>/<upstream path>`.
 * Docker Hub official images keep their `library/` prefix, as Harbor expects.
 */
export function proxyImage(ref: ImageRef, sprHost: string, project: string): string {
  return formatImageRef({
    ...ref, host: sprHost, path: `${ project }/${ ref.path }`
  });
}

/** Image host served by a Harbor registry endpoint (the Docker Hub endpoint URL is `https://hub.docker.com`) */
export function registryImageHost(registry: { type?: string; url?: string }): string {
  return registry.type === 'docker-hub' ? DOCKER_HUB : hostFromUrl(registry.url || '');
}
