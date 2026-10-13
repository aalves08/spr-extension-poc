import { base64Encode } from '@shell/utils/crypto';

/**
 * Harbor requires repository names containing `/` to be URL-encoded twice in API paths
 * (`library/nginx` lives in project `library`, repo `nginx`; `team/a/b` -> repo `a/b` -> `a%252Fb`).
 *
 * NOTE: requests go through Rancher's `/meta/proxy`. Whether the proxy decodes the path once more
 * (requiring a third encoding) is not verified yet, so keep all encoding in this one place.
 */
export function encodeRepoName(repoName: string): string {
  return encodeURIComponent(encodeURIComponent(repoName));
}

export function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Harbor's `repository.name` includes the project prefix (`library/nginx`). Strip it for API paths.
 */
export function repoNameWithoutProject(projectName: string, repoName: string): string {
  const prefix = `${ projectName }/`;

  return repoName.startsWith(prefix) ? repoName.substring(prefix.length) : repoName;
}

/**
 * Rancher's `/meta/proxy` signs stored credentials with URL-safe base64 (rancher/rancher `pkg/httpproxy/sign.go`),
 * but Harbor decodes Basic auth with standard base64. Credentials whose standard encoding contains `+` or `/`
 * get a 401 once saved, even though "Test connection" with the typed password works.
 */
export function canRancherSignBasicAuth(username: string, password: string): boolean {
  return !/[+/]/.test(base64Encode(`${ username }:${ password }`));
}
