export function normalizeEditPayload(edit: any) {
  return {
    targetString: edit?.targetString ?? "",
    replacementString: edit?.replacementString ?? "",
    lineRange: edit?.lineRange,
    beforeContext: edit?.beforeContext,
    afterContext: edit?.afterContext,
    fuzzyMode: edit?.fuzzyMode,
    anchorSearchRange: edit?.anchorSearchRange,
    indexRange: edit?.indexRange,
    normalization: edit?.normalization,
    normalizationConfig: edit?.normalizationConfig,
    expectedHash: edit?.expectedHash,
    contextFuzziness: edit?.contextFuzziness,
    insertMode: edit?.insertMode,
    insertLineRange: edit?.insertLineRange,
    escapeMode: edit?.escapeMode
  };
}
