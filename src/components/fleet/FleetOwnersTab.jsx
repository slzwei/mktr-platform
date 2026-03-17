import React, { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { User } from "@/api/entities";
import { FleetOwner } from "@/api/entities";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Plus,
  Edit,
  Trash2,
  Search,
  Users,
  Mail,
  Phone,
  Building,
} from "lucide-react";

import FleetOwnerFormDialog from "./FleetOwnerFormDialog";

export default function FleetOwnersTab({ fleetOwners, fleetOwnerUsers, cars }) {
  const queryClient = useQueryClient();

  const [searchTerm, setSearchTerm] = useState("");
  const [isFleetOwnerFormOpen, setIsFleetOwnerFormOpen] = useState(false);
  const [selectedFleetOwner, setSelectedFleetOwner] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState({ open: false, title: "", description: "", onConfirm: null, destructive: false });

  const openConfirm = useCallback(({ title, description, onConfirm, destructive = true }) => {
    setConfirmDialog({ open: true, title, description, onConfirm, destructive });
  }, []);

  const closeConfirm = useCallback(() => {
    setConfirmDialog(prev => ({ ...prev, open: false }));
  }, []);

  const handleOpenFleetOwnerForm = (fleetOwner = null) => {
    setSelectedFleetOwner(fleetOwner);
    setIsFleetOwnerFormOpen(true);
  };

  const handleFleetOwnerFormSubmit = async (formData) => {
    try {
      if (selectedFleetOwner) {
        await FleetOwner.update(selectedFleetOwner.id, formData);
      } else {
        await FleetOwner.create(formData);
      }
      queryClient.invalidateQueries({ queryKey: ['fleetOwners'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
    } catch (error) {
      console.error("Failed to save fleet owner:", error);
      throw error;
    }
  };

  const handleDeleteFleetOwner = (fleetOwnerId) => {
    // Check if the fleet owner has any cars assigned before deleting
    const ownerCars = cars.filter(car => car.fleet_owner_id === fleetOwnerId);
    if (ownerCars.length > 0) {
      openConfirm({
        title: "Cannot Delete Fleet Owner",
        description: "This fleet owner has vehicles assigned. Please reassign or delete vehicles first.",
        onConfirm: closeConfirm,
        destructive: false,
      });
      return;
    }

    openConfirm({
      title: "Delete Fleet Owner",
      description: "Are you sure you want to delete this fleet owner? This action cannot be undone.",
      onConfirm: async () => {
        try {
          await FleetOwner.delete(fleetOwnerId);
          queryClient.invalidateQueries({ queryKey: ['fleetOwners'] });
          queryClient.invalidateQueries({ queryKey: ['users'] });
        } catch (error) {
          console.error("Failed to delete fleet owner:", error);
        }
        closeConfirm();
      },
    });
  };

  const filteredFleetOwners = fleetOwners.filter(owner =>
    owner.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    owner.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    owner.company_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <>
      <Card className="shadow-lg">
        <CardHeader className="border-b border-gray-100 dark:border-gray-700">
          <div className="flex justify-between items-center">
            <CardTitle className="flex items-center gap-2">
              <Users className="w-6 h-6" />
              Fleet Owners ({filteredFleetOwners.length})
            </CardTitle>
            <div className="flex gap-4 items-center">
              <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500 w-5 h-5" />
                <Input
                  placeholder="Search fleet owners..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Button
                onClick={() => handleOpenFleetOwnerForm()}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Plus className="w-5 h-5 mr-2" />
                Add Fleet Owner
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50 dark:bg-gray-800">
                  <TableHead className="w-[18%]">Fleet Owner</TableHead>
                  <TableHead className="w-[22%]">Contact Information</TableHead>
                  <TableHead className="w-[18%]">Company</TableHead>
                  <TableHead className="w-[12%]">Vehicles</TableHead>
                  <TableHead className="w-[10%]">Status</TableHead>
                  <TableHead className="w-[12%]">Approval</TableHead>
                  <TableHead className="w-[8%] text-right pr-4">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredFleetOwners.map((owner) => (
                  <FleetOwnerRow
                    key={owner.id}
                    owner={owner}
                    cars={cars}
                    fleetOwnerUsers={fleetOwnerUsers}
                    onEdit={handleOpenFleetOwnerForm}
                    onDelete={handleDeleteFleetOwner}
                    onApprove={async (userId) => { try { await User.setApprovalStatus(userId, 'approved'); queryClient.invalidateQueries({ queryKey: ['users'] }); } catch (e) { console.error(e); } }}
                    onReject={async (userId) => { try { await User.setApprovalStatus(userId, 'rejected'); queryClient.invalidateQueries({ queryKey: ['users'] }); } catch (e) { console.error(e); } }}
                  />
                ))}
              </TableBody>
            </Table>

            {filteredFleetOwners.length === 0 && (
              <div className="text-center py-12">
                <div className="w-12 h-12 mx-auto mb-4 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center">
                  <Users className="w-6 h-6 text-gray-400 dark:text-gray-500" />
                </div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  {searchTerm ? 'No fleet owners found' : 'No fleet owners yet'}
                </h3>
                <p className="text-gray-500 dark:text-gray-400">
                  {searchTerm ? 'Try adjusting your search' : 'Add your first fleet owner to get started'}
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <FleetOwnerFormDialog
        open={isFleetOwnerFormOpen}
        onOpenChange={setIsFleetOwnerFormOpen}
        fleetOwner={selectedFleetOwner}
        onSubmit={handleFleetOwnerFormSubmit}
      />

      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => { if (!open) closeConfirm(); }}
        title={confirmDialog.title}
        description={confirmDialog.description}
        onConfirm={confirmDialog.onConfirm}
        confirmText={confirmDialog.destructive ? "Delete" : "OK"}
        destructive={confirmDialog.destructive}
      />
    </>
  );
}

const FleetOwnerRow = React.memo(function FleetOwnerRow({
  owner, cars, fleetOwnerUsers, onEdit, onDelete, onApprove, onReject,
}) {
  const ownerVehicles = cars.filter(car => car.fleet_owner_id === owner.id);
  const foUser = fleetOwnerUsers.find(u => (u.email || '').toLowerCase() === (owner.email || '').toLowerCase());
  const approval = foUser?.approvalStatus || foUser?.status;
  const isPending = (approval === 'pending' || approval === 'pending_approval') && foUser;

  return (
    <TableRow className="hover:bg-gray-50 dark:hover:bg-gray-800">
      <TableCell>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 rounded-full flex items-center justify-center font-semibold">
            {owner.full_name?.charAt(0)?.toUpperCase() || 'F'}
          </div>
          <div>
            <p className="font-semibold text-gray-900 dark:text-gray-100">
              {owner.full_name || 'N/A'}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">ID: {owner.id.slice(-8)}</p>
            {owner.uen && (
              <p className="text-xs text-gray-400 dark:text-gray-500">UEN: {owner.uen}</p>
            )}
          </div>
        </div>
      </TableCell>

      <TableCell>
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm">
            <Mail className="w-4 h-4 text-gray-400 dark:text-gray-500" />
            {owner.email}
          </div>
          {owner.phone && (
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <Phone className="w-4 h-4 text-gray-400 dark:text-gray-500" />
              {owner.phone}
            </div>
          )}
          {owner.payout_method && (
            <div className="text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 px-2 py-1 rounded inline-block">
              {owner.payout_method}
            </div>
          )}
        </div>
      </TableCell>

      <TableCell>
        {owner.company_name ? (
          <div className="flex items-center gap-2">
            <Building className="w-4 h-4 text-gray-400 dark:text-gray-500" />
            <span className="text-sm">{owner.company_name}</span>
          </div>
        ) : (
          <span className="text-gray-400 dark:text-gray-500 italic">-</span>
        )}
      </TableCell>

      <TableCell>
        <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400">
          {ownerVehicles.length} vehicle{ownerVehicles.length !== 1 ? 's' : ''}
        </Badge>
      </TableCell>

      <TableCell>
        <Badge
          variant={owner.status === 'active' ? 'default' : 'outline'}
          className={owner.status === 'active' ? 'bg-green-100 dark:bg-green-950/30 text-green-800 dark:text-green-400' : 'bg-red-100 dark:bg-red-950/30 text-red-800 dark:text-red-400'}
        >
          {owner.status || 'active'}
        </Badge>
      </TableCell>

      <TableCell>
        {isPending ? (
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-green-700 hover:text-green-900"
              onClick={() => onApprove(foUser.id)}
            >
              Approve
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-red-700 hover:text-red-900"
              onClick={() => onReject(foUser.id)}
            >
              Reject
            </Button>
          </div>
        ) : (
          <span className="text-sm text-gray-500 dark:text-gray-400">{foUser?.approvalStatus || 'approved'}</span>
        )}
      </TableCell>

      <TableCell>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(owner)}
          >
            <Edit className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(owner.id)}
            className="text-red-600 hover:text-red-800"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
});
