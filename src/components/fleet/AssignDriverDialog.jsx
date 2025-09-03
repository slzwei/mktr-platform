import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { UserCheck } from "lucide-react";

export default function AssignDriverDialog({ 
  open, 
  onOpenChange, 
  car, 
  drivers,
  onAssign
}) {
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!selectedDriverId && car?.current_driver_id) {
      // Unassigning driver
      setLoading(true);
      try {
        await onAssign(car.id, null);
        onOpenChange(false);
      } catch (error) {
        console.error("Failed to unassign driver:", error);
      }
      setLoading(false);
    } else if (selectedDriverId) {
      // Assigning driver
      setLoading(true);
      try {
        await onAssign(car.id, selectedDriverId);
        onOpenChange(false);
      } catch (error) {
        console.error("Failed to assign driver:", error);
      }
      setLoading(false);
    }
  };

  if (!car) return null;

  const availableDrivers = drivers.filter(driver => {
    // Show all driver_partner users - assignment logic is handled at car level
    return driver.role === 'driver_partner';
  });

  const currentDriver = drivers.find(d => d.id === car.current_driver_id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCheck className="w-5 h-5" />
            {car.current_driver_id ? "Reassign Driver" : "Assign Driver"}
          </DialogTitle>
          <DialogDescription>
            Vehicle: {car.plate_number}
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          {currentDriver && (
            <div className="p-3 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-800 mb-2">Currently Assigned To:</p>
              <div className="flex items-center gap-3">
                <Avatar className="w-8 h-8">
                  <AvatarFallback className="bg-blue-100 text-blue-700">
                    {currentDriver.full_name?.charAt(0)?.toUpperCase() || 'D'}
                  </AvatarFallback>
                </Avatar>
                <span className="font-semibold text-blue-900">
                  {currentDriver.full_name || 'Unknown Driver'}
                </span>
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="driver_select">
              {car.current_driver_id ? "Select New Driver (or leave empty to unassign)" : "Select Driver"}
            </Label>
            <Select 
              value={selectedDriverId} 
              onValueChange={setSelectedDriverId}
            >
              <SelectTrigger>
                <SelectValue placeholder={car.current_driver_id ? "Select new driver or unassign" : "Choose a driver"} />
              </SelectTrigger>
              <SelectContent>
                {car.current_driver_id && (
                  <SelectItem value={null}>
                    <span className="text-gray-500">Unassign current driver</span>
                  </SelectItem>
                )}
                {availableDrivers.map((driver) => (
                  <SelectItem key={driver.id} value={driver.id}>
                    <div className="flex items-center gap-2">
                      <Avatar className="w-6 h-6">
                        <AvatarFallback className="bg-gray-100 text-gray-700 text-xs">
                          {driver.full_name?.charAt(0)?.toUpperCase() || 'D'}
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-medium">{driver.full_name || driver.email}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {availableDrivers.length === 0 && !car.current_driver_id && (
            <div className="text-center py-4 text-gray-500">
              <p className="text-sm">No available drivers found.</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={loading || (!selectedDriverId && !car.current_driver_id)}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {loading ? "Processing..." : car.current_driver_id ? (selectedDriverId ? "Reassign" : "Unassign") : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}