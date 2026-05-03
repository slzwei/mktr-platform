import React, { useState, useCallback } from"react";
import { useQueryClient } from"@tanstack/react-query";
import { User } from"@/api/entities";
import { ConfirmDialog } from"@/components/ConfirmDialog";
import { Card, CardContent, CardHeader, CardTitle } from"@/components/ui/card";
import { Button } from"@/components/ui/button";
import { Badge } from"@/components/ui/badge";
import { Input } from"@/components/ui/input";
import {
 Table,
 TableBody,
 TableCell,
 TableHead,
 TableHeader,
 TableRow,
} from"@/components/ui/table";
import {
 Plus,
 Edit,
 Trash2,
 Car as CarIcon,
 Search,
 Users,
 Mail,
 Phone,
} from"lucide-react";

import DriverFormDialog from"./DriverFormDialog";

export default function DriversTab({ drivers, cars }) {
 const queryClient = useQueryClient();

 const [searchTerm, setSearchTerm] = useState("");
 const [isDriverFormOpen, setIsDriverFormOpen] = useState(false);
 const [selectedDriver, setSelectedDriver] = useState(null);
 const [confirmDialog, setConfirmDialog] = useState({ open: false, title:"", description:"", onConfirm: null, destructive: false });

 const openConfirm = useCallback(({ title, description, onConfirm, destructive = true }) => {
 setConfirmDialog({ open: true, title, description, onConfirm, destructive });
 }, []);

 const closeConfirm = useCallback(() => {
 setConfirmDialog(prev => ({ ...prev, open: false }));
 }, []);

 const handleOpenDriverForm = (driver = null) => {
 setSelectedDriver(driver);
 setIsDriverFormOpen(true);
 };

 const handleDriverFormSubmit = async (formData) => {
 try {
 if (selectedDriver) {
 await User.update(selectedDriver.id, { ...formData, role: 'driver_partner' });
 } else {
 await User.create({ ...formData, role: 'driver_partner' });
 }
 queryClient.invalidateQueries({ queryKey: ['users', 'drivers'] });
 } catch (error) {
 console.error("Failed to save driver:", error);
 throw error;
 }
 };

 const handleDeleteDriver = (driverId) => {
 // Check if the driver is currently assigned to any cars
 const assignedCars = cars.filter(car => car.current_driver_id === driverId);
 if (assignedCars.length > 0) {
 openConfirm({
 title:"Cannot Delete Driver",
 description:"This driver is currently assigned to vehicles. Please unassign from vehicles first.",
 onConfirm: closeConfirm,
 destructive: false,
 });
 return;
 }

 openConfirm({
 title:"Delete Driver",
 description:"Are you sure you want to delete this driver? This action cannot be undone.",
 onConfirm: async () => {
 try {
 await User.delete(driverId);
 queryClient.invalidateQueries({ queryKey: ['users', 'drivers'] });
 } catch (error) {
 console.error("Failed to delete driver:", error);
 }
 closeConfirm();
 },
 });
 };

 const filteredDrivers = drivers.filter(driver =>
 `${driver.firstName} ${driver.lastName}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
 driver.email?.toLowerCase().includes(searchTerm.toLowerCase())
 );

 return (
 <>
 <Card className="shadow-lg">
 <CardHeader className="border-b border-border">
 <div className="flex justify-between items-center">
 <CardTitle className="flex items-center gap-2">
 <Users className="w-6 h-6"/>
 Drivers ({filteredDrivers.length})
 </CardTitle>
 <div className="flex gap-4 items-center">
 <div className="relative max-w-sm">
 <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-5 h-5"/>
 <Input
 placeholder="Search drivers..." value={searchTerm}
 onChange={(e) => setSearchTerm(e.target.value)}
 className="pl-10" />
 </div>
 <Button
 onClick={() => handleOpenDriverForm()}
 className="bg-primary hover:bg-primary/90" >
 <Plus className="w-5 h-5 mr-2"/>
 Add Driver
 </Button>
 </div>
 </div>
 </CardHeader>

 <CardContent className="p-0">
 <div className="overflow-x-auto">
 <Table>
 <TableHeader>
 <TableRow className="bg-muted">
 <TableHead className="w-[22%]">Driver</TableHead>
 <TableHead className="w-[24%]">Contact Information</TableHead>
 <TableHead className="w-[18%]">Assigned Vehicle</TableHead>
 <TableHead className="w-[12%]">Status</TableHead>
 <TableHead className="w-[16%]">Approval</TableHead>
 <TableHead className="w-[8%] text-right pr-4">Actions</TableHead>
 </TableRow>
 </TableHeader>
 <TableBody>
 {filteredDrivers.map((driver) => (
 <DriverRow
 key={driver.id}
 driver={driver}
 cars={cars}
 onEdit={handleOpenDriverForm}
 onDelete={handleDeleteDriver}
 onApprove={async (id) => { try { await User.setApprovalStatus(id, 'approved'); queryClient.invalidateQueries({ queryKey: ['users'] }); } catch (e) { console.error(e); } }}
 onReject={async (id) => { try { await User.setApprovalStatus(id, 'rejected'); queryClient.invalidateQueries({ queryKey: ['users'] }); } catch (e) { console.error(e); } }}
 />
 ))}
 </TableBody>
 </Table>

 {filteredDrivers.length === 0 && (
 <div className="text-center py-12">
 <div className="w-12 h-12 mx-auto mb-4 bg-muted rounded-full flex items-center justify-center">
 <Users className="w-6 h-6 text-muted-foreground"/>
 </div>
 <h3 className="font-semibold text-foreground mb-2">
 {searchTerm ? 'No drivers found' : 'No drivers yet'}
 </h3>
 <p className="text-muted-foreground">
 {searchTerm ? 'Try adjusting your search' : 'Add your first driver to get started'}
 </p>
 </div>
 )}
 </div>
 </CardContent>
 </Card>

 <DriverFormDialog
 open={isDriverFormOpen}
 onOpenChange={setIsDriverFormOpen}
 driver={selectedDriver}
 onSubmit={handleDriverFormSubmit}
 />

 <ConfirmDialog
 open={confirmDialog.open}
 onOpenChange={(open) => { if (!open) closeConfirm(); }}
 title={confirmDialog.title}
 description={confirmDialog.description}
 onConfirm={confirmDialog.onConfirm}
 confirmText={confirmDialog.destructive ?"Delete":"OK"}
 destructive={confirmDialog.destructive}
 />
 </>
 );
}

const DriverRow = React.memo(function DriverRow({ driver, cars, onEdit, onDelete, onApprove, onReject }) {
 const assignedCar = cars.find(car => car.current_driver_id === driver.id);
 const isPending = driver.approvalStatus === 'pending' || driver.status === 'pending_approval';

 return (
 <TableRow className="hover:bg-muted">
 <TableCell>
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 bg-success/15 text-success rounded-full flex items-center justify-center font-semibold">
 {driver.firstName?.charAt(0)?.toUpperCase() || 'D'}
 </div>
 <div>
 <p className="font-semibold text-foreground">
 {[driver.firstName, driver.lastName].filter(Boolean).join(' ') || 'N/A'}
 </p>
 <p className="text-sm text-muted-foreground">ID: {driver.id.slice(-8)}</p>
 </div>
 </div>
 </TableCell>

 <TableCell>
 <div className="space-y-1">
 <div className="flex items-center gap-2 text-sm">
 <Mail className="w-4 h-4 text-muted-foreground"/>
 {driver.email}
 </div>
 {driver.phone && (
 <div className="flex items-center gap-2 text-sm text-muted-foreground">
 <Phone className="w-4 h-4 text-muted-foreground"/>
 {driver.phone}
 </div>
 )}
 </div>
 </TableCell>

 <TableCell>
 {assignedCar ? (
 <div className="flex items-center gap-2">
 <CarIcon className="w-4 h-4 text-muted-foreground"/>
 <span className="text-sm font-medium">{assignedCar.plate_number}</span>
 </div>
 ) : (
 <span className="text-muted-foreground italic">No vehicle assigned</span>
 )}
 </TableCell>

 <TableCell>
 <Badge
 variant={assignedCar ? 'default' : 'outline'}
 className={assignedCar ? 'bg-success/15 text-success' : 'bg-muted text-foreground'}
 >
 {assignedCar ? 'Active' : 'Available'}
 </Badge>
 </TableCell>

 <TableCell>
 {isPending ? (
 <div className="flex gap-2">
 <Button
 variant="ghost" size="sm" className="text-success hover:text-success" onClick={() => onApprove(driver.id)}
 >
 Approve
 </Button>
 <Button
 variant="ghost" size="sm" className="text-destructive hover:text-destructive/80" onClick={() => onReject(driver.id)}
 >
 Reject
 </Button>
 </div>
 ) : (
 <span className="text-sm text-muted-foreground">{driver.approvalStatus || 'approved'}</span>
 )}
 </TableCell>

 <TableCell className="text-right pr-4">
 <div className="flex justify-end gap-2">
 <Button
 variant="ghost" size="sm" onClick={() => onEdit(driver)}
 >
 <Edit className="w-4 h-4"/>
 </Button>
 <Button
 variant="ghost" size="sm" onClick={() => onDelete(driver.id)}
 className="text-destructive hover:text-destructive" >
 <Trash2 className="w-4 h-4"/>
 </Button>
 </div>
 </TableCell>
 </TableRow>
 );
});
