import { useShell } from '@shell/apis';
import { Connection } from '../types/connection';
import { HarborArtifact } from '../types/harbor';
import DeployImageDialog from '../components/DeployImageDialog.vue';
import CveExposureDialog from '../components/CveExposureDialog.vue';
import PackageSearchDialog from '../components/PackageSearchDialog.vue';

/**
 * Rancher-side actions on SPR content. They write to Kubernetes only, never to SPR. Must be called from `setup()`.
 */
export function useSprActions() {
  const shell = useShell();

  function deployImage(props: { connection: Connection; project: string; repo: string; artifact: HarborArtifact }) {
    shell.modal.open(DeployImageDialog, {
      props, width: '700px', closeOnClickOutside: false
    });
  }

  function cveExposure(props: { connection: Connection; cveId: string; knownDigests?: string[] }) {
    shell.modal.open(CveExposureDialog, { props, width: '960px' });
  }

  function packageSearch(props: { connection: Connection; packageName?: string; packageVersion?: string }) {
    shell.modal.open(PackageSearchDialog, { props, width: '1000px' });
  }

  return {
    deployImage, cveExposure, packageSearch
  };
}
