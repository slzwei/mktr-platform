import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { Clock, User, Edit2, X } from "lucide-react";
import { Prospect as ProspectEntity } from "@/api/entities";
import ContactInfoCard from "@/components/prospects/details/ContactInfoCard";
import CampaignInfoCard from "@/components/prospects/details/CampaignInfoCard";
import ActivityTimeline from "@/components/prospects/details/ActivityTimeline";

const statusOptions = [
  { value: "new", label: "New", color: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800" },
  { value: "contacted", label: "Contacted", color: "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-950/30 dark:text-yellow-400 dark:border-yellow-800" },
  { value: "qualified", label: "Qualified", color: "bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-400 dark:border-indigo-800" },
  { value: "negotiating", label: "Negotiating", color: "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950/30 dark:text-purple-400 dark:border-purple-800" },
  { value: "proposal_sent", label: "Proposal Sent", color: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800" },
  { value: "won", label: "Won", color: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800" },
  { value: "lost", label: "Lost", color: "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800" }
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
      } catch (_) { /* ignore fetch errors */ }
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
      <div className="flex items-start justify-between px-6 py-5 border-b bg-white dark:bg-gray-900 shrink-0">
        <div className="flex items-center gap-4">
          <Avatar className="h-14 w-14 border-2 border-gray-100 dark:border-gray-700">
            <AvatarFallback className="bg-blue-50 dark:bg-blue-950/30 text-blue-700 text-lg font-semibold">
              {(firstName || prospect.name || 'U').substring(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                {[firstName, lastName].filter(Boolean).join(' ') || prospect.name}
              </h2>
              <Badge variant="secondary" className={`${currentStatus.color} px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize border`}>
                {currentStatus.label}
              </Badge>
            </div>
            <div className="flex items-center gap-3 mt-1 text-sm text-gray-500 dark:text-gray-400">
              <div className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                <span>Created {format(new Date(prospect.created_date), 'MMM d, yyyy')}</span>
              </div>
              <span className="text-gray-300 dark:text-gray-600">|</span>
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
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full h-8 w-8 hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden min-h-0">
        <div className="grid grid-cols-1 md:grid-cols-3 h-full divide-x">

          {/* Left Sidebar - Details */}
          <ScrollArea className="md:col-span-1 bg-gray-50/50 dark:bg-gray-800/50">
            <div className="p-6 space-y-6">
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
              <CampaignInfoCard campaign={campaign} prospect={prospect} />
            </div>
          </ScrollArea>

          {/* Right Content - Activity & Notes */}
          <ScrollArea className="md:col-span-2 bg-white dark:bg-gray-900">
            <div className="p-6 space-y-8">

              {/* Update Status & Notes Section */}
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Prospect Management</h3>
                </div>
                <Card className="border shadow-sm">
                  <CardContent className="p-5 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                      <div className="sm:col-span-1">
                        <Label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5 block">Stage</Label>
                        <Select value={status} onValueChange={setStatus}>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {statusOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value} className="focus:bg-gray-50 dark:focus:bg-gray-800">
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
                        <Label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5 block">Notes</Label>
                        <Textarea
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder="Add internal notes, meeting summaries, or next steps..."
                          className="min-h-[100px] resize-none text-sm placeholder:text-gray-400 dark:placeholder:text-gray-500"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end pt-2">
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
              </section>

              <ActivityTimeline details={details} prospect={prospect} campaign={campaign} />

            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
