import React, { useState, useCallback } from"react";
import { useQueryClient } from"@tanstack/react-query";
import { Car } from"@/api/entities";
import { useCurrentUser } from"@/hooks/queries/useUsersQuery";
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
 Calendar,
} from"lucide-react";
import { format } from"date-fns";

import CarFormDialog from"./CarFormDialog";
import AssignDriverDialog from"./AssignDriverDialog";

export default function CarsTab({ cars, drivers, fleetOwners }) {
 const queryClient = useQueryClient();
 const { data: user } = useCurrentUser();

 const [searchTerm, setSearchTerm] = useState("");
 const [isCarFormOpen, setIsCarFormOpen] = useState(false);
 const [selectedCar, setSelectedCar] = useState(null);
 const [isAssignDriverOpen, setIsAssignDriverOpen] = useState(false);
 const [confirmDialog, setConfirmDialog] = useState({ open: false, title:"", description:"", onConfirm: null, destructive: false });

 const openConfirm = useCallback(({ title, description, onConfirm, destructive = true }) => {
 setConfirmDialog({ open: true, title, description, onConfirm, destructive });
 }, []);

 const closeConfirm = useCallback(() => {
 setConfirmDialog(prev => ({ ...prev, open: false }));
 }, []);

 const handleOpenCarForm = (car = null) => {
 setSelectedCar(car);
 setIsCarFormOpen(true);
 };

 const handleOpenAssignDriver = (car) => {
 setSelectedCar(car);
 setIsAssignDriverOpen(true);
 };

 const handleCarFormSubmit = async (formData) => {
 try {
 if (selectedCar) {
 await Car.update(selectedCar.id, formData);
 } else {
 // For fleet owners, find their fleet owner record
 let dataToCreate = { ...formData };
 if (user.role === 'fleet_owner') {
 const userFleetOwner = fleetOwners.find(fo => fo.email === user.email);
 if (userFleetOwner) {
 dataToCreate.fleet_owner_id = userFleetOwner.id;
 } else {
 throw new Error("Fleet owner profile not found. Please contact administrator.");
 }
 }

 // Validate required fields for admin users
 if (user.role === 'admin' && !dataToCreate.fleet_owner_id) {
 throw new Error("Please select a fleet owner for this vehicle.");
 }

 await Car.create(dataToCreate);
 }
 queryClient.invalidateQueries({ queryKey: ['cars'] });
 } catch (error) {
 console.error("Failed to save car:", error);
 throw error;
 }
 };

 const handleAssignDriver = async (carId, driverId) => {
 try {
 const updateData = {
 current_driver_id: driverId,
 assignment_start: driverId ? new Date().toISOString() : null,
 assignment_end: driverId ? null : new Date().toISOString()
 };

 await Car.update(carId, updateData);
 queryClient.invalidateQueries({ queryKey: ['cars'] });
 } catch (error) {
 console.error("Failed to assign/unassign driver:", error);
 throw error;
 }
 };

 const handleDeleteCar = (carId) => {
 openConfirm({
 title:"Delete Vehicle",
 description:"Are you sure you want to delete this vehicle? This action cannot be undone.",
 onConfirm: async () => {
 try {
 await Car.delete(carId);
 queryClient.invalidateQueries({ queryKey: ['cars'] });
 } catch (error) {
 console.error("Failed to delete car:", error);
 }
 closeConfirm();
 },
 });
 };

 const getDriverName = (driverId) => {
 const driver = drivers.find(d => d.id === driverId);
 return driver ? `${driver.firstName} ${driver.lastName}` :"Unassigned";
 };

 const getFleetOwnerName = (ownerId) => {
 const owner = fleetOwners.find(o => o.id === ownerId);
 return owner ? owner.full_name :"Unknown";
 };

 const filteredCars = cars.filter(car =>
 car.plate_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
 getDriverName(car.current_driver_id).toLowerCase().includes(searchTerm.toLowerCase()) ||
 getFleetOwnerName(car.fleet_owner_id).toLowerCase().includes(searchTerm.toLowerCase())
 );

 return (
 <>
 <Card className="shadow-lg">
 <CardHeader className="border-b border-border">
 <div className="flex justify-between items-center">
 <CardTitle className="flex items-center gap-2">
 <CarIcon className="w-6 h-6"/>
 Vehicle List ({filteredCars.length})
 </CardTitle>
 <div className="flex gap-4 items-center">
 <div className="relative max-w-sm">
 <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-5 h-5"/>
 <Input
 placeholder="Search vehicles..." value={searchTerm}
 onChange={(e) => setSearchTerm(e.target.value)}
 className="pl-10" />
 </div>
 {(user?.role === 'admin' || user?.role === 'fleet_owner') && (
 <Button
 onClick={() => handleOpenCarForm()}
 className="bg-primary hover:bg-primary/90" >
 <Plus className="w-5 h-5 mr-2"/>
 Add Vehicle
 </Button>
 )}
 </div>
 </div>
 </CardHeader>

 <CardContent className="p-0">
 <div className="overflow-x-auto">
 <Table>
 <TableHeader>
 <TableRow className="bg-muted">
 <TableHead className="w-[18%]">Vehicle Details</TableHead>
 <TableHead className="w-[18%]">Fleet Owner</TableHead>
 <TableHead className="w-[18%]">Current Driver</TableHead>
 <TableHead className="w-[12%]">Status</TableHead>
 <TableHead className="w-[14%]">Assignment Date</TableHead>
 <TableHead className="w-[20%] text-right pr-4">Actions</TableHead>
 </TableRow>
 </TableHeader>
 <TableBody>
 {filteredCars.map((car) => (
 <CarRow
 key={car.id}
 car={car}
 getDriverName={getDriverName}
 getFleetOwnerName={getFleetOwnerName}
 userRole={user?.role}
 userEmail={user?.email}
 fleetOwners={fleetOwners}
 onAssignDriver={handleOpenAssignDriver}
 onEditCar={handleOpenCarForm}
 onDeleteCar={handleDeleteCar}
 />
 ))}
 </TableBody>
 </Table>

 {filteredCars.length === 0 && (
 <div className="text-center py-12">
 <div className="w-12 h-12 mx-auto mb-4 bg-muted rounded-full flex items-center justify-center">
 <CarIcon className="w-6 h-6 text-muted-foreground"/>
 </div>
 <h3 className="font-semibold text-foreground mb-2">
 {searchTerm ? 'No vehicles found' : 'No vehicles yet'}
 </h3>
 <p className="text-muted-foreground">
 {searchTerm ? 'Try adjusting your search' : 'Add your first vehicle to get started'}
 </p>
 </div>
 )}
 </div>
 </CardContent>
 </Card>

 <CarFormDialog
 open={isCarFormOpen}
 onOpenChange={setIsCarFormOpen}
 car={selectedCar}
 onSubmit={handleCarFormSubmit}
 fleetOwners={fleetOwners}
 currentUserRole={user?.role}
 currentUserId={user?.id}
 />

 <AssignDriverDialog
 open={isAssignDriverOpen}
 onOpenChange={setIsAssignDriverOpen}
 car={selectedCar}
 drivers={drivers}
 onAssign={handleAssignDriver}
 />

 <ConfirmDialog
 open={confirmDialog.open}
 onOpenChange={(open) => { if (!open) closeConfirm(); }}
 title={confirmDialog.title}
 description={confirmDialog.description}
 onConfirm={confirmDialog.onConfirm}
 confirmText="Delete" destructive={confirmDialog.destructive}
 />
 </>
 );
}

const CarRow = React.memo(function CarRow({
 car, getDriverName, getFleetOwnerName, userRole, userEmail, fleetOwners,
 onAssignDriver, onEditCar, onDeleteCar,
}) {
 const canManage = userRole === 'admin' ||
 (userRole === 'fleet_owner' && fleetOwners.find(fo => fo.email === userEmail)?.id === car.fleet_owner_id);

 return (
 <TableRow className="hover:bg-muted">
 <TableCell>
 <div>
 <p className="font-semibold text-foreground">{car.plate_number}</p>
 {(car.make || car.model || car.year) && (
 <p className="text-sm text-muted-foreground">
 {car.make} {car.model} {car.year && `(${car.year})`}
 </p>
 )}
 {car.color && (
 <p className="text-xs text-muted-foreground">{car.color}</p>
 )}
 </div>
 </TableCell>
 <TableCell>
 <div className="flex items-center gap-2">
 <div className="w-8 h-8 bg-info/15 text-primary rounded-full flex items-center justify-center text-sm font-semibold">
 {getFleetOwnerName(car.fleet_owner_id).charAt(0)}
 </div>
 <span className="font-medium">{getFleetOwnerName(car.fleet_owner_id)}</span>
 </div>
 </TableCell>
 <TableCell>
 {car.current_driver_id ? (
 <div className="flex items-center gap-2">
 <div className="w-8 h-8 bg-success/15 text-success rounded-full flex items-center justify-center text-sm font-semibold">
 {getDriverName(car.current_driver_id).charAt(0)}
 </div>
 <span className="font-medium">{getDriverName(car.current_driver_id)}</span>
 </div>
 ) : (
 <span className="text-muted-foreground italic">Unassigned</span>
 )}
 </TableCell>
 <TableCell>
 <Badge
 variant={car.current_driver_id ?"default":"outline"}
 className={car.current_driver_id ?"bg-success/15 text-success":"bg-muted text-foreground"}
 >
 {car.current_driver_id ?"Rented":"Available"}
 </Badge>
 {Boolean(car.status && car.status !== 'active') && (
 <Badge variant="outline" className="ml-2 bg-warning/15 text-warning">
 {car.status}
 </Badge>
 )}
 </TableCell>
 <TableCell>
 {car.assignment_start ? (
 <div className="flex items-center gap-1 text-sm">
 <Calendar className="w-3 h-3"/>
 {format(new Date(car.assignment_start), 'dd/MM/yyyy')}
 </div>
 ) : (
 <span className="text-muted-foreground text-sm">-</span>
 )}
 </TableCell>
 <TableCell className="text-right pr-4">
 <div className="flex items-center justify-end gap-2">
 {canManage && (
 <>
 <Button
 variant="outline" size="sm" onClick={() => onAssignDriver(car)}
 className="w-32 justify-center whitespace-nowrap" >
 {car.current_driver_id ? 'Reassign' : 'Assign Driver'}
 </Button>
 <Button
 variant="ghost" size="sm" onClick={() => onEditCar(car)}
 >
 <Edit className="w-4 h-4"/>
 </Button>
 <Button
 variant="ghost" size="sm" onClick={() => onDeleteCar(car.id)}
 className="text-destructive hover:text-destructive" >
 <Trash2 className="w-4 h-4"/>
 </Button>
 </>
 )}
 </div>
 </TableCell>
 </TableRow>
 );
});
