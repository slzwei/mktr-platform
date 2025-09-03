
import React, { useState } from "react";
import { QrTag } from "@/api/entities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, Tag, Loader2, CheckCircle } from "lucide-react";

// Simple UUID v4 alternative using crypto API or fallback
const generateUniqueId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

export default function PromotionalQRForm({ campaign, onQRGenerated }) {
  const [formData, setFormData] = useState({
    label: "",
    tagsInput: ""
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.label.trim()) {
      setError("Label is required");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const tags = Array.from(new Set(
        (formData.tagsInput || '')
          .split(/[,\n;]+/)
          .map(t => t.trim())
          .filter(Boolean)
      ));

      await QrTag.create({
        label: formData.label.trim(),
        tags,
        type: 'promo',
        campaignId: campaign.id
      });

      setSuccess(`Promotional QR code "${formData.label}" created successfully!`);
      setFormData({ label: "", tagsInput: "" });
      onQRGenerated();
    } catch (err) {
      console.error('Error creating promotional QR:', err);
      setError('Failed to create promotional QR code. Please try again.');
    }
    
    setLoading(false);
  };

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tag className="w-5 h-5" />
          Generate Promotional QR Code
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-blue-50 p-4 rounded-lg">
            <h3 className="font-semibold text-blue-900 mb-2">About Promotional QR Codes</h3>
            <p className="text-blue-700 text-sm">
              Promotional QR codes link directly to your campaign landing page and help you track 
              the performance of different marketing channels or locations.
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg">
              <AlertCircle className="w-5 h-5" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 text-green-600 bg-green-50 p-3 rounded-lg">
              <CheckCircle className="w-5 h-5" />
              <span>{success}</span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="label">Label *</Label>
            <Input
              id="label"
              value={formData.label}
              onChange={(e) => setFormData({...formData, label: e.target.value})}
              placeholder="e.g., Orchard Road Booth"
              maxLength={100}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags">Tags (comma or newline separated)</Label>
            <Textarea
              id="tags"
              value={formData.tagsInput}
              onChange={(e) => setFormData({...formData, tagsInput: e.target.value})}
              placeholder="Facebook, Instagram, Street Team"
              rows={3}
              maxLength={250}
            />
            <p className="text-sm text-gray-500">Multiple tags are supported; a single QR will include all tags for reporting.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (Optional)</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({...formData, description: e.target.value})}
              placeholder="Additional notes about this QR code..."
              rows={3}
              maxLength={250}
            />
          </div>

          <Button 
            type="submit" 
            disabled={loading || !formData.label.trim()}
            className="w-full bg-purple-600 hover:bg-purple-700"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Generating QR Code...
              </>
            ) : (
              <>
                <Tag className="w-4 h-4 mr-2" />
                Create Promotional QR Code
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
