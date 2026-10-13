import {
  computed, onBeforeUnmount, reactive, ref, Ref, watch
} from 'vue';
import { useStore } from 'vuex';
import { useShell } from '@shell/apis';
import { NotificationLevel } from '@shell/types/notifications';
import { Connection } from '../types/connection';
import {
  HARBOR_ERROR, HarborArtifact, SCAN_STATUS, SCAN_TYPE, ScanType
} from '../types/harbor';
import { isScanActive, isScannable } from '../utils/artifact';
import { normaliseHarborError, useHarbor } from './useHarbor';
import { useSprI18n } from './useSprI18n';

const POLL_MS = 5000;
// The overview can lag behind the 202 for a moment, keep polling a bit even if nothing shows as running yet
const START_GRACE_MS = 15000;

const PERMISSION_RESOURCE: Record<ScanType, string> = {
  [SCAN_TYPE.VULNERABILITY]: 'scan',
  [SCAN_TYPE.SBOM]:          'sbom',
};

const KNOWN_STATUSES: string[] = Object.values(SCAN_STATUS);

// Per connection version + project. `undefined` = couldn't check (e.g. robot accounts), so actions stay available.
const permissionCache = new Map<string, Promise<Set<string> | undefined>>();

/**
 * Start / stop vulnerability scans and SBOM generation for artifacts of one repository,
 * and poll while any of them is running (also picks up scans started elsewhere, e.g. scan on push).
 */
export function useArtifactScans(opts: {
  connection: Ref<Connection | undefined>;
  project: Ref<string>;
  repo: Ref<string>;
  artifacts: Ref<HarborArtifact[]>;
  /** Re-fetch the artifacts without a loading state */
  reload: () => Promise<void>;
}) {
  const store = useStore();
  const { t } = useSprI18n(store);
  const shell = useShell();
  const { clientFor } = useHarbor();

  const permissions: Ref<Set<string> | undefined> = ref();
  const permissionsLoaded = ref(false);
  const projectId = computed(() => opts.artifacts.value[0]?.project_id);
  const permissionKey = computed(() => {
    const c = opts.connection.value;

    return c && projectId.value ? `${ c.id }@${ c.secret?.metadata?.resourceVersion || '' }|${ projectId.value }` : '';
  });

  watch(permissionKey, async(key) => {
    permissionsLoaded.value = false;
    permissions.value = undefined;

    if (!key || !opts.connection.value || !projectId.value) {
      return;
    }

    if (!permissionCache.has(key)) {
      permissionCache.set(key, clientFor(opts.connection.value).projectPermissions(projectId.value).catch(() => undefined));
    }

    const result = await permissionCache.get(key);

    if (key === permissionKey.value) {
      permissions.value = result;
      permissionsLoaded.value = true;
    }
  }, { immediate: true });

  function allowed(type: ScanType, action: 'create' | 'stop'): boolean {
    return permissionsLoaded.value && (!permissions.value || permissions.value.has(`${ PERMISSION_RESOURCE[type] }:${ action }`));
  }

  const canStart = (type: ScanType) => allowed(type, 'create');
  const canStop = (type: ScanType) => allowed(type, 'stop');

  // ---- Polling ------------------------------------------------------------------------------------------------------

  let timer: ReturnType<typeof setTimeout> | undefined;
  let graceUntil = 0;

  const anyActive = computed(() => opts.artifacts.value.some((a) => isScanActive(a, SCAN_TYPE.VULNERABILITY) || isScanActive(a, SCAN_TYPE.SBOM)));

  function schedule() {
    clearTimeout(timer);
    timer = undefined;

    if (anyActive.value || Date.now() < graceUntil) {
      timer = setTimeout(async() => {
        timer = undefined;
        await opts.reload();
        schedule();
      }, POLL_MS);
    }
  }

  watch(anyActive, schedule, { immediate: true });
  onBeforeUnmount(() => {
    clearTimeout(timer);
    graceUntil = 0;
  });

  // ---- Actions ------------------------------------------------------------------------------------------------------

  /** `<digest>|<type>` while the start/stop request is in flight */
  const busy = reactive<Record<string, boolean>>({});
  const busyKey = (a: HarborArtifact, type: ScanType) => `${ a.digest }|${ type }`;
  const isBusy = (a: HarborArtifact, type: ScanType) => !!busy[busyKey(a, type)];

  function notifyFailures(titleKey: string, errors: unknown[]) {
    if (!errors.length) {
      return;
    }

    const normalised = errors.map((e) => normaliseHarborError(e));
    const message = normalised.some((e) => e.kind === HARBOR_ERROR.FORBIDDEN || e.kind === HARBOR_ERROR.UNAUTHORIZED) ? t('spr.scan.forbidden') : [...new Set(normalised.map((e) => e.message).filter(Boolean))].join(', ');

    shell.notification.send(NotificationLevel.Error, t(titleKey, { count: errors.length }), message);
  }

  async function run(type: ScanType, artifacts: HarborArtifact[], action: 'start' | 'stop'): Promise<boolean> {
    const connection = opts.connection.value;
    const targets = artifacts.filter((a) => isScannable(a) && (action === 'stop' ? isScanActive(a, type) : !isScanActive(a, type)));

    if (!connection || !targets.length) {
      return false;
    }

    const client = clientFor(connection);

    targets.forEach((a) => {
      busy[busyKey(a, type)] = true;
    });

    const results = await Promise.allSettled(targets.map((a) => (action === 'stop' ? client.stopScan(opts.project.value, opts.repo.value, a.digest, type) : client.scan(opts.project.value, opts.repo.value, a.digest, type))
    ));

    targets.forEach((a) => {
      delete busy[busyKey(a, type)];
    });

    const errors = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => r.reason);
    const sbom = type === SCAN_TYPE.SBOM;

    notifyFailures(action === 'stop' ? 'spr.scan.stopFailed' : (sbom ? 'spr.scan.sbomFailed' : 'spr.scan.scanFailed'), errors);

    if (action === 'start' && errors.length < targets.length) {
      graceUntil = Date.now() + START_GRACE_MS;
    }

    await opts.reload();
    schedule();

    return !errors.length;
  }

  const start = (type: ScanType, artifacts: HarborArtifact[]) => run(type, artifacts, 'start');
  const stop = (type: ScanType, artifacts: HarborArtifact[]) => run(type, artifacts, 'stop');

  function statusLabel(status?: string): string | undefined {
    return status && KNOWN_STATUSES.includes(status) ? t(`spr.scan.statuses.${ status.toLowerCase() }`) : status;
  }

  return {
    canStart, canStop, start, stop, isBusy, statusLabel
  };
}
