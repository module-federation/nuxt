const MF_REMOTE_ENTRY_ID = "virtual:mf-REMOTE_ENTRY_ID:";

export function isMfRemoteEntryImporter(importer?: string) {
  if (!importer) return false;

  const normalized = importer
    .replace(/^\/@id\//, "")
    .replace(/^__x00__/, "")
    .replace(/^\0/, "");
  return normalized.startsWith(MF_REMOTE_ENTRY_ID);
}
