
import React, { useState, useEffect } from "react";
import { QrTag } from "@/api/entities";
import { Car } from "@/api/entities";
import { User } from "@/api/entities";
import { generateQrCodeImage } from "@/api/functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertCircle, Car as CarIcon, Search, Loader2, CheckCircle, Filter } from "lucide-react";

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

export default function CarQRSelection({ campaign, onQRGenerated }) {
  const [cars, setCars] = useState([]);
  const [fleetOwners, setFleetOwners] = useState([]);
  const [selectedCarIds, setSelectedCarIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [successCount, setSuccessCount] = useState(0); // New state for progress
  const [filters, setFilters] = useState({
    search: "",
    fleetOwner: "all"
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [carsData, ownersData] = await Promise.all([
        Car.list("-created_date"),
        User.filter({ role: "fleet_owner" })
      ]);
      setCars(carsData);
      setFleetOwners(ownersData);
    } catch (err) {
      console.error('Error loading cars:', err);
      setError('Failed to load car data');
    }
    setLoading(false);
  };

  const getFilteredCars = () => {
    let filtered = cars;

    // Search filter
    if (filters.search) {
      const search = filters.search.toLowerCase();
      filtered = filtered.filter(car =>
        car.plate_number?.toLowerCase().includes(search)
      );
    }

    // Fleet owner filter
    if (filters.fleetOwner !== "all") {
      filtered = filtered.filter(car => car.fleet_owner_id === filters.fleetOwner);
    }

    return filtered;
  };

  const handleCarToggle = (carId) => {
    setSelectedCarIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(carId)) {
        newSet.delete(carId);
      } else {
        newSet.add(carId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    const filteredCars = getFilteredCars();
    if (selectedCarIds.size === filteredCars.length) {
      // Unselect all
      setSelectedCarIds(new Set());
    } else {
      // Select all filtered cars
      setSelectedCarIds(new Set(filteredCars.map(car => car.id)));
    }
  };

  const handleGenerate = async () => { // Renamed from handleGenerateQRCodes
    if (selectedCarIds.size === 0) {
      setError("Please select at least one car");
      return;
    }

    setGenerating(true);
    setError(""); // Clear previous errors
    setSuccess(""); // Clear previous successes
    setSuccessCount(0); // Initialize success count for progress display

    let localSuccessCount = 0;
    let errorDuringGeneration = false; // Flag to indicate if any issue stopped the loop

    try {
      const carsToGenerate = cars.filter(car => selectedCarIds.has(car.id)); // Use selectedCarIds

      for (const car of carsToGenerate) {
        if (errorDuringGeneration) { // Stop if an error occurred in a previous iteration
          break;
        }
        try {
          // Generate unique code for each QR tag
          const uniqueCode = generateUniqueId();

          // Create the QR tag record
          const newQRTag = await QrTag.create({
            code: uniqueCode,
            type: 'car',
            campaign_id: campaign.id,
            car_id: car.id,
            is_active: true,
            scan_count: 0
          });

          // Generate the QR code image, passing the frontend's base URL
          const result = await generateQrCodeImage({
            qrTagId: newQRTag.id,
            baseUrl: window.location.origin
          });

          if (result.data.success) {
            localSuccessCount++;
            setSuccessCount(localSuccessCount); // Update state for progress display
          } else {
            // If image generation failed for this specific QR tag via API response
            setError(`Failed to generate QR image for car plate ${car.plate_number}. Reason: ${result.data.message || 'Unknown issue.'}`);
            errorDuringGeneration = true;
            break; // Stop on first failure, as per outline
          }
        } catch (err) {
          // Catching network errors or errors from QrTag.create/generateQrCodeImage calls
          console.error(`Error generating QR for car ${car.plate_number}:`, err);
          setError(`An unexpected error occurred while generating QR for car plate ${car.plate_number}. Details: ${err.message || 'Unknown error.'}`);
          errorDuringGeneration = true;
          break; // Stop on first exception
        }
      }

      if (!errorDuringGeneration) {
        // If the loop completed without any errors (either API reported failure or exception)
        if (localSuccessCount > 0) {
          setSuccess(`Successfully generated ${localSuccessCount} car QR code${localSuccessCount > 1 ? 's' : ''}!`);
          setSelectedCarIds(new Set()); // Clear selection only on full success
          onQRGenerated(); // Notify parent of successful generation
        } else {
          // This case should not be reachable if selectedCarIds.size > 0 and no error occurred.
          // It would mean selectedCars was empty, or successCount somehow wasn't incremented.
          setError("No QR codes were generated, even though no specific errors were reported. Please check inputs.");
        }
      }
      // If errorDuringGeneration is true, the specific error message has already been set by setError inside the loop.
      // We do not want to override it or show a mixed message.

    } catch (err) {
      // This outer catch block would only catch errors *before* the loop starts
      // (e.g., issue with `cars.filter` if `cars` was not an array, very unlikely)
      console.error('General error during car QR codes generation process:', err);
      setError('A general error occurred during the QR code generation process. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const filteredCars = getFilteredCars();
  const getFleetOwnerName = (ownerId) => {
    const owner = fleetOwners.find(o => o.id === ownerId);
    return owner?.full_name || owner?.company_name || 'Unknown Fleet';
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            <div className="h-4 bg-gray-200 rounded w-5/6"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CarIcon className="w-5 h-5" />
          Generate Car QR Codes
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <div className="bg-blue-50 p-4 rounded-lg">
            <h3 className="font-semibold text-blue-900 mb-2">About Car QR Codes</h3>
            <p className="text-blue-700 text-sm">
              Car QR codes are placed on vehicles and track leads generated through specific cars.
              Commissions are automatically calculated for drivers and fleet owners.
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

          {/* Filters */}
          <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search by plate number..."
                value={filters.search}
                onChange={(e) => setFilters({...filters, search: e.target.value})}
                className="pl-10"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-500" />
              <Select
                value={filters.fleetOwner}
                onValueChange={(value) => setFilters({...filters, fleetOwner: value})}
              >
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Fleets</SelectItem>
                  {fleetOwners.map((owner) => (
                    <SelectItem key={owner.id} value={owner.id}>
                      {owner.full_name || owner.company_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Selection Summary */}
          <div className="flex justify-between items-center p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                onClick={handleSelectAll}
                disabled={filteredCars.length === 0}
              >
                {selectedCarIds.size === filteredCars.length ? 'Unselect All' : 'Select All'}
              </Button>
              <span className="text-sm text-gray-600">
                {selectedCarIds.size} of {filteredCars.length} cars selected
              </span>
            </div>
            <Button
              onClick={handleGenerate} // Changed function call here
              disabled={selectedCarIds.size === 0 || generating}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating ({successCount} / {selectedCarIds.size})...
                </>
              ) : (
                <>
                  <CarIcon className="w-4 h-4 mr-2" />
                  Generate QR Codes ({selectedCarIds.size})
                </>
              )}
            </Button>
          </div>

          {/* Cars Table */}
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead className="w-12">Select</TableHead>
                  <TableHead>Plate Number</TableHead>
                  <TableHead>Fleet Owner</TableHead>
                  <TableHead>Current Driver</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCars.map((car) => (
                  <TableRow key={car.id} className="hover:bg-gray-50">
                    <TableCell>
                      <Checkbox
                        checked={selectedCarIds.has(car.id)}
                        onCheckedChange={() => handleCarToggle(car.id)}
                      />
                    </TableCell>
                    <TableCell className="font-semibold">
                      {car.plate_number}
                    </TableCell>
                    <TableCell>
                      {getFleetOwnerName(car.fleet_owner_id)}
                    </TableCell>
                    <TableCell className="text-gray-600">
                      {car.current_driver_id || '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {filteredCars.length === 0 && (
              <div className="text-center py-8">
                <CarIcon className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <h3 className="font-semibold text-gray-900 mb-2">No cars found</h3>
                <p className="text-gray-500">
                  {cars.length === 0
                    ? 'No cars are registered in the system yet.'
                    : 'Try adjusting your search or filter criteria.'
                  }
                </p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
