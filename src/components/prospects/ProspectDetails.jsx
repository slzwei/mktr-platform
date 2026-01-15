import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import {
  Phone,
  Mail,
  MapPin,
  Calendar,
  User,
  Tag,
  FileText,
  Save,
  Clock,
  CheckCircle2,
  XCircle,
  Edit2,
  X
} from "lucide-react";
import { Prospect as ProspectEntity } from "@/api/entities";

const statusOptions = [
  { value: "new", label: "New", color: "bg-blue-100 text-blue-800 border-blue-200" },
  { value: "contacted", label: "Contacted", color: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  { value: "qualified", label: "Qualified", color: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  { value: "negotiating", label: "Negotiating", color: "bg-purple-100 text-purple-800 border-purple-200" },
  { value: "proposal_sent", label: "Proposal Sent", color: "bg-orange-100 text-orange-800 border-orange-200" },
  { value: "won", label: "Won", color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  { value: "lost", label: "Lost", color: "bg-red-100 text-red-800 border-red-200" }
];

export default function ProspectDetails({ prospect, campaigns, onStatusUpdate, onClose, userRole, onEdited }) {
  const [status, setStatus] = useState(prospect.status);
  const [notes, setNotes] = useState(prospect.notes || "");
  const [isUpdating, setIsUpdating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // Edit form state
  const [firstName, setFirstName] = useState((prospect.name || '').split(' ').slice(0, -1).join(' ') || prospect.firstName || "");
  const [lastName, setLastName] = useState((prospect.name || '').split(' ').slice(-1).join(' ') || prospect.lastName || "");
  const [email, setEmail] = useState(prospect.email || "");
  const [phone, setPhone] = useState(prospect.phone || "");

  const [details, setDetails] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const full = await ProspectEntity.get(prospect.id);
        if (!mounted) return;
        setDetails(full);
        if (full?.leadStatus) setStatus((full.leadStatus || '').toLowerCase());
        if (full?.notes) setNotes(full.notes);
        if (full?.firstName) setFirstName(full.firstName);
        if (full?.lastName) setLastName(full.lastName);
        if (full?.email) setEmail(full.email);
        if (full?.phone) setPhone(full.phone);
      } catch (_) { }
    })();
    return () => { mounted = false; };
  }, [prospect.id]);

  const campaign = prospect.campaign || campaigns.find(c => c.id === prospect.campaign_id);
  const currentStatus = statusOptions.find(s => s.value === status) || statusOptions[0];

  const handleUpdate = async () => {
    setIsUpdating(true);
    try {
      const { Prospect } = await import("@/api/entities");
      await Prospect.update(prospect.id, {
        leadStatus: status,
        notes
      });

      if (typeof onStatusUpdate === 'function') {
        await onStatusUpdate(prospect.id, status);
      }
      onClose();
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
      if (typeof onEdited === 'function') {
        await onEdited();
      }
      // Refresh details
      const full = await ProspectEntity.get(prospect.id);
      setDetails(full);
    } catch (error) {
      console.error('Error saving prospect edits:', error);
    }
    setIsUpdating(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between px-6 py-5 border-b bg-white shrink-0">
        <div className="flex items-center gap-4">
          <Avatar className="h-14 w-14 border-2 border-gray-100">
            <AvatarFallback className="bg-blue-50 text-blue-700 text-lg font-semibold">
              {(firstName || prospect.name || 'U').substring(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-gray-900">
                {[firstName, lastName].filter(Boolean).join(' ') || prospect.name}
              </h2>
              <Badge variant="secondary" className={`${currentStatus.color} px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize border`}>
                {currentStatus.label}
              </Badge>
            </div>
            <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
              <div className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                <span>Created {format(new Date(prospect.created_date), 'MMM d, yyyy')}</span>
              </div>
              <span className="text-gray-300">|</span>
              <div className="flex items-center gap-1">
                <User className="w-3.5 h-3.5" />
                <span>{(details?.assignedAgent ? [details.assignedAgent.firstName, details.assignedAgent.lastName].filter(Boolean).join(' ') || details.assignedAgent.email : (prospect.assigned_agent_name || 'Unassigned'))}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isEditing && (userRole === 'admin' || userRole === 'agent') && (
            <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
              <Edit2 className="w-4 h-4 mr-2" />
              Edit details
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full h-8 w-8 hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-500" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-3 h-full divide-x">

          {/* Left Sidebar - Details */}
          <ScrollArea className="md:col-span-1 bg-gray-50/50">
            <div className="p-6 space-y-6">
              {/* Contact Info */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                  <User className="w-4 h-4 text-gray-500" />
                  Contact Info
                </h3>
                {isEditing ? (
                  <div className="space-y-3 bg-white p-3 rounded-lg border shadow-sm">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">First Name</Label>
                        <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} className="h-8" />
                      </div>
                      <div>
                        <Label className="text-xs">Last Name</Label>
                        <Input value={lastName} onChange={(e) => setLastName(e.target.value)} className="h-8" />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Email</Label>
                      <Input value={email} onChange={(e) => setEmail(e.target.value)} className="h-8" />
                    </div>
                    <div>
                      <Label className="text-xs">Phone</Label>
                      <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="h-8" />
                    </div>
                    <div className="pt-2 flex gap-2">
                      <Button size="sm" onClick={handleSaveEdits} disabled={isUpdating} className="w-full">
                        Save
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setIsEditing(false)} className="w-full">
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-white rounded-lg border shadow-sm p-4 space-y-3">
                    <div className="group flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                        <Phone className="w-4 h-4 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-500">Phone</p>
                        <p className="text-sm font-medium text-gray-900 truncate">{phone || '—'}</p>
                      </div>
                    </div>
                    <Separator />
                    <div className="group flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                        <Mail className="w-4 h-4 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-500">Email</p>
                        <p className="text-sm font-medium text-gray-900 truncate" title={email}>{email || '—'}</p>
                      </div>
                    </div>
                    <Separator />
                    <div className="group flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                        <MapPin className="w-4 h-4 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-500">Location</p>
                        <p className="text-sm font-medium text-gray-900 truncate">{prospect.postal_code || '—'}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Campaign Info */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                  <Tag className="w-4 h-4 text-gray-500" />
                  Campaign
                </h3>
                <div className="bg-white rounded-lg border shadow-sm p-4 space-y-3">
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">Campaign Name</p>
                    <Badge variant="outline" className="font-normal text-gray-900 border-gray-300">
                      {campaign?.name || 'Unknown Campaign'}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">Lead Source</p>
                    <div className="inline-flex items-center px-2 py-1 rounded bg-gray-100 text-gray-700 text-xs font-medium uppercase tracking-wide">
                      {prospect.source || 'Unknown'}
                    </div>
                  </div>
                  {prospect.campaigns_subscribed && prospect.campaigns_subscribed.length > 1 && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-1">Subscriptions</p>
                      <div className="flex flex-wrap gap-1">
                        {prospect.campaigns_subscribed.map((cid) => (
                          <span key={cid} className="text-[10px] px-1.5 py-0.5 bg-gray-50 border rounded text-gray-600">{cid}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </ScrollArea>

          {/* Right Content - Activity & Notes */}
          <ScrollArea className="md:col-span-2 bg-white">
            <div className="p-6 space-y-8">

              {/* Update Status & Notes Section */}
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">Prospect Management</h3>
                </div>
                <Card className="border shadow-sm">
                  <CardContent className="p-5 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                      <div className="sm:col-span-1">
                        <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5 block">Stage</Label>
                        <Select value={status} onValueChange={setStatus}>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {statusOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value} className="focus:bg-gray-50">
                                <div className="flex items-center gap-2">
                                  <div className={`w-2 h-2 rounded-full ${option.color.split(' ')[0]}`} />
                                  {option.label}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="sm:col-span-3">
                        <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5 block">Notes</Label>
                        <Textarea
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder="Add internal notes, meeting summaries, or next steps..."
                          className="min-h-[100px] resize-none text-sm placeholder:text-gray-400"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end pt-2">
                      <Button
                        onClick={handleUpdate}
                        disabled={isUpdating || (status === prospect.status && notes === (prospect.notes || ""))}
                        className="bg-gray-900 hover:bg-gray-800 text-white shadow-sm"
                      >
                        {isUpdating ? 'Saving...' : 'Update Prospect'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </section>

              {/* Timeline Section */}
              <section>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Activity History</h3>
                <div className="relative pl-6 space-y-6">
                  <div className="absolute left-[11px] top-2 bottom-4 w-px bg-gray-200" />

                  {(!details?.activities || details.activities.length === 0) ? (
                    <div className="relative flex items-center gap-3">
                      <div className="h-6 w-6 rounded-full bg-gray-100 border-2 border-white ring-1 ring-gray-200 flex items-center justify-center z-10">
                        <Clock className="w-3 h-3 text-gray-400" />
                      </div>
                      <p className="text-sm text-gray-500">No activity recorded yet.</p>
                    </div>
                  ) : (
                    details.activities.map((a, idx) => {
                      const when = a.createdAt ? format(new Date(a.createdAt), 'MMM d, h:mm a') : '';
                      let text = a.description || a.type;
                      let icon = <FileText className="w-3 h-3 text-gray-500" />;

                      if (a.type === 'assigned') {
                        text = "Assigned to agent";
                        icon = <User className="w-3 h-3 text-purple-600" />;
                      } else if (a.type === 'created') {
                        // Use backend description if it's the new rich format, otherwise fallback
                        if (a.description && a.description.includes('Prospect signed up')) {
                          text = a.description;
                        } else {
                          text = "Prospect created";
                        }
                        icon = <CheckCircle2 className="w-3 h-3 text-emerald-600" />;
                      } else if (a.type === 'lead_status_updated') {
                        text = `Status updated to ${a.description || 'new status'}`;
                        icon = <Edit2 className="w-3 h-3 text-blue-600" />;
                      }

                      return (
                        <div key={idx} className="relative group">
                          <div className="flex items-start gap-4">
                            <div className="absolute -left-[24px] mt-0.5">
                              <div className="h-6 w-6 rounded-full bg-white border-2 border-gray-100 ring-1 ring-gray-200 flex items-center justify-center z-10 shadow-sm">
                                {icon}
                              </div>
                            </div>
                            <div className="flex-1 bg-gray-50/50 rounded-lg p-3 border border-gray-100">
                              <p className="text-sm font-medium text-gray-900">{text}</p>
                              {a.type === 'assigned' && <p className="text-xs text-gray-500 mt-0.5">{a.description || 'System assignment'}</p>}
                              {a.type === 'created' && <p className="text-xs text-gray-500 mt-0.5">via {prospect.source}, campaign: {campaign?.name}</p>}
                              <p className="text-xs text-gray-400 mt-2">{when}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}

                  {/* Origin Marker */}
                  <div className="relative flex items-center gap-4">
                    <div className="absolute -left-[24px]">
                      <div className="h-6 w-6 rounded-full bg-gray-100 border-2 border-white ring-1 ring-gray-200 flex items-center justify-center z-10">
                        <div className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                      </div>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Start of History</span>
                    </div>
                  </div>

                </div>
              </section>

            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}