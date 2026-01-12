import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import {
  Phone,
  Mail,
  MapPin,
  Calendar,
  User,
  Tag,
  FileText,
  Save
} from "lucide-react";
import { Prospect as ProspectEntity } from "@/api/entities";

const statusOptions = [
  { value: "new", label: "New", color: "bg-blue-100 text-blue-800" },
  { value: "contacted", label: "Contacted", color: "bg-yellow-100 text-yellow-800" },
  { value: "qualified", label: "Qualified", color: "bg-indigo-100 text-indigo-800" },
  { value: "negotiating", label: "Meeting / Negotiating", color: "bg-purple-100 text-purple-800" },
  { value: "proposal_sent", label: "Proposal Sent", color: "bg-orange-100 text-orange-800" },
  { value: "won", label: "Closed Won", color: "bg-green-100 text-green-800" },
  { value: "lost", label: "Closed Lost", color: "bg-red-100 text-red-800" }
];

export default function ProspectDetails({ prospect, campaigns, onStatusUpdate, onClose, userRole, onEdited }) {
  const [status, setStatus] = useState(prospect.status);
  const [notes, setNotes] = useState(prospect.notes || "");
  const [isUpdating, setIsUpdating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
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

  // Prioritize campaign object from prospect data (included by backend), fall back to campaigns array
  const campaign = prospect.campaign || campaigns.find(c => c.id === prospect.campaign_id);

  const currentStatus = statusOptions.find(s => s.value === status);

  const handleUpdate = async () => {
    setIsUpdating(true);
    try {
      // Import Prospect entity to update both status and notes
      const { Prospect } = await import("@/api/entities");
      await Prospect.update(prospect.id, {
        leadStatus: status,
        notes
      });

      // Call the parent callback if provided
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
      // Update via entities API directly to persist changes
      const { Prospect: ProspectEntity } = (await import("@/api/entities")).default || (await import("@/api/entities"));
    } catch (e) {
      // noop - dynamic import fallback handled below
    }
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
      onClose();
    } catch (error) {
      console.error('Error saving prospect edits:', error);
    }
    setIsUpdating(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar className="h-12 w-12">
            <AvatarFallback>{(firstName || prospect.name || 'U').substring(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{[firstName, lastName].filter(Boolean).join(' ') || prospect.name}</h2>
            <div className="flex flex-wrap gap-2 mt-1 text-sm text-gray-600">
              {email && <span>{email}</span>}
              {phone && <span>• {phone}</span>}
              <span>• Assigned to {(details?.assignedAgent ? [details.assignedAgent.firstName, details.assignedAgent.lastName].filter(Boolean).join(' ') || details.assignedAgent.email : (prospect.assigned_agent_name || 'System'))}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge className={currentStatus?.color}>
            {currentStatus?.label}
          </Badge>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="w-5 h-5" />
                    Contact & Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {isEditing ? (
                    <>
                      <div className="col-span-1 md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label className="mb-1">First Name</Label>
                          <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                        </div>
                        <div>
                          <Label className="mb-1">Last Name</Label>
                          <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
                        </div>
                      </div>
                      <div>
                        <div className="flex items-start gap-3">
                          <Phone className="w-5 h-5 text-gray-400 mt-2" />
                          <div className="w-full">
                            <Label className="mb-1">Phone</Label>
                            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
                          </div>
                        </div>
                      </div>
                      <div>
                        <div className="flex items-start gap-3">
                          <Mail className="w-5 h-5 text-gray-400 mt-2" />
                          <div className="w-full">
                            <Label className="mb-1">Email</Label>
                            <Input value={email} onChange={(e) => setEmail(e.target.value)} />
                          </div>
                        </div>
                      </div>
                      <div className="col-span-1 md:col-span-2">
                        <Label className="mb-1">Notes</Label>
                        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add notes about this prospect..." rows={3} />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-3">
                        <Phone className="w-5 h-5 text-gray-400" />
                        <div>
                          <p className="text-sm text-gray-500">Phone</p>
                          <p className="font-semibold">{prospect.phone}</p>
                        </div>
                      </div>
                      {prospect.email && (
                        <div className="flex items-center gap-3">
                          <Mail className="w-5 h-5 text-gray-400" />
                          <div>
                            <p className="text-sm text-gray-500">Email</p>
                            <p className="font-semibold">{prospect.email}</p>
                          </div>
                        </div>
                      )}
                      {prospect.postal_code && (
                        <div className="flex items-center gap-3">
                          <MapPin className="w-5 h-5 text-gray-400" />
                          <div>
                            <p className="text-sm text-gray-500">Postal Code</p>
                            <p className="font-semibold">{prospect.postal_code}</p>
                          </div>
                        </div>
                      )}
                      {prospect.date_of_birth && (
                        <div className="flex items-center gap-3">
                          <Calendar className="w-5 h-5 text-gray-400" />
                          <div>
                            <p className="text-sm text-gray-500">Date of Birth</p>
                            <p className="font-semibold">{format(new Date(prospect.date_of_birth), 'dd/MM/yyyy')}</p>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Tag className="w-5 h-5" />
                    Campaign & Source
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-gray-500 mb-2">Campaign</p>
                    <Badge variant="outline" className="bg-blue-50 text-blue-700">{campaign?.name || 'Unknown Campaign'}</Badge>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 mb-2">Source</p>
                    <span className="text-sm px-2 py-1 bg-gray-100 rounded text-gray-600">{(prospect.source || '').toUpperCase()}</span>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 mb-2">Created</p>
                    <p className="font-semibold">{format(new Date(prospect.created_date), 'PPp')}</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5" />
                    Quick Info
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Assigned To</span>
                    <span className="px-2 py-1 rounded bg-gray-100 text-gray-700">{(details?.assignedAgent ? [details.assignedAgent.firstName, details.assignedAgent.lastName].filter(Boolean).join(' ') || details.assignedAgent.email : (prospect.assigned_agent_name || 'System'))}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Status</span>
                    <span className="px-2 py-1 rounded bg-gray-100 text-gray-700">{currentStatus?.label}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Activity Timeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!details?.activities?.length ? (
                <p className="text-sm text-gray-500">No activity yet.</p>
              ) : (
                <div className="relative pl-6">
                  <div className="absolute left-2 top-0 bottom-0 w-px bg-gray-200" />
                  <div className="space-y-5">
                    {details.activities.map((a, idx) => {
                      const when = a.createdAt ? format(new Date(a.createdAt), 'PPpp') : '';
                      let text = a.description || a.type;
                      if (a.type === 'assigned') {
                        const metaId = a.metadata?.assignedAgentId;
                        const agentName = (details?.assignedAgent && details.assignedAgent.id === metaId)
                          ? ([details.assignedAgent.firstName, details.assignedAgent.lastName].filter(Boolean).join(' ') || details.assignedAgent.email)
                          : (prospect.assigned_agent_name || (metaId ? metaId : 'System'));
                        text = `Assigned to ${agentName}`;
                      } else if (a.type === 'created') {
                        text = `Signed up via ${(prospect.source || '').toUpperCase()} for ${campaign?.name || 'campaign'}`;
                      } else if (a.type === 'updated') {
                        text = `Prospect modified by admin`;
                      }
                      return (
                        <div key={a.id || idx} className="relative">
                          <div className="absolute -left-[9px] top-1.5 w-2 h-2 rounded-full bg-blue-500" />
                          <div className="ml-2">
                            <p className="text-sm font-medium text-gray-900">{text}</p>
                            <p className="text-xs text-gray-500">{when}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Campaign & Source */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tag className="w-5 h-5" />
            Campaign & Source
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm text-gray-500 mb-2">Campaign</p>
            <Badge variant="outline" className="bg-blue-50 text-blue-700">
              {campaign?.name || 'Unknown Campaign'}
            </Badge>
          </div>

          <div>
            <p className="text-sm text-gray-500 mb-2">Source</p>
            <span className="text-sm px-2 py-1 bg-gray-100 rounded text-gray-600">
              {(prospect.source || '').toUpperCase()}
            </span>
          </div>

          <div>
            <p className="text-sm text-gray-500 mb-2">Created</p>
            <p className="font-semibold">
              {format(new Date(prospect.created_date), 'PPp')}
            </p>
          </div>

          {/* Timeline */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-3">Timeline</p>
            <div className="relative pl-4 border-l border-gray-200 space-y-4">
              <div className="text-sm">
                <p className="font-medium text-gray-900">Signed up</p>
                <p className="text-gray-600">{format(new Date(prospect.created_date), 'PPpp')}</p>
                <p className="text-gray-500 mt-1">via {(prospect.source || '').toUpperCase()} for {campaign?.name || 'Unknown Campaign'}</p>
              </div>
              {prospect.assigned_agent_name && (
                <div className="text-sm">
                  <p className="font-medium text-gray-900">Assigned to agent</p>
                  <p className="text-gray-600">{prospect.assigned_agent_name}</p>
                  <p className="text-gray-500 mt-1">on {format(new Date(prospect.updated_date || prospect.created_date), 'PPpp')}</p>
                </div>
              )}
            </div>
          </div>

          {prospect.campaigns_subscribed && prospect.campaigns_subscribed.length > 1 && (
            <div>
              <p className="text-sm text-gray-500 mb-2">
                Subscribed Campaigns ({prospect.campaigns_subscribed.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {prospect.campaigns_subscribed.map((campaignId) => {
                  const camp = campaigns.find(c => c.id === campaignId);
                  return (
                    <Badge key={campaignId} variant="outline" size="sm">
                      {camp?.name || campaignId}
                    </Badge>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Status Update & Edit */}
      {(userRole === 'admin' || userRole === 'agent') && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              {isEditing ? 'Edit Prospect' : 'Update Status'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isEditing ? (
              <div className="flex gap-3">
                <Button onClick={handleSaveEdits} disabled={isUpdating} className="bg-blue-600 hover:bg-blue-700">
                  <Save className="w-4 h-4 mr-2" />
                  {isUpdating ? 'Saving...' : 'Save Changes'}
                </Button>
                <Button variant="outline" onClick={() => setIsEditing(false)}>Cancel</Button>
              </div>
            ) : (
              <>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-2 block">Status</label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {statusOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-2 block">Notes</label>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add notes about this prospect..." rows={3} />
                </div>
                <div className="flex gap-3">
                  <Button onClick={handleUpdate} disabled={isUpdating || (status === prospect.status && notes === (prospect.notes || ""))} className="bg-blue-600 hover:bg-blue-700">
                    <Save className="w-4 h-4 mr-2" />
                    {isUpdating ? 'Updating...' : 'Update'}
                  </Button>
                  {userRole === 'admin' && (
                    <Button variant="outline" onClick={() => setIsEditing(true)}>Edit Details</Button>
                  )}
                  <Button variant="outline" onClick={onClose}>Close</Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}