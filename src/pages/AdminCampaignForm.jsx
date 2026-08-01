import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Campaign } from '@/api/entities';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { format, parseISO } from 'date-fns';
import { Calendar as CalendarIcon, ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import CampaignBriefFields, { briefDraftFromCampaign, briefDraftComplete, briefDraftToPayload } from '@/components/campaigns/workspace/CampaignBriefFields';
import CreateScoringBlock from '@/components/adminv2/CreateScoringBlock';

export default function AdminCampaignForm() {
 const { id } = useParams();
 const navigate = useNavigate();
 const [searchParams] = useSearchParams();
 const typeParam = searchParams.get('type');
 const isEditMode = !!id;

 // Default to type param if creating, else lead_generation.
 // If editing, this will be overwritten by loadCampaign data.
 const initialType = typeParam || 'lead_generation';

 const [formData, setFormData] = useState({
 name: '',
 type: initialType,
 min_age: 18,
 max_age: 65,
 start_date: new Date(),
 end_date: new Date(),
 is_active: true,
 });

 const [loading, setLoading] = useState(false);
 const [fetching, setFetching] = useState(isEditMode);
 // Campaign brief — objective + product gate creation (the server 422s without them).
 const [brief, setBrief] = useState(() => briefDraftFromCampaign(null));
 const scoringRef = useRef(null);

 useEffect(() => {
 if (isEditMode) {
 loadCampaign();
 }
 }, [id]);

 const loadCampaign = async () => {
 try {
 const campaign = await Campaign.get(id);
 if (campaign) {
 setBrief(briefDraftFromCampaign(campaign.targetAudience));
 setFormData({
 name: campaign.name || '',
 type: campaign.type || 'lead_generation',
 min_age: campaign.min_age || 18,
 max_age: campaign.max_age || 65,
 start_date: campaign.start_date ? parseISO(campaign.start_date) : new Date(),
 end_date: campaign.end_date ? parseISO(campaign.end_date) : new Date(),
 is_active: campaign.is_active !== undefined ? campaign.is_active : true,
 });
 } else {
 toast.error('Campaign not found');
 navigate('/AdminCampaigns');
 }
 } catch (error) {
 console.error('Failed to load campaign:', error);
 toast.error('Failed to load campaign details');
 } finally {
 setFetching(false);
 }
 };

 const handleChange = (e) => {
 const { name, value } = e.target;
 setFormData((prev) => ({ ...prev, [name]: value }));
 };

 const handleDateChange = (name, date) => {
 setFormData((prev) => ({ ...prev, [name]: date }));
 };

 const handleSwitchChange = (checked) => {
 setFormData((prev) => ({ ...prev, is_active: checked }));
 };

 const handleSubmit = async (e) => {
 e.preventDefault();
 const startDate = formData.start_date;
 const endDate = formData.end_date;
 if (!(startDate instanceof Date) || isNaN(startDate)) {
 toast.error('Please pick a valid start date');
 return;
 }
 if (!(endDate instanceof Date) || isNaN(endDate)) {
 toast.error('Please pick a valid end date');
 return;
 }
 if (endDate < startDate) {
 toast.error('End date must be on or after start date');
 return;
 }
 if (!isEditMode && !briefDraftComplete(brief)) {
 toast.error('Pick the campaign objective and product first');
 return;
 }
 setLoading(true);
 try {
 // Brief included only when both required picks are made — an edit of a
 // pre-brief campaign is never forced to answer (no backfill).
 const briefPayload = briefDraftToPayload(brief);
 const formattedData = {
 ...(briefPayload ? { targetAudience: briefPayload } : {}),
 name: formData.name,
 type: formData.type,
 min_age: formData.min_age,
 max_age: formData.max_age,
 is_active: formData.is_active,
 start_date: formData.start_date.toISOString(),
 end_date: formData.end_date.toISOString(),
 };

 if (isEditMode) {
 await Campaign.update(id, formattedData);
 toast.success('Campaign updated successfully');
 } else {
 const created = await Campaign.create(formattedData);
 toast.success('Campaign created successfully');
 // The tailored scoring sheet (campaign-scoring-editor §3.3): awaited
 // BEFORE navigation, non-fatal — scoring never blocks a created campaign.
 const newId = created?.id || created?.campaign?.id;
 if (newId && scoringRef.current) {
 try {
 await scoringRef.current.submit(newId);
 } catch (err) {
 // Partial success is its own message (review B3) — see CreateScoringBlock.
 toast.warning(err?.draftVersion
 ? `Campaign created — scoring sheet saved as draft #${err.draftVersion}, but activation didn’t confirm. Check the campaign page.`
 : 'Campaign created — the scoring sheet wasn’t confirmed. Check the campaign page’s scoring card.');
 }
 }
 }
 navigate('/AdminCampaigns');
 } catch (error) {
 console.error('Failed to save campaign:', error);
 toast.error('Failed to save campaign');
 } finally {
 setLoading(false);
 }
 };

 if (fetching) {
 return (
 <div className="flex items-center justify-center min-h-screen">
 <Loader2 className="h-8 w-8 animate-spin text-primary"/>
 </div>
 );
 }

 // Helper to determine display text for type
 const isPHV = formData.type === 'brand_awareness';
 const typeLabel = isPHV
 ? 'PHV'
 : formData.type === 'quiz'
 ? 'Quiz'
 : formData.type === 'guided_review'
 ? 'Guided Review'
 : 'Regular';

 return (
 <div className="p-6 lg:p-8 max-w-5xl mx-auto">
 <div className="mb-6 flex items-center gap-4">
 <Button variant="ghost" size="icon" aria-label="Back to campaigns" onClick={() => navigate('/AdminCampaigns')}>
 <ArrowLeft className="h-5 w-5" aria-hidden="true" />
 </Button>
 <div>
 <h1 className="text-2xl font-bold tracking-tight">{isEditMode ? 'Edit Campaign' : 'Create New Campaign'}</h1>
 <p className="text-muted-foreground">
 {isEditMode ? 'Update campaign details and settings.' : `Configure a new ${typeLabel} campaign.`}
 </p>
 </div>
 </div>

 <form onSubmit={handleSubmit} className="space-y-8">
 <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
 {/* Main Form Area */}
 <div className="lg:col-span-2 space-y-6">
 <Card>
 <CardHeader>
 <CardTitle>Campaign Details</CardTitle>
 <CardDescription>Basic information about this campaign.</CardDescription>
 </CardHeader>
 <CardContent className="space-y-4">
 <div className="space-y-2">
 <Label htmlFor="name">Campaign Name</Label>
 <Input
 id="name" name="name" value={formData.name}
 onChange={handleChange}
 placeholder="e.g., Summer 2024 Promotion" required
 />
 </div>

 <div className="grid grid-cols-2 gap-4">
 <div className="space-y-2">
 <Label>Start Date</Label>
 <Popover>
 <PopoverTrigger asChild>
 <Button variant="outline" className="w-full justify-start text-left font-normal">
 <CalendarIcon className="mr-2 h-4 w-4"/>
 {formData.start_date ? format(formData.start_date, 'PPP') : 'Pick a date'}
 </Button>
 </PopoverTrigger>
 <PopoverContent className="w-auto p-0">
 <Calendar
 mode="single" required selected={formData.start_date}
 onSelect={(date) => handleDateChange('start_date', date)}
 initialFocus
 />
 </PopoverContent>
 </Popover>
 </div>
 <div className="space-y-2">
 <Label>End Date</Label>
 <Popover>
 <PopoverTrigger asChild>
 <Button variant="outline" className="w-full justify-start text-left font-normal">
 <CalendarIcon className="mr-2 h-4 w-4"/>
 {formData.end_date ? format(formData.end_date, 'PPP') : 'Pick a date'}
 </Button>
 </PopoverTrigger>
 <PopoverContent className="w-auto p-0">
 <Calendar
 mode="single" required selected={formData.end_date}
 onSelect={(date) => handleDateChange('end_date', date)}
 disabled={formData.start_date instanceof Date ? { before: formData.start_date } : undefined}
 initialFocus
 />
 </PopoverContent>
 </Popover>
 </div>
 </div>

 <div className="grid grid-cols-2 gap-4">
 <div className="space-y-2">
 <Label htmlFor="min_age">Min Age</Label>
 <Input
 id="min_age" name="min_age" type="number" value={formData.min_age}
 onChange={handleChange}
 required
 />
 </div>
 <div className="space-y-2">
 <Label htmlFor="max_age">Max Age</Label>
 <Input id="max_age" name="max_age" type="number" value={formData.max_age} onChange={handleChange} />
 </div>
 </div>
 </CardContent>
 </Card>

 <CampaignBriefFields draft={brief} onChange={setBrief} isEdit={isEditMode} />

 {/* Phase 2 (campaign-scoring-editor §3.3) — create only. */}
 {!isEditMode && (
 <CreateScoringBlock
 ref={scoringRef}
 product={brief.product || null}
 ageBands={brief.ageBands}
 language={brief.language || null}
 />
 )}

 </div>

 {/* Sidebar Area */}
 <div className="space-y-6">
 <Card>
 <CardHeader>
 <CardTitle>Status</CardTitle>
 </CardHeader>
 <CardContent>
 <div className="flex items-center space-x-2">
 <Switch id="is_active" checked={formData.is_active} onCheckedChange={handleSwitchChange} />
 <Label htmlFor="is_active" className="cursor-pointer">
 {formData.is_active ? 'Active' : 'Inactive'}
 </Label>
 </div>
 </CardContent>
 </Card>

 <div className="flex gap-4">
 <Button type="button" variant="outline" className="w-full" onClick={() => navigate('/AdminCampaigns')}>
 Cancel
 </Button>
 <Button type="submit" disabled={loading} className="w-full bg-primary hover:bg-primary/90">
 {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
 Save Changes
 </Button>
 </div>
 </div>
 </div>
 </form>
 </div>
 );
}
