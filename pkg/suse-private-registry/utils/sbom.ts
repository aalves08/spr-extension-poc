export interface SbomPackage {
  name: string;
  version?: string;
  /** Source package (SPDX `sourceInfo`), e.g. `xz-utils` for `liblzma5` */
  source?: string;
}

// Trivy writes `built package from: <source> <version>`
const SOURCE_INFO = /^built package from:\s*(\S+)/;

/**
 * Packages of an SBOM document. Handles SPDX JSON (what SPR's Trivy generates) and CycloneDX JSON.
 * The image itself (SPDX `CONTAINER` package) is left out.
 */
export function sbomPackages(doc: any): SbomPackage[] {
  if (Array.isArray(doc?.packages)) {
    return doc.packages
      .filter((p: any) => p?.name && p.primaryPackagePurpose !== 'CONTAINER')
      .map((p: any) => ({
        name: p.name, version: p.versionInfo, source: p.sourceInfo?.match(SOURCE_INFO)?.[1]
      }));
  }

  if (Array.isArray(doc?.components)) {
    return doc.components
      .filter((c: any) => c?.name && c.type !== 'container')
      .map((c: any) => ({ name: c.name, version: c.version }));
  }

  return [];
}

/**
 * Case-insensitive name match on the package or its source package. `version` matches exactly or as a prefix
 * ending at a separator: `5.6` matches `5.6.0` and `5.6-1`, not `5.60`.
 */
export function packageMatches(pkg: SbomPackage, name: string, version?: string): boolean {
  const wanted = name.trim().toLowerCase();

  if (pkg.name.toLowerCase() !== wanted && pkg.source?.toLowerCase() !== wanted) {
    return false;
  }

  const v = version?.trim();

  if (!v) {
    return true;
  }

  const actual = pkg.version || '';

  return actual === v || (actual.startsWith(v) && /[^0-9a-zA-Z]/.test(actual.charAt(v.length)));
}
