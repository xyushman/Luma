// Intentional barrel: this package is the single source of truth for API contracts, so one import path is worth the tradeoff AGENTS.md warns about.
// biome-ignore lint/performance/noBarrelFile: shared types barrel required by implementation plan
export * from "./api-responses.js"; // Cross-cutting response envelopes (pagination, errors, health, auth, me).
// biome-ignore lint/performance/noBarrelFile: shared types barrel required by implementation plan
export * from "./audit.js"; // Audit trail and dashboard summary contracts.
// biome-ignore lint/performance/noBarrelFile: shared types barrel required by implementation plan
export * from "./common.js"; // Shared enums and roles used by every other module.
// biome-ignore lint/performance/noBarrelFile: shared types barrel required by implementation plan
export * from "./exception.js"; // Exception, AI recommendation, and reviewer decision contracts.
// biome-ignore lint/performance/noBarrelFile: shared types barrel required by implementation plan
export * from "./loan.js"; // Loan list/detail/patch/verify and query contracts.
// biome-ignore lint/performance/noBarrelFile: shared types barrel required by implementation plan
export * from "./upload.js"; // Upload batch, pipeline progress, and batch summary contracts.
// biome-ignore lint/performance/noBarrelFile: shared types barrel required by implementation plan
export * from "./verified-loan.js"; // Canonical data and verified-record contracts.
