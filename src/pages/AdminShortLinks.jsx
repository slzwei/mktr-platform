import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ConfirmDialog';

export default function AdminShortLinks() {
 const qc = useQueryClient();
 const [search, setSearch] = useState('');
 const [searchKey, setSearchKey] = useState('');
 const [selected, setSelected] = useState(null);
 const [clicks, setClicks] = useState([]);
 const [confirmDialog, setConfirmDialog] = useState({ open: false, title:"", description:"", onConfirm: null, destructive: false });

 const openConfirm = useCallback(({ title, description, onConfirm, destructive = true }) => {
 setConfirmDialog({ open: true, title, description, onConfirm, destructive });
 }, []);

 const closeConfirm = useCallback(() => {
 setConfirmDialog(prev => ({ ...prev, open: false }));
 }, []);

 const { data: shortlinksData, isLoading: loading } = useQuery({
 queryKey: ['shortlinks', searchKey],
 queryFn: async () => {
 const res = await apiClient.get(`/shortlinks?search=${encodeURIComponent(searchKey)}`);
 return res.data;
 },
 });

 const items = shortlinksData?.items || [];
 const total = shortlinksData?.total || 0;

 const load = () => {
 setSearchKey(search);
 };

 const openClicks = async (item) => {
 setSelected(item);
 try {
 const res = await apiClient.get(`/shortlinks/${item.id}/clicks`);
 setClicks(res.data.clicks || []);
 } catch (_) { setClicks([]); }
 };

 const extend90Days = async (item) => {
 const newExpiry = new Date(Date.now() + 90*24*60*60*1000).toISOString();
 await apiClient.patch(`/shortlinks/${item.id}`, { expiresAt: newExpiry });
 qc.invalidateQueries({ queryKey: ['shortlinks'] });
 };

 const remove = (item) => {
 openConfirm({
 title:"Delete Short Link",
 description: `Delete short link /share/${item.slug}? This cannot be undone.`,
 onConfirm: async () => {
 await apiClient.delete(`/shortlinks/${item.id}`);
 if (selected?.id === item.id) setSelected(null);
 qc.invalidateQueries({ queryKey: ['shortlinks'] });
 closeConfirm();
 },
 });
 };

 return (
 <div className="p-6">
 <h1 className="text-2xl font-bold mb-4">Short Links</h1>
 <div className="flex gap-2 mb-4">
 <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search slug..."/>
 <Button onClick={load} disabled={loading}>Search</Button>
 </div>
 <div className="overflow-x-auto border rounded">
 <table className="min-w-full text-sm">
 <thead className="bg-muted">
 <tr>
 <th className="text-left p-2">Slug</th>
 <th className="text-left p-2">Target</th>
 <th className="text-left p-2">Clicks</th>
 <th className="text-left p-2">Expires</th>
 <th className="text-left p-2">Actions</th>
 </tr>
 </thead>
 <tbody>
 {items.map(it => (
 <tr key={it.id} className="border-t">
 <td className="p-2"><a className="text-primary hover:underline" href={`/share/${it.slug}`} target="_blank" rel="noreferrer">{it.slug}</a></td>
 <td className="p-2 break-all">{it.targetUrl}</td>
 <td className="p-2">{it.clickCount}</td>
 <td className="p-2">{it.expiresAt ? new Date(it.expiresAt).toLocaleString() : '—'}</td>
 <td className="p-2 flex gap-2">
 <Button variant="outline" onClick={() => openClicks(it)}>Clicks</Button>
 <Button onClick={() => extend90Days(it)}>Extend +90d</Button>
 <Button variant="destructive" onClick={() => remove(it)}>Delete</Button>
 </td>
 </tr>
 ))}
 {items.length === 0 && (
 <tr><td className="p-4 text-center text-muted-foreground" colSpan={5}>{loading ? 'Loading…' : 'No results'}</td></tr>
 )}
 </tbody>
 </table>
 </div>

 <ConfirmDialog
 open={confirmDialog.open}
 onOpenChange={(open) => { if (!open) closeConfirm(); }}
 title={confirmDialog.title}
 description={confirmDialog.description}
 onConfirm={confirmDialog.onConfirm}
 confirmText="Delete" destructive={confirmDialog.destructive}
 />

 {selected && (
 <div className="mt-6">
 <h2 className="font-semibold mb-2">Recent clicks for /share/{selected.slug}</h2>
 <div className="overflow-x-auto border rounded">
 <table className="min-w-full text-sm">
 <thead className="bg-muted">
 <tr>
 <th className="text-left p-2">Time</th>
 <th className="text-left p-2">Device</th>
 <th className="text-left p-2">UA</th>
 <th className="text-left p-2">Referer</th>
 </tr>
 </thead>
 <tbody>
 {clicks.map(c => (
 <tr key={c.id} className="border-t">
 <td className="p-2">{new Date(c.ts).toLocaleString()}</td>
 <td className="p-2">{c.device || '—'}</td>
 <td className="p-2 break-all">{(c.ua || '').slice(0, 140)}</td>
 <td className="p-2 break-all">{c.referer || '—'}</td>
 </tr>
 ))}
 {clicks.length === 0 && (
 <tr><td className="p-4 text-center text-muted-foreground" colSpan={4}>No clicks</td></tr>
 )}
 </tbody>
 </table>
 </div>
 </div>
 )}
 </div>
 );
}


