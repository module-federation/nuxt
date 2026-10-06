const MF_REMOTE_ENTRY_ID = "virtual:mf-REMOTE_ENTRY_ID:";
export const MF_REMOTE_ENTRY_SSR_ID = "virtual:mf-REMOTE_ENTRY_SSR_ID";
const MF_EXPOSES_SSR_ID = "virtual:mf-exposes-ssr:";
const MF_SSR_PATH_SEGMENT = "/__mf_ssr__/";

export function isMfRemoteEntryImporter(importer?: string) {
  return normalizeMfImporter(importer)?.startsWith(MF_REMOTE_ENTRY_ID) ?? false;
}

export function isMfSsrRemoteEntryImporter(importer?: string) {
  const normalized = normalizeMfImporter(importer);
  if (!normalized) return false;

  // Virtual ids are prefixes once normalized; the SSR path segment can follow
  // an absolute path or origin, so it is matched anywhere.
  return (
    normalized.startsWith(MF_REMOTE_ENTRY_SSR_ID) ||
    normalized.startsWith(MF_EXPOSES_SSR_ID) ||
    normalized.includes(MF_SSR_PATH_SEGMENT)
  );
}

function normalizeMfImporter(importer?: string) {
  if (!importer) return;

  return importer
    .replace(/^\/@id\//, "")
    .replace(/^__x00__/, "")
    .replace(/^\0/, "");
}
