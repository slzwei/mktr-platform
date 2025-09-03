
import { useState, useEffect } from "react";
import { QrTag } from "@/api/entities";
import { Car } from "@/api/entities";
import { User } from "@/api/entities";
import { Campaign } from "@/api/entities";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [precheck, setPrecheck] = useState({
    toCreate: [],
    alreadyOnCampaign: [],
    toReassign: [],
    campaignNames: {},
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

  const handleAssign = async () => {
    if (selectedCarIds.size === 0) {
      setError("Please select at least one car");
      return;
    }

    setError("");
    setSuccess("");

    try {
      const carsToProcess = cars.filter(car => selectedCarIds.has(car.id));
      const existingTags = await Promise.all(carsToProcess.map(async (car) => {
        const tags = await QrTag.filter({ carId: car.id, type: 'car' });
        return { car, tag: Array.isArray(tags) && tags.length > 0 ? tags[0] : null };
      }));

      const toCreate = [];
      const alreadyOnCampaign = [];
      const toReassign = [];

      for (const { car, tag } of existingTags) {
        if (!tag) {
          toCreate.push(car);
        } else if (tag.campaignId === campaign.id) {
          alreadyOnCampaign.push({ car, tag });
        } else if (tag.campaignId) {
          toReassign.push({ car, tag });
        } else {
          toCreate.push(car);
        }
      }

      const uniqueCampaignIds = [...new Set(toReassign.map(x => x.tag.campaignId).filter(Boolean))];
      const campaignNames = { [campaign.id]: campaign.name };
      for (const cid of uniqueCampaignIds) {
        try {
          const c = await Campaign.get(cid);
          if (c && c.name) campaignNames[cid] = c.name;
        } catch (e) {
          // ignore
        }
      }

      setPrecheck({ toCreate, alreadyOnCampaign, toReassign, campaignNames });

      if (toReassign.length > 0) {
        setConfirmOpen(true);
        return;
      }

      await executeAssign([...toCreate]);
    } catch (err) {
      console.error('Precheck error:', err);
      setError('Failed to review selected cars. Please try again.');
    }
  };

  const executeAssign = async (carsToProcess) => {
    setGenerating(true);
    setError("");
    setSuccess("");
    setSuccessCount(0);

    let localSuccessCount = 0;
    let errorDuring = false;

    try {
      for (const car of carsToProcess) {
        if (errorDuring) break;
        try {
          await QrTag.create({ type: 'car', campaignId: campaign.id, carId: car.id, label: car.plate_number });
          localSuccessCount++;
          setSuccessCount(localSuccessCount);
        } catch (err) {
          console.error(`Error assigning QR for car ${car.plate_number}:`, err);
          setError(`An error occurred while assigning QR for ${car.plate_number}. ${err.message || ''}`);
          errorDuring = true;
          break;
        }
      }

      if (!errorDuring) {
        if (localSuccessCount > 0) {
          setSuccess(`Successfully assigned QR to ${localSuccessCount} car${localSuccessCount > 1 ? 's' : ''}.`);
          setSelectedCarIds(new Set());
          onQRGenerated();
        } else {
          setError('No assignments were performed.');
        }
      }
    } catch (err) {
      console.error('Assignment error:', err);
      setError('A general error occurred during assignment.');
    } finally {
      setGenerating(false);
      setConfirmOpen(false);
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
          Assign QR Codes to Cars
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <div className="bg-blue-50 p-4 rounded-lg">
            <h3 className="font-semibold text-blue-900 mb-2">About Car QR Codes</h3>
            <p className="text-blue-700 text-sm">
              Each car has one permanent QR code. Assigning links it to this campaign; reassigning keeps the same QR and slug and preserves analytics.
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
              onClick={handleAssign}
              disabled={selectedCarIds.size === 0 || generating}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Assigning ({successCount} / {selectedCarIds.size})...
                </>
              ) : (
                <>
                  <CarIcon className="w-4 h-4 mr-2" />
                  Assign to Campaign ({selectedCarIds.size})
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

        {/* Reassignment confirmation */}
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm reassignment</AlertDialogTitle>
              <AlertDialogDescription>
                {precheck.toReassign.length} car{precheck.toReassign.length !== 1 ? 's' : ''} already have a QR assigned to another campaign.
                Proceeding will reassign them to "{campaign.name}". This keeps the same QR and link slug and preserves analytics.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="max-h-48 overflow-auto rounded border p-2 bg-gray-50 text-sm">
              {precheck.toReassign.map(({ car, tag }) => (
                <div key={car.id} className="flex justify-between py-1">
                  <span className="font-medium">{car.plate_number}</span>
                  <span className="text-gray-600">from {precheck.campaignNames[tag.campaignId] || tag.campaignId || 'Unknown'}</span>
                </div>
              ))}
              {precheck.alreadyOnCampaign.length > 0 && (
                <div className="mt-3 text-gray-600">
                  {precheck.alreadyOnCampaign.length} car{precheck.alreadyOnCampaign.length !== 1 ? 's are' : ' is'} already on this campaign and will be skipped.
                </div>
              )}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={generating}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => executeAssign([...precheck.toCreate, ...precheck.toReassign.map(x => x.car)])}
                disabled={generating}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {generating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Confirm and Assign
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
