const warnings: string[] = [];

const [sourceA, sourceB] = await Promise.all([
  fetchSourceA().catch(() => {
    warnings.push("source A unavailable");
    return [];
  }),
  fetchSourceB().catch(() => {
    warnings.push("source B unavailable");
    return [];
  }),
]);

return {
  sourceA,
  sourceB,
  warnings,
};
