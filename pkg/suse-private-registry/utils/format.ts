import { formatSi } from '@shell/utils/units';

export function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) {
    return '';
  }

  return formatSi(bytes, { increment: 1024, suffix: 'iB' });
}

/**
 * Deep links into the SPR (Harbor) portal. Read-only extension: anything that changes data happens there.
 */
export const portalUrl = {
  home:          (base: string) => `${ base }/harbor/projects`,
  project:       (base: string, projectId: number) => `${ base }/harbor/projects/${ projectId }/repositories`,
  /** Project configuration tab (security policies) */
  projectConfig: (base: string, projectId: number) => `${ base }/harbor/projects/${ projectId }/configs`,
  repository:    (base: string, projectId: number, repo: string) => `${ base }/harbor/projects/${ projectId }/repositories/${ encodeURIComponent(repo) }`,
  artifact:      (base: string, projectId: number, repo: string, digest: string) => `${ base }/harbor/projects/${ projectId }/repositories/${ encodeURIComponent(repo) }/artifacts-tab/artifacts/${ digest }`,
};

/** `team/app` + tag/digest -> pull command */
export function pullCommand(host: string, project: string, repo: string, tag?: string, digest?: string): string {
  const ref = tag ? `:${ tag }` : `@${ digest }`;

  return `docker pull ${ host }/${ project }/${ repo }${ ref }`;
}

export function durationSeconds(start?: string, end?: string): number | undefined {
  if (!start || !end) {
    return undefined;
  }

  const ms = new Date(end).getTime() - new Date(start).getTime();

  return Number.isNaN(ms) || ms < 0 ? undefined : Math.round(ms / 1000);
}
