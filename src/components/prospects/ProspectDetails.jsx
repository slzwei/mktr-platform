import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

const statusOptions = [
  { value: "new", label: "New", color: "bg-blue-100 text-blue-800" },
  { value: "contacted", label: "Contacted", color: "bg-yellow-100 text-yellow-800" },
  { value: "meeting", label: "Meeting", color: "bg-purple-100 text-purple-800" },
  { value: "close_won", label: "Closed Won", color: "bg-green-100 text-green-800" },
  { value: "close_lost", label: "Closed Lost", color: "bg-red-100 text-red-800" },
  { value: "rejected", label: "Rejected", color: "bg-gray-100 text-gray-800" }
];

export default function ProspectDetails({ prospect, campaigns, onStatusUpdate, onClose, userRole }) {
  const [status, setStatus] = useState(prospect.status);
  const [notes, setNotes] = useState(prospect.notes || "");
  const [isUpdating, setIsUpdating] = useState(false);

  const campaign = campaigns.find(c => c.id === prospect.campaign_id);
  const currentStatus = statusOptions.find(s => s.value === status);

  const handleUpdate = async () => {
    setIsUpdating(true);
    try {
      await onStatusUpdate(prospect.id, status);
      onClose();
    } catch (error) {
      console.error('Error updating prospect:', error);
    }
    setIsUpdating(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{prospect.name}</h2>
          <p className="text-gray-600 mt-1">Prospect Details</p>
        </div>
        <Badge className={currentStatus?.color}>
          {currentStatus?.label}
        </Badge>
      </div>

      {/* Contact Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="w-5 h-5" />
            Contact Information
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                <p className="font-semibold">
                  {format(new Date(prospect.date_of_birth), 'dd/MM/yyyy')}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

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

      {/* Status Update */}
      {(userRole === 'admin' || userRole === 'agent') && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Update Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                Status
              </label>
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
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                Notes
              </label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes about this prospect..."
                rows={3}
              />
            </div>
            
            <div className="flex gap-3">
              <Button 
                onClick={handleUpdate}
                disabled={isUpdating || status === prospect.status}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Save className="w-4 h-4 mr-2" />
                {isUpdating ? 'Updating...' : 'Update'}
              </Button>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}