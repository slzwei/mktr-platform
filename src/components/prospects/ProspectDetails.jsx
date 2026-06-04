import { useState, useEffect } from"react";
import { Button } from"@/components/ui/button";
import { Badge } from"@/components/ui/badge";
import { Textarea } from"@/components/ui/textarea";
import { Label } from"@/components/ui/label";
import { Avatar, AvatarFallback } from"@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from"@/components/ui/select";
import { Card, CardContent } from"@/components/ui/card";
import { format } from"date-fns";
import { Clock, User, Edit2, ChevronLeft, UserPlus, Phone, Mail, Tag, Building, Headphones } from"lucide-react";
import { Prospect as ProspectEntity, User as UserEntity } from"@/api/entities";
import { apiClient } from"@/api/client";
import ContactInfoCard from"@/components/prospects/details/ContactInfoCard";
import ActivityTimeline from"@/components/prospects/details/ActivityTimeline";
import QuizResultCard from"@/components/prospects/details/QuizResultCard";
import { extractQuizSummary } from"@/lib/quizDisplay";

const statusOptions = [
 { value:"new", label:"New", color:"bg-info/15 text-info border-info/30", dot:"bg-primary"},
 { value:"contacted", label:"Contacted", color:"bg-warning/15 text-warning border-warning/30 dark:text-warning", dot:"bg-warning"},
 { value:"qualified", label:"Qualified", color:"bg-info/15 text-info border-info/30", dot:"bg-info"},
 { value:"negotiating", label:"Negotiating", color:"bg-plum/15 text-plum border-plum/30", dot:"bg-plum"},
 { value:"proposal_sent", label:"Proposal Sent", color:"bg-warning/15 text-warning border-warning/30", dot:"bg-warning"},
 { value:"won", label:"Won", color:"bg-success/15 text-success border-success/30", dot:"bg-success"},
 { value:"lost", label:"Lost", color:"bg-destructive/15 text-destructive border-destructive/30", dot:"bg-destructive"}
];

export default function ProspectDetails({ prospect, campaigns, onStatusUpdate, onClose, userRole, onEdited }) {
 const [status, setStatus] = useState(prospect.status);
 const [notes, setNotes] = useState(prospect.notes ||"");
 const [isUpdating, setIsUpdating] = useState(false);
 const [isEditing, setIsEditing] = useState(false);

 const [firstName, setFirstName] = useState((prospect.name || '').split(' ').slice(0, -1).join(' ') || prospect.firstName ||"");
 const [lastName, setLastName] = useState((prospect.name || '').split(' ').slice(-1).join(' ') || prospect.lastName ||"");
 const [email, setEmail] = useState(prospect.email ||"");
 const [phone, setPhone] = useState(prospect.phone ||"");

 const [details, setDetails] = useState(null);
 const [agents, setAgents] = useState([]);
 const [assignedAgentId, setAssignedAgentId] = useState(prospect.assigned_agent_id ||"");
 const [isAssigning, setIsAssigning] = useState(false);
 const [recordingUrl, setRecordingUrl] = useState(null);

 useEffect(() => {
 let mounted = true;
 (async () => {
 try {
 const [full, agentList] = await Promise.all([
 ProspectEntity.get(prospect.id),
 UserEntity.getAgents().catch(() => [])
 ]);
 if (!mounted) return;
 setDetails(full);
 setAgents(agentList);
 if (full?.assignedAgentId) setAssignedAgentId(full.assignedAgentId);
 if (full?.leadStatus) setStatus((full.leadStatus || '').toLowerCase());
 if (full?.notes) setNotes(full.notes);
 if (full?.firstName) setFirstName(full.firstName);
 if (full?.lastName) setLastName(full.lastName);
 if (full?.email) setEmail(full.email);
 if (full?.phone) setPhone(full.phone);

 // Fetch recording URL for Retell prospects
 if (full?.sourceMetadata?.retellCallId) {
 try {
 const rec = await apiClient.get(`/retell/recording/${prospect.id}`);
 if (mounted && rec.data?.recordingUrl) setRecordingUrl(rec.data.recordingUrl);
 } catch (_) { /* no recording available */ }
 }
 } catch (_) { /* ignore */ }
 })();
 return () => { mounted = false; };
 }, [prospect.id]);

 const handleAssignAgent = async (agentId) => {
 setIsAssigning(true);
 try {
 await ProspectEntity.assign(prospect.id, agentId);
 setAssignedAgentId(agentId);
 const full = await ProspectEntity.get(prospect.id);
 setDetails(full);
 if (typeof onEdited === 'function') await onEdited();
 } catch (error) {
 console.error('Error assigning agent:', error);
 }
 setIsAssigning(false);
 };

 const campaign = prospect.campaign || campaigns.find(c => c.id === prospect.campaign_id);
 const currentStatus = statusOptions.find(s => s.value === status) || statusOptions[0];
 const agentName = details?.assignedAgent
 ? [details.assignedAgent.firstName, details.assignedAgent.lastName].filter(Boolean).join(' ') || details.assignedAgent.email
 : (prospect.assigned_agent_name || null);

 const handleUpdate = async () => {
 setIsUpdating(true);
 try {
 const { Prospect } = await import("@/api/entities");
 await Prospect.update(prospect.id, { leadStatus: status, notes });
 if (typeof onStatusUpdate === 'function') await onStatusUpdate(prospect.id, status);
 if (typeof onEdited === 'function') await onEdited();
 } catch (error) {
 console.error('Error updating prospect:', error);
 }
 setIsUpdating(false);
 };

 const handleSaveEdits = async () => {
 setIsUpdating(true);
 try {
 const { Prospect } = await import("@/api/entities");
 await Prospect.update(prospect.id, {
 firstName: firstName || prospect.firstName,
 lastName: lastName || prospect.lastName,
 email,
 phone,
 notes
 });
 setIsEditing(false);
 if (typeof onEdited === 'function') await onEdited();
 const full = await ProspectEntity.get(prospect.id);
 setDetails(full);
 } catch (error) {
 console.error('Error saving prospect edits:', error);
 }
 setIsUpdating(false);
 };

 const sourceLabel = (details?.leadSource || prospect.source || 'other').replace('_', ' ').toUpperCase();

 return (
 <div className="space-y-6">
 {/* ─── Header Bar ─── */}
 <div className="flex items-center justify-between">
 <button
 onClick={onClose}
 className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground dark:hover:text-muted-foreground transition-colors" >
 <ChevronLeft className="w-4 h-4"/>
 Back to prospects
 </button>
 {!isEditing && (userRole === 'admin' || userRole === 'agent') && (
 <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
 <Edit2 className="w-4 h-4 mr-2"/>
 Edit details
 </Button>
 )}
 </div>

 {/* ─── Identity Card ─── */}
 <div className="flex items-start gap-5">
 <Avatar className="h-16 w-16 border-2 border-border shrink-0">
 <AvatarFallback className="bg-primary/10 text-primary text-xl font-semibold">
 {(firstName || prospect.name || 'U').substring(0, 1).toUpperCase()}
 </AvatarFallback>
 </Avatar>
 <div className="min-w-0 flex-1">
 <div className="flex items-center gap-3 flex-wrap">
 <h2 className="text-2xl font-bold text-foreground">
 {[firstName, lastName].filter(Boolean).join(' ') || prospect.name}
 </h2>
 <Badge variant="secondary" className={`${currentStatus.color} px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize border`}>
 {currentStatus.label}
 </Badge>
 <code className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded border border-border">
 {sourceLabel}
 </code>
 </div>
 <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground flex-wrap">
 {phone && (
 <div className="flex items-center gap-1.5">
 <Phone className="w-3.5 h-3.5"/>
 <span>{phone}</span>
 </div>
 )}
 {email && !email.startsWith('retell-') && (
 <div className="flex items-center gap-1.5">
 <Mail className="w-3.5 h-3.5"/>
 <span>{email}</span>
 </div>
 )}
 <div className="flex items-center gap-1.5">
 <Clock className="w-3.5 h-3.5"/>
 <span>Created {format(new Date(prospect.created_date), 'MMM d, yyyy · h:mm a')}</span>
 </div>
 <div className="flex items-center gap-1.5">
 <User className="w-3.5 h-3.5"/>
 <span className={!agentName ? 'text-warning font-medium' : ''}>
 {agentName || 'Unassigned'}
 </span>
 </div>
 </div>
 </div>
 </div>

 {/* ─── Main Content: 2-column on desktop ─── */}
 <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

 {/* ─── Left Column: Management Actions ─── */}
 <div className="lg:col-span-2 space-y-6">

 {/* Stage + Assignment Row */}
 <Card className="border-border shadow-sm">
 <CardContent className="p-5">
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
 <div>
 <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">Stage</Label>
 <Select value={status} onValueChange={setStatus}>
 <SelectTrigger className="w-full h-10">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 {statusOptions.map((option) => (
 <SelectItem key={option.value} value={option.value}>
 <div className="flex items-center gap-2">
 <div className={`w-2 h-2 rounded-full ${option.dot}`} />
 {option.label}
 </div>
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 <div>
 <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">Assign To</Label>
 <Select
 value={assignedAgentId ||"unassigned"}
 onValueChange={(val) => handleAssignAgent(val ==="unassigned"? null : val)}
 disabled={isAssigning}
 >
 <SelectTrigger className={`w-full h-10 ${!assignedAgentId ? 'border-warning/30' : ''}`}>
 <SelectValue placeholder="Select agent..."/>
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="unassigned">
 <div className="flex items-center gap-2 text-muted-foreground">
 <UserPlus className="w-3.5 h-3.5"/>
 Unassigned
 </div>
 </SelectItem>
 {agents.map((agent) => (
 <SelectItem key={agent.id} value={agent.id}>
 <div className="flex items-center gap-2">
 <div className="w-5 h-5 rounded-full bg-info/15 text-primary flex items-center justify-center text-[10px] font-semibold">
 {(agent.firstName || agent.email || '?').charAt(0).toUpperCase()}
 </div>
 {[agent.firstName, agent.lastName].filter(Boolean).join(' ') || agent.email}
 </div>
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 </div>
 </CardContent>
 </Card>

 {/* Call Recording */}
 {recordingUrl && (
 <Card className="border-border shadow-sm">
 <CardContent className="p-5 space-y-3">
 <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
 <Headphones className="w-3.5 h-3.5"/>
 Call Recording
 </Label>
 <audio controls preload="metadata" className="w-full h-10">
 <source src={recordingUrl} type="audio/wav"/>
 Your browser does not support audio playback.
 </audio>
 <p className="text-xs text-muted-foreground">
 {details?.sourceMetadata?.durationMs
 ? `Duration: ${Math.round(details.sourceMetadata.durationMs / 1000)}s`
 : ''}
 {details?.sourceMetadata?.sentiment
 ? ` · Sentiment: ${details.sourceMetadata.sentiment}`
 : ''}
 </p>
 </CardContent>
 </Card>
 )}

 {/* Quiz Result (lead-capture quiz funnel) — renders nothing for non-quiz leads */}
 <QuizResultCard summary={extractQuizSummary(details?.sourceMetadata)} />

 {/* Notes */}
 <Card className="border-border shadow-sm">
 <CardContent className="p-5 space-y-4">
 <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block">Notes</Label>
 <Textarea
 value={notes}
 onChange={(e) => setNotes(e.target.value)}
 placeholder="Add internal notes, meeting summaries, or next steps..." className="min-h-[140px] resize-y text-sm placeholder:text-muted-foreground dark:placeholder:text-muted-foreground" />
 <div className="flex justify-end">
 <Button
 onClick={handleUpdate}
 disabled={isUpdating || (status === prospect.status && notes === (prospect.notes ||""))}
 className="bg-foreground hover:bg-foreground dark:bg-muted dark:hover:bg-muted dark:text-foreground text-background shadow-sm" >
 {isUpdating ? 'Saving...' : 'Update Prospect'}
 </Button>
 </div>
 </CardContent>
 </Card>

 {/* Activity Timeline */}
 <Card className="border-border shadow-sm">
 <CardContent className="p-5">
 <ActivityTimeline details={details} prospect={prospect} campaign={campaign} />
 </CardContent>
 </Card>
 </div>

 {/* ─── Right Column: Info Cards ─── */}
 <div className="space-y-6">
 {/* Contact Info */}
 <Card className="border-border shadow-sm">
 <CardContent className="p-5">
 <ContactInfoCard
 isEditing={isEditing}
 firstName={firstName}
 lastName={lastName}
 email={email}
 phone={phone}
 prospect={prospect}
 isUpdating={isUpdating}
 onFirstNameChange={setFirstName}
 onLastNameChange={setLastName}
 onEmailChange={setEmail}
 onPhoneChange={setPhone}
 onSaveEdits={handleSaveEdits}
 onCancelEdit={() => setIsEditing(false)}
 />
 </CardContent>
 </Card>

 {/* Campaign Info */}
 <Card className="border-border shadow-sm">
 <CardContent className="p-5 space-y-3">
 <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
 <Tag className="w-3.5 h-3.5"/>
 Campaign
 </h4>
 {campaign ? (
 <div className="space-y-2">
 <div className="flex items-center gap-2">
 <Building className="w-4 h-4 text-muted-foreground"/>
 <span className="text-sm font-medium text-foreground">{campaign.name}</span>
 </div>
 {campaign.type && (
 <code className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
 {campaign.type.replace(/_/g, ' ')}
 </code>
 )}
 </div>
 ) : (
 <p className="text-sm text-muted-foreground italic">No campaign linked</p>
 )}
 </CardContent>
 </Card>
 </div>
 </div>
 </div>
 );
}
