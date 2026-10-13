export interface Connection {
  /** Secret name, also used as the connection id in routes (`?registry=`) */
  id: string;
  displayName: string;
  /** Base URL, e.g. https://spr.example.com */
  url: string;
  host: string;
  username: string;
  linkedCluster?: string;
  linkedNamespace?: string;
  linkedApp?: string;
  creationTimestamp?: string;
  /** Credential id used by the proxy signer: `cattle-global-data:<name>` */
  credentialId: string;
  /** The underlying Secret model */
  secret: any;
}

export interface ConnectionInput {
  displayName: string;
  url: string;
  username: string;
  /** Empty on edit means "keep the existing password" */
  password: string;
  linkedCluster?: string;
  linkedNamespace?: string;
  linkedApp?: string;
}

export const CONNECTION_STATE = {
  CONNECTED:         'connected',
  AUTH_FAILED:       'authFailed',
  FORBIDDEN:         'forbidden',
  UNREACHABLE:       'unreachable',
  TLS:               'tls',
  PROXY_NOT_ALLOWED: 'proxyNotAllowed',
  NOT_FOUND:         'notFound',
  UNKNOWN:           'unknown',
} as const;

export type ConnectionState = typeof CONNECTION_STATE[keyof typeof CONNECTION_STATE];

export interface SprInstall {
  clusterId: string;
  clusterName: string;
  namespace: string;
  releaseName: string;
  chartVersion?: string;
  appVersion?: string;
  externalUrl?: string;
}
