import { useI18n } from '@shell/composables/useI18n';

/**
 * The shell's `t()` HTML-escapes its output (`&`, `<`, `>`, `"`, `'`). Vue text interpolation, prop bindings and
 * `Banner` (`nlToBr`) escape again, so `Apps > Charts` showed as `Apps &gt; Charts`. Return the raw string instead.
 * Never pass the result to `v-html`.
 */
export function useSprI18n(store: Parameters<typeof useI18n>[0]) {
  const { t } = useI18n(store);

  return { t: (key: string, args?: unknown): string => t(key, args, true) };
}
