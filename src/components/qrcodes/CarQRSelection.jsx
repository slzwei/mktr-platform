import { useState, useEffect } from "react";
import { QrTag, Car, User, Campaign } from "@/api/entities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, Car as CarIcon, Loader2, CheckCircle } from "lucide-react";
import CarFilterBar from "@/components/qrcodes/CarFilterBar";
import CarSelectionTable from "@/components/qrcodes/CarSelectionTable";
import ReassignConfirmDialog from "@/components/qrcodes/ReassignConfirmDialog";

export default function CarQRSelection({ campaign, onQRGenerated }) {
  const [cars, setCars] = useState([]);
  const [fleetOwners, setFleetOwners] = useState([]);
  const [selectedCarIds, setSelectedCarIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [successCount, setSuccessCount] = useState(0);
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

    if (filters.search) {
      const search = filters.search.toLowerCase();
      filtered = filtered.filter(car =>
        car.plate_number?.toLowerCase().includes(search)
      );
    }

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
      setSelectedCarIds(new Set());
    } else {
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
            <div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-3/4"></div>
            <div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-1/2"></div>
            <div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-5/6"></div>
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
          <div className="bg-blue-50 dark:bg-blue-950/30 p-4 rounded-lg">
            <h3 className="font-semibold text-blue-900 dark:text-blue-300 mb-2">About Car QR Codes</h3>
            <p className="text-blue-700 dark:text-blue-400 text-sm">
              Each car has one permanent QR code. Assigning links it to this campaign; reassigning keeps the same QR and slug and preserves analytics.
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 p-3 rounded-lg">
              <AlertCircle className="w-5 h-5" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 p-3 rounded-lg">
              <CheckCircle className="w-5 h-5" />
              <span>{success}</span>
            </div>
          )}

          <CarFilterBar
            filters={filters}
            onFiltersChange={setFilters}
            fleetOwners={fleetOwners}
          />

          {/* Selection Summary */}
          <div className="flex justify-between items-center p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                onClick={handleSelectAll}
                disabled={filteredCars.length === 0}
              >
                {selectedCarIds.size === filteredCars.length ? 'Unselect All' : 'Select All'}
              </Button>
              <span className="text-sm text-gray-600 dark:text-gray-400">
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

          <CarSelectionTable
            filteredCars={filteredCars}
            totalCars={cars.length}
            selectedCarIds={selectedCarIds}
            onCarToggle={handleCarToggle}
            getFleetOwnerName={getFleetOwnerName}
          />
        </div>

        <ReassignConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          precheck={precheck}
          campaignName={campaign.name}
          generating={generating}
          onConfirm={() => executeAssign([...precheck.toCreate, ...precheck.toReassign.map(x => x.car)])}
        />
      </CardContent>
    </Card>
  );
}
