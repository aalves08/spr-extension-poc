/**
 * Static SPR release table, maintained by hand.
 *
 * Source: SUSE Private Registry release notes / SUSE product lifecycle page.
 * Support policy: 6 months full support + 12 months maintenance (18 months total) from GA.
 *
 * `ga` dates are intentionally left empty until confirmed from the lifecycle page; without a date the
 * support status is reported as "unknown" rather than guessed.
 */
export interface SprRelease {
  spr: string;
  /** Harbor major.minor */
  harbor: string;
  /** GA date, ISO format (YYYY-MM-DD) */
  ga?: string;
}

export const SPR_RELEASES: SprRelease[] = [
  { spr: '1.0', harbor: '2.13' },
  { spr: '1.1', harbor: '2.14' },
  { spr: '1.2', harbor: '2.15' },
];

const FULL_SUPPORT_MONTHS = 6;
const TOTAL_SUPPORT_MONTHS = 18;

export const SUPPORT_STATUS = {
  SUPPORTED:   'supported',
  MAINTENANCE: 'maintenance',
  EOL:         'eol',
  UNKNOWN:     'unknown',
} as const;

export type SupportStatus = typeof SUPPORT_STATUS[keyof typeof SUPPORT_STATUS];

/**
 * SPR reports `harbor_version` as `1.1.3-(harbor-2.14.4-150700.1.48)`: SPR version first, Harbor version in brackets.
 * Upstream Harbor reports `v2.13.1-abc123`.
 */
const SPR_HARBOR_VERSION = /^v?(\d+\.\d+\.\d+)-\(harbor-v?(\d+\.\d+\.\d+)/;

/**
 * `1.1.3-(harbor-2.14.4-...)` -> `1.1.3`. Undefined for upstream Harbor.
 */
export function sprVersionFromHarborVersion(harborVersion?: string): string | undefined {
  return harborVersion?.match(SPR_HARBOR_VERSION)?.[1];
}

/**
 * `1.1.3-(harbor-2.14.4-...)` -> `2.14.4`; anything else is returned as is.
 */
export function harborVersionLabel(harborVersion?: string): string | undefined {
  return harborVersion?.match(SPR_HARBOR_VERSION)?.[2] || harborVersion;
}

/**
 * `v2.13.1-abc123` -> `2.13`, `1.1.3-(harbor-2.14.4-...)` -> `2.14`
 */
export function harborMajorMinor(harborVersion?: string): string | undefined {
  const match = harborVersionLabel(harborVersion)?.match(/(\d+)\.(\d+)/);

  return match ? `${ match[1] }.${ match[2] }` : undefined;
}

export function sprReleaseForHarbor(harborVersion?: string): SprRelease | undefined {
  const mm = harborMajorMinor(harborVersion);

  return mm ? SPR_RELEASES.find((r) => r.harbor === mm) : undefined;
}

export function sprReleaseForVersion(sprVersion?: string): SprRelease | undefined {
  const match = sprVersion?.match(/(\d+)\.(\d+)/);

  return match ? SPR_RELEASES.find((r) => r.spr === `${ match[1] }.${ match[2] }`) : undefined;
}

function addMonths(date: Date, months: number): Date {
  const out = new Date(date.getTime());

  out.setMonth(out.getMonth() + months);

  return out;
}

export function supportStatus(release?: SprRelease, now = new Date()): SupportStatus {
  if (!release?.ga) {
    return SUPPORT_STATUS.UNKNOWN;
  }

  const ga = new Date(release.ga);

  if (Number.isNaN(ga.getTime())) {
    return SUPPORT_STATUS.UNKNOWN;
  }

  if (now < addMonths(ga, FULL_SUPPORT_MONTHS)) {
    return SUPPORT_STATUS.SUPPORTED;
  }

  if (now < addMonths(ga, TOTAL_SUPPORT_MONTHS)) {
    return SUPPORT_STATUS.MAINTENANCE;
  }

  return SUPPORT_STATUS.EOL;
}
