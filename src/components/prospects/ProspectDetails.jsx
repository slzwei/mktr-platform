import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { format } from "date-fns";
import { Clock, User, Edit2, ChevronLeft, UserPlus, Phone, Mail, Tag, Building } from "lucide-react";
import { Prospect as ProspectEntity, User as UserEntity } from "@/api/entities";
import ContactInfoCard from "@/components/prospects/details/ContactInfoCard";
import ActivityTimeline from "@/components/prospects/details/ActivityTimeline";

const statusOptions = [
  { value: "new", label: "New", color: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800", dot: "bg-blue-500" },
  { value: "contacted", label: "Contacted", color: "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-950/30 dark:text-yellow-400 dark:border-yellow-800", dot: "bg-yellow-500" },
  { value: "qualified", label: "Qualified", color: "bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-400 dark:border-indigo-800", dot: "bg-indigo-500" },
  { value: "negotiating", label: "Negotiating", color: "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950/30 dark:text-purple-400 dark:border-purple-800", dot: "bg-purple-500" },
  { value: "proposal_sent", label: "Proposal Sent", color: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800", dot: "bg-orange-500" },
  { value: "won", label: "Won", color: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800", dot: "bg-emerald-500" },
  { value: "lost", label: "Lost", color: "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800", dot: "bg-red-500" }
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
  const [agents, setAgents] = useState([]);
  const [assignedAgentId, setAssignedAgentId] = useState(prospect.assigned_agent_id || "");
  const [isAssigning, setIsAssigning] = useState(false);

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
          className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to prospects
        </button>
        {!isEditing && (userRole === 'admin' || userRole === 'agent') && (
          <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
            <Edit2 className="w-4 h-4 mr-2" />
            Edit details
          </Button>
        )}
      </div>

      {/* ─── Identity Card ─── */}
      <div className="flex items-start gap-5">
        <Avatar className="h-16 w-16 border-2 border-gray-100 dark:border-gray-700 shrink-0">
          <AvatarFallback className="bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 text-xl font-semibold">
            {(firstName || prospect.name || 'U').substring(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {[firstName, lastName].filter(Boolean).join(' ') || prospect.name}
            </h2>
            <Badge variant="secondary" className={`${currentStatus.color} px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize border`}>
              {currentStatus.label}
            </Badge>
            <code className="text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600">
              {sourceLabel}
            </code>
          </div>
          <div className="flex items-center gap-4 mt-2 text-sm text-gray-500 dark:text-gray-400 flex-wrap">
            {phone && (
              <div className="flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5" />
                <span>{phone}</span>
              </div>
            )}
            {email && !email.startsWith('retell-') && (
              <div className="flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" />
                <span>{email}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              <span>Created {format(new Date(prospect.created_date), 'MMM d, yyyy · h:mm a')}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" />
              <span className={!agentName ? 'text-amber-500 dark:text-amber-400 font-medium' : ''}>
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
          <Card className="border-gray-200/50 dark:border-gray-700/50 shadow-sm">
            <CardContent className="p-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <Label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2 block">Stage</Label>
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
                  <Label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2 block">Assign To</Label>
                  <Select
                    value={assignedAgentId || "unassigned"}
                    onValueChange={(val) => handleAssignAgent(val === "unassigned" ? null : val)}
                    disabled={isAssigning}
                  >
                    <SelectTrigger className={`w-full h-10 ${!assignedAgentId ? 'border-amber-300 dark:border-amber-700' : ''}`}>
                      <SelectValue placeholder="Select agent..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">
                        <div className="flex items-center gap-2 text-gray-400">
                          <UserPlus className="w-3.5 h-3.5" />
                          Unassigned
                        </div>
                      </SelectItem>
                      {agents.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center text-[10px] font-semibold">
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

          {/* Notes */}
          <Card className="border-gray-200/50 dark:border-gray-700/50 shadow-sm">
            <CardContent className="p-5 space-y-4">
              <Label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide block">Notes</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add internal notes, meeting summaries, or next steps..."
                className="min-h-[140px] resize-y text-sm placeholder:text-gray-400 dark:placeholder:text-gray-500"
              />
              <div className="flex justify-end">
                <Button
                  onClick={handleUpdate}
                  disabled={isUpdating || (status === prospect.status && notes === (prospect.notes || ""))}
                  className="bg-gray-900 hover:bg-gray-800 dark:bg-gray-100 dark:hover:bg-gray-200 dark:text-gray-900 text-white shadow-sm"
                >
                  {isUpdating ? 'Saving...' : 'Update Prospect'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Activity Timeline */}
          <Card className="border-gray-200/50 dark:border-gray-700/50 shadow-sm">
            <CardContent className="p-5">
              <ActivityTimeline details={details} prospect={prospect} campaign={campaign} />
            </CardContent>
          </Card>
        </div>

        {/* ─── Right Column: Info Cards ─── */}
        <div className="space-y-6">
          {/* Contact Info */}
          <Card className="border-gray-200/50 dark:border-gray-700/50 shadow-sm">
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
          <Card className="border-gray-200/50 dark:border-gray-700/50 shadow-sm">
            <CardContent className="p-5 space-y-3">
              <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide flex items-center gap-2">
                <Tag className="w-3.5 h-3.5" />
                Campaign
              </h4>
              {campaign ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Building className="w-4 h-4 text-gray-400" />
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{campaign.name}</span>
                  </div>
                  {campaign.type && (
                    <code className="text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded">
                      {campaign.type.replace(/_/g, ' ')}
                    </code>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-500 italic">No campaign linked</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
