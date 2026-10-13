export const JOB_STATUS = {
  SUCCESS:   'success',
  ERROR:     'error',
  RUNNING:   'running',
  PENDING:   'pending',
  SCHEDULED: 'scheduled',
  STOPPED:   'stopped',
  UNKNOWN:   'unknown',
} as const;

export type JobStatus = typeof JOB_STATUS[keyof typeof JOB_STATUS];

/**
 * Harbor uses different words per job type (GC `Success`, replication `Succeed`/`InProgress`, scanner `healthy`...).
 */
export function normaliseJobStatus(status?: string): JobStatus {
  switch ((status || '').toLowerCase()) {
  case 'success':
  case 'succeed':
  case 'healthy':
    return JOB_STATUS.SUCCESS;
  case 'error':
  case 'failed':
  case 'unhealthy':
    return JOB_STATUS.ERROR;
  case 'running':
  case 'inprogress':
    return JOB_STATUS.RUNNING;
  case 'pending':
    return JOB_STATUS.PENDING;
  case 'scheduled':
    return JOB_STATUS.SCHEDULED;
  case 'stopped':
    return JOB_STATUS.STOPPED;
  default:
    return JOB_STATUS.UNKNOWN;
  }
}
