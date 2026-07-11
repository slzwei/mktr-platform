import { useQuery } from '@tanstack/react-query';
import { redeemOpsApi } from '@/api/redeemOps';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

const NONE = '__none__';

/**
 * Admin-managed category picker (GET /redeem-ops/categories — settings.manage
 * holders curate the list under /redeem-ops/settings).
 *
 * `value` is the raw category string ('' = none); `onChange` receives the new
 * string. A current value missing from the active list (retired, or legacy
 * casing) stays selectable as an extra option so edit forms round-trip without
 * tripping the backend validator's unknown-category 422.
 */
export default function CategorySelect({ value, onChange, placeholder = 'Select category', id }) {
  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['redeem-ops', 'categories'],
    queryFn: () => redeemOpsApi.listCategories(),
    staleTime: 60_000,
  });

  const names = categories.map((c) => c.name);
  const current = (value || '').trim();
  const hasExact = names.includes(current);
  const hasCaseInsensitive = names.some((n) => n.toLowerCase() === current.toLowerCase());

  return (
    <Select value={current || NONE} onValueChange={(v) => onChange(v === NONE ? '' : v)}>
      <SelectTrigger id={id}>
        <SelectValue placeholder={isLoading ? 'Loading…' : placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No category</SelectItem>
        {current && !hasExact && (
          <SelectItem value={current}>
            {current}{hasCaseInsensitive ? '' : ' (retired)'}
          </SelectItem>
        )}
        {names.map((n) => (
          <SelectItem key={n} value={n}>{n}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
