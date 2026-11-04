/** Module layering and information firewall — see docs/architecture/02-application-architecture.md §2.2 */
const L0 = '^src/(core|geo|rules)/';
const L1 = '^src/(population|parties|politicians|institutions|economy)/';
const L2 = '^src/(events|campaigns|careers|government)/';
const L3 = '^src/(calendar|primaries|elections|electorate|ballots|counting)/';
const L4 = '^src/(polling|forecasting|projections|broadcast)/';
const L5 = '^src/(archive|analytics)/';
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', comment: 'Runtime cycles only: a type-only back-reference (an engine part naming its host type) is erased at compile time', from: {}, to: { circular: true, viaOnly: { dependencyTypesNot: ['type-only'] } } },
    { name: 'L0-up', severity: 'error', from: { path: L0 }, to: { path: `${L1}|${L2}|${L3}|${L4}|${L5}|^src/(persistence|engine|ui|workers)/` } },
    { name: 'L1-up', severity: 'error', from: { path: L1 }, to: { path: `${L2}|${L3}|${L4}|${L5}|^src/(persistence|engine|ui|workers)/` } },
    { name: 'L2-up', severity: 'error', from: { path: L2 }, to: { path: `${L3}|${L4}|${L5}|^src/(persistence|engine|ui|workers)/` } },
    { name: 'L3-up', severity: 'error', from: { path: L3 }, to: { path: `${L4}|${L5}|^src/(persistence|engine|ui|workers)/` } },
    { name: 'L4-up', severity: 'error', from: { path: L4 }, to: { path: `${L5}|^src/(persistence|engine|ui|workers)/` } },
    { name: 'firewall', severity: 'error', comment: 'Observers read only the Public Record',
      from: { path: L4 }, to: { path: '^src/(ballots)/|^src/electorate/(?!measure)' } },
    { name: 'sqlite-only-in-persistence', severity: 'error', from: { pathNot: '^src/(persistence|workers)/' }, to: { path: '@sqlite\\.org/sqlite-wasm' } },
    { name: 'ui-talks-to-engine-api-only', severity: 'error', from: { path: '^src/ui/' },
      to: { path: '^src/', pathNot: '^src/(ui|core|engine/api|engine/protocol)' } },
  ],
  options: { doNotFollow: { path: 'node_modules' }, tsPreCompilationDeps: true, tsConfig: { fileName: 'tsconfig.json' } },
};
