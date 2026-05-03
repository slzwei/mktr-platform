import { Checkbox } from"@/components/ui/checkbox";
import {
 Table,
 TableBody,
 TableCell,
 TableHead,
 TableHeader,
 TableRow,
} from"@/components/ui/table";
import { Car as CarIcon } from"lucide-react";

export default function CarSelectionTable({
 filteredCars,
 totalCars,
 selectedCarIds,
 onCarToggle,
 getFleetOwnerName,
}) {
 return (
 <div className="border rounded-lg">
 <Table>
 <TableHeader>
 <TableRow className="bg-muted">
 <TableHead className="w-12">Select</TableHead>
 <TableHead>Plate Number</TableHead>
 <TableHead>Fleet Owner</TableHead>
 <TableHead>Current Driver</TableHead>
 </TableRow>
 </TableHeader>
 <TableBody>
 {filteredCars.map((car) => (
 <TableRow key={car.id} className="hover:bg-muted">
 <TableCell>
 <Checkbox
 checked={selectedCarIds.has(car.id)}
 onCheckedChange={() => onCarToggle(car.id)}
 />
 </TableCell>
 <TableCell className="font-semibold">
 {car.plate_number}
 </TableCell>
 <TableCell>
 {getFleetOwnerName(car.fleet_owner_id)}
 </TableCell>
 <TableCell className="text-muted-foreground">
 {car.current_driver_id || '-'}
 </TableCell>
 </TableRow>
 ))}
 </TableBody>
 </Table>

 {filteredCars.length === 0 && (
 <div className="text-center py-8">
 <CarIcon className="w-12 h-12 mx-auto mb-4 text-muted-foreground"/>
 <h3 className="font-semibold text-foreground mb-2">No cars found</h3>
 <p className="text-muted-foreground">
 {totalCars === 0
 ? 'No cars are registered in the system yet.'
 : 'Try adjusting your search or filter criteria.'
 }
 </p>
 </div>
 )}
 </div>
 );
}
