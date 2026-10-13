import { HarborNativeReportSummary } from '../types/harbor';
import { HARBOR_VULN_ACCEPT } from '../config/constants';

export const SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Unknown'] as const;

export type Severity = typeof SEVERITIES[number];

export function normaliseSeverity(severity?: string): string {
  if (!severity) {
    return 'Unknown';
  }

  const lower = severity.toLowerCase();

  return lower.charAt(0).toUpperCase() + lower.substring(1);
}

export function severityRank(severity?: string): number {
  const idx = (SEVERITIES as readonly string[]).indexOf(normaliseSeverity(severity));

  return idx < 0 ? SEVERITIES.length : idx;
}

/**
 * `scan_overview` is keyed by report MIME type. Return the first report (there is one per accepted MIME type).
 */
export function firstScanReport(scanOverview?: Record<string, HarborNativeReportSummary>): HarborNativeReportSummary | undefined {
  if (!scanOverview) {
    return undefined;
  }

  const preferred = HARBOR_VULN_ACCEPT.split(',').map((m) => m.trim());

  for (const mime of preferred) {
    if (scanOverview[mime]) {
      return scanOverview[mime];
    }
  }

  return Object.values(scanOverview)[0];
}
