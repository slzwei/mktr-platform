import { Card, CardContent, CardHeader, CardTitle } from"@/components/ui/card";
import { Button } from"@/components/ui/button";
import { Badge } from"@/components/ui/badge";
import { Input } from"@/components/ui/input";
import {
 Table,
 TableBody,
 TableCell,
 TableHead,
 TableHeader,
 TableRow,
} from"@/components/ui/table";
import QrCode from"lucide-react/icons/qr-code";
import { format, parseISO } from"date-fns";

export default function CampaignSelector({ campaigns, search, onSearchChange, onSelect }) {
 const filtered = (campaigns || []).filter((c) => {
 const q = search.trim().toLowerCase();
 if (!q) return true;
 return (
 c.name?.toLowerCase().includes(q) ||
 (c.status || (c.is_active ? 'active' : 'inactive'))?.toString().toLowerCase().includes(q)
 );
 });

 return (
 <Card className="shadow-lg">
 <CardHeader>
 <div className="flex items-center justify-between gap-4">
 <CardTitle className="flex items-center gap-2">
 <QrCode className="w-6 h-6"/>
 Select Campaign
 </CardTitle>
 <div className="w-full max-w-sm">
 <Input value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder="Search campaigns..."/>
 </div>
 </div>
 </CardHeader>
 <CardContent className="p-0">
 <div className="overflow-x-auto">
 <Table>
 <TableHeader>
 <TableRow className="bg-muted">
 <TableHead>Campaign Name</TableHead>
 <TableHead>Status</TableHead>
 <TableHead>Duration</TableHead>
 <TableHead>Age Range</TableHead>
 <TableHead>Actions</TableHead>
 </TableRow>
 </TableHeader>
 <TableBody>
 {filtered.length === 0 ? (
 <TableRow>
 <TableCell colSpan="5" className="text-center py-8 text-muted-foreground">
 {search ? `"${search}"is not found` : 'No campaigns found.'}
 </TableCell>
 </TableRow>
 ) : filtered.map((campaign) => (
 <TableRow key={campaign.id} className="hover:bg-muted">
 <TableCell className="font-semibold">{campaign.name}</TableCell>
 <TableCell>
 <Badge
 variant={campaign.is_active ?"default":"outline"}
 className={campaign.is_active ?"bg-success/15 text-success":"bg-destructive/15 text-destructive"}
 >
 {campaign.is_active ?"Active":"Inactive"}
 </Badge>
 </TableCell>
 <TableCell>
 {campaign.start_date ? format(parseISO(campaign.start_date),"dd MMM yyyy") : '-'} - {campaign.end_date ? format(parseISO(campaign.end_date),"dd MMM yyyy") : '-'}
 </TableCell>
 <TableCell>
 {campaign.min_age} - {campaign.max_age || 'Any'}
 </TableCell>
 <TableCell>
 <Button onClick={() => onSelect(campaign)} disabled={!campaign.is_active} className="bg-primary hover:bg-primary/90">
 <QrCode className="w-4 h-4 mr-2"/>
 Manage QR Codes
 </Button>
 </TableCell>
 </TableRow>
 ))}
 </TableBody>
 </Table>
 </div>
 </CardContent>
 </Card>
 );
}
