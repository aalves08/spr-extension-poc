import { reactive } from 'vue';
import { CONNECTION_STATE, Connection, ConnectionState } from '../types/connection';
import { HARBOR_ERROR, HarborErrorKind, HarborSystemInfo } from '../types/harbor';
import { HarborError, invalidateHarborCache, normaliseHarborError, useHarbor } from './useHarbor';

export interface ProbeResult {
  state: ConnectionState;
  systemInfo?: HarborSystemInfo;
  robot?: boolean;
  error?: HarborError;
  at: number;
}

const ERROR_TO_STATE: Record<HarborErrorKind, ConnectionState> = {
  [HARBOR_ERROR.UNAUTHORIZED]:      CONNECTION_STATE.AUTH_FAILED,
  [HARBOR_ERROR.FORBIDDEN]:         CONNECTION_STATE.FORBIDDEN,
  [HARBOR_ERROR.NOT_FOUND]:         CONNECTION_STATE.NOT_FOUND,
  [HARBOR_ERROR.PROXY_NOT_ALLOWED]: CONNECTION_STATE.PROXY_NOT_ALLOWED,
  [HARBOR_ERROR.TLS]:               CONNECTION_STATE.TLS,
  [HARBOR_ERROR.UNREACHABLE]:       CONNECTION_STATE.UNREACHABLE,
  [HARBOR_ERROR.UNKNOWN]:           CONNECTION_STATE.UNKNOWN,
};

export function stateForError(e: any): ConnectionState {
  return ERROR_TO_STATE[normaliseHarborError(e).kind];
}

// Shared across pages, keyed by connection id + Secret resourceVersion (so edits re-probe)
const results = reactive<Record<string, ProbeResult>>({});
const inflight = new Map<string, Promise<ProbeResult>>();

function keyFor(connection: Connection): string {
  return `${ connection.id }@${ connection.secret?.metadata?.resourceVersion || '' }`;
}

/**
 * Probe connections: systeminfo + credential check through the signed proxy.
 */
export function useConnectionProbe() {
  const { clientFor } = useHarbor();

  function resultFor(connection: Connection): ProbeResult | undefined {
    return results[keyFor(connection)];
  }

  async function probe(connection: Connection, opts: { force?: boolean; allowed?: boolean } = {}): Promise<ProbeResult> {
    const key = keyFor(connection);
    const cached = results[key];
    // A "not allowed" result goes stale as soon as the host is allowed
    const staleNotAllowed = cached?.state === CONNECTION_STATE.PROXY_NOT_ALLOWED && opts.allowed !== false;

    if (!opts.force && cached && !staleNotAllowed) {
      return cached;
    }

    if (opts.allowed === false) {
      const res: ProbeResult = { state: CONNECTION_STATE.PROXY_NOT_ALLOWED, at: Date.now() };

      results[key] = res;

      return res;
    }

    if (!opts.force && inflight.has(key)) {
      return inflight.get(key) as Promise<ProbeResult>;
    }

    if (opts.force) {
      invalidateHarborCache(connection.id);
    }

    const client = clientFor(connection);
    const promise = (async(): Promise<ProbeResult> => {
      try {
        const [systemInfo, creds] = await Promise.all([
          client.systemInfo({ force: opts.force }),
          client.validateCredentials(),
        ]);

        return {
          state: CONNECTION_STATE.CONNECTED, systemInfo, robot: creds.robot, at: Date.now()
        };
      } catch (e) {
        const error = normaliseHarborError(e);

        return {
          state: ERROR_TO_STATE[error.kind], error, at: Date.now()
        };
      }
    })();

    inflight.set(key, promise);

    try {
      const res = await promise;

      results[key] = res;

      return res;
    } finally {
      inflight.delete(key);
    }
  }

  return { probe, resultFor };
}

export const STATE_BG: Record<ConnectionState, string> = {
  [CONNECTION_STATE.CONNECTED]:         'bg-success',
  [CONNECTION_STATE.AUTH_FAILED]:       'bg-error',
  [CONNECTION_STATE.FORBIDDEN]:         'bg-warning',
  [CONNECTION_STATE.UNREACHABLE]:       'bg-error',
  [CONNECTION_STATE.TLS]:               'bg-error',
  [CONNECTION_STATE.PROXY_NOT_ALLOWED]: 'bg-warning',
  [CONNECTION_STATE.NOT_FOUND]:         'bg-error',
  [CONNECTION_STATE.UNKNOWN]:           'bg-darker',
};
