/**
 * Minimal migration smoke endpoint. Database-backed endpoints are migrated
 * incrementally after the schema is deployed; this endpoint stays read-only.
 */
export default async function healthEndpoint() {
  return { ok: true, service: 'tgzhushou-serverless' };
}
