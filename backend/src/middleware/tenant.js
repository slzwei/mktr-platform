export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000000';

export function getTenantId(req) {
  const jwtTenant = req?.user?.tid;
  const headerTenant = req.get && req.get('x-tenant-id');
  const tid = jwtTenant || headerTenant || DEFAULT_TENANT_ID;
  return String(tid);
}


