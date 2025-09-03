import React, { useState, useEffect } from "react";
import { User } from "@/api/entities";
import { Car } from "@/api/entities";
import { FleetOwner } from "@/api/entities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  AlertTriangle,
  Car as CarIcon,
  Search,
  Calendar,
  UserCheck,
  UserX,
  Users,
  Mail,
  Phone,
  Building
} from "lucide-react";
import { format } from "date-fns";

import CarFormDialog from "../components/fleet/CarFormDialog";
import AssignDriverDialog from "../components/fleet/AssignDriverDialog";
import FleetOwnerFormDialog from "../components/fleet/FleetOwnerFormDialog";
import DriverFormDialog from "../components/fleet/DriverFormDialog";

export default function AdminFleet() {
  const [user, setUser] = useState(null);
  const [cars, setCars] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [fleetOwners, setFleetOwners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const [isCarFormOpen, setIsCarFormOpen] = useState(false);
  const [isFleetOwnerFormOpen, setIsFleetOwnerFormOpen] = useState(false);
  const [isDriverFormOpen, setIsDriverFormOpen] = useState(false);
  const [selectedCar, setSelectedCar] = useState(null);
  const [selectedFleetOwner, setSelectedFleetOwner] = useState(null);
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [isAssignDriverOpen, setIsAssignDriverOpen] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const userData = await User.me();
      setUser(userData);

      let fetchedCars = [];
      const [fetchedDrivers, fetchedFleetOwners] = await Promise.all([
        User.filter({ role: 'driver_partner' }),
        FleetOwner.list('-created_date')
      ]);

      if (userData.role === 'admin') {
        fetchedCars = await Car.list('-created_date');
      } else if (userData.role === 'fleet_owner') {
        // For fleet owners, we need to find cars that belong to their fleet owner record
        const userFleetOwner = fetchedFleetOwners.find(fo => fo.email === userData.email);
        if (userFleetOwner) {
          fetchedCars = await Car.filter({ fleet_owner_id: userFleetOwner.id });
        }
      } else if (userData.role === 'driver_partner') {
        fetchedCars = await Car.filter({ current_driver_id: userData.id });
      }

      setCars(fetchedCars);
      setDrivers(fetchedDrivers);
      setFleetOwners(fetchedFleetOwners);

    } catch (error) {
      console.error("Error loading fleet data:", error);
    }
    setLoading(false);
  };

  const handleOpenCarForm = (car = null) => {
    setSelectedCar(car);
    setIsCarFormOpen(true);
  };

  const handleOpenFleetOwnerForm = (fleetOwner = null) => {
    setSelectedFleetOwner(fleetOwner);
    setIsFleetOwnerFormOpen(true);
  };

  const handleOpenDriverForm = (driver = null) => {
    setSelectedDriver(driver);
    setIsDriverFormOpen(true);
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
        
        console.log('📝 Creating car with data:', dataToCreate);
        console.log('📝 Fleet owner ID being sent:', dataToCreate.fleet_owner_id);
        console.log('📝 All form data:', formData);
        await Car.create(dataToCreate);
      }
      await loadData();
    } catch (error) {
      console.error("Failed to save car:", error);
      throw error;
    }
  };

  const handleFleetOwnerFormSubmit = async (formData) => {
    try {
      if (selectedFleetOwner) {
        await FleetOwner.update(selectedFleetOwner.id, formData);
      } else {
        await FleetOwner.create(formData);
      }
      await loadData();
    } catch (error) {
      console.error("Failed to save fleet owner:", error);
      throw error;
    }
  };

  const handleDriverFormSubmit = async (formData) => {
    try {
      if (selectedDriver) {
        await User.update(selectedDriver.id, { ...formData, role: 'driver_partner' });
      } else {
        await User.create({ ...formData, role: 'driver_partner' });
      }
      await loadData();
    } catch (error) {
      console.error("Failed to save driver:", error);
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
      await loadData();
    } catch (error) {
      console.error("Failed to assign/unassign driver:", error);
      throw error;
    }
  };

  const handleDeleteCar = async (carId) => {
    if (window.confirm("Are you sure you want to delete this vehicle? This action cannot be undone.")) {
      try {
        await Car.delete(carId);
        await loadData();
      } catch (error) {
        console.error("Failed to delete car:", error);
      }
    }
  };

  const handleDeleteFleetOwner = async (fleetOwnerId) => {
    // Check if the fleet owner has any cars assigned before deleting
    const ownerCars = cars.filter(car => car.fleet_owner_id === fleetOwnerId);
    if (ownerCars.length > 0) {
      alert("Cannot delete fleet owner who has vehicles assigned. Please reassign or delete vehicles first.");
      return;
    }

    if (window.confirm("Are you sure you want to delete this fleet owner? This action cannot be undone.")) {
      try {
        await FleetOwner.delete(fleetOwnerId);
        await loadData();
      } catch (error) {
        console.error("Failed to delete fleet owner:", error);
      }
    }
  };

  const handleDeleteDriver = async (driverId) => {
    // Check if the driver is currently assigned to any cars
    const assignedCars = cars.filter(car => car.current_driver_id === driverId);
    if (assignedCars.length > 0) {
      alert("Cannot delete driver who is currently assigned to vehicles. Please unassign from vehicles first.");
      return;
    }

    if (window.confirm("Are you sure you want to delete this driver? This action cannot be undone.")) {
      try {
        await User.delete(driverId);
        await loadData();
      } catch (error) {
        console.error("Failed to delete driver:", error);
      }
    }
  };

  const getDriverName = (driverId) => {
    const driver = drivers.find(d => d.id === driverId);
    return driver ? `${driver.firstName} ${driver.lastName}` : "Unassigned";
  };

  const getFleetOwnerName = (ownerId) => {
    const owner = fleetOwners.find(o => o.id === ownerId);
    return owner ? owner.full_name : "Unknown";
  };

  const filteredCars = cars.filter(car =>
    car.plate_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    getDriverName(car.current_driver_id).toLowerCase().includes(searchTerm.toLowerCase()) ||
    getFleetOwnerName(car.fleet_owner_id).toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredFleetOwners = fleetOwners.filter(owner =>
    owner.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    owner.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    owner.company_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredDrivers = drivers.filter(driver =>
    `${driver.firstName} ${driver.lastName}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
    driver.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="p-6 lg:p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-64"></div>
          <div className="h-96 bg-gray-200 rounded-xl"></div>
        </div>
      </div>
    );
  }

  // Access control
  if (!user || !['admin', 'fleet_owner', 'driver_partner'].includes(user.role)) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-gray-50">
        <AlertTriangle className="w-16 h-16 text-yellow-500 mb-4" />
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Access Denied</h2>
        <p className="text-gray-600">You do not have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Fleet Management</h1>
            <p className="text-gray-600 mt-1">
              {user?.role === 'admin' && 'Manage fleet owners, vehicles and driver assignments'}
              {user?.role === 'fleet_owner' && 'Manage your vehicles and driver assignments'}
              {user?.role === 'driver_partner' && 'View your assigned vehicle'}
            </p>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Fleet Owners</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{fleetOwners.length}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Vehicles</CardTitle>
              <CarIcon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{cars.length}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Rented Vehicles</CardTitle>
              <UserCheck className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {cars.filter(car => car.current_driver_id).length}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Available Vehicles</CardTitle>
              <UserX className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {cars.filter(car => !car.current_driver_id).length}
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="vehicles" className="space-y-6">
          <TabsList>
            <TabsTrigger value="vehicles">Vehicles</TabsTrigger>
            {user?.role === 'admin' && (
              <>
                <TabsTrigger value="fleet-owners">Fleet Owners</TabsTrigger>
                <TabsTrigger value="drivers">Drivers</TabsTrigger>
              </>
            )}
          </TabsList>

          <TabsContent value="vehicles">
            <Card className="shadow-lg">
              <CardHeader className="border-b border-gray-100">
                <div className="flex justify-between items-center">
                  <CardTitle className="flex items-center gap-2">
                    <CarIcon className="w-6 h-6" />
                    Vehicle List ({filteredCars.length})
                  </CardTitle>
                  <div className="flex gap-4 items-center">
                    <div className="relative max-w-sm">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                      <Input
                        placeholder="Search vehicles..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                    {(user?.role === 'admin' || user?.role === 'fleet_owner') && (
                      <Button
                        onClick={() => handleOpenCarForm()}
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        <Plus className="w-5 h-5 mr-2" />
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
                      <TableRow className="bg-gray-50">
                        <TableHead>Vehicle Details</TableHead>
                        <TableHead>Fleet Owner</TableHead>
                        <TableHead>Current Driver</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Assignment Date</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCars.map((car) => (
                        <TableRow key={car.id} className="hover:bg-gray-50">
                          <TableCell>
                            <div>
                              <p className="font-semibold text-gray-900">{car.plate_number}</p>
                              {(car.make || car.model || car.year) && (
                                <p className="text-sm text-gray-500">
                                  {car.make} {car.model} {car.year && `(${car.year})`}
                                </p>
                              )}
                              {car.color && (
                                <p className="text-xs text-gray-400">{car.color}</p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-sm font-semibold">
                                {getFleetOwnerName(car.fleet_owner_id).charAt(0)}
                              </div>
                              <span className="font-medium">{getFleetOwnerName(car.fleet_owner_id)}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {car.current_driver_id ? (
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 bg-green-100 text-green-700 rounded-full flex items-center justify-center text-sm font-semibold">
                                  {getDriverName(car.current_driver_id).charAt(0)}
                                </div>
                                <span className="font-medium">{getDriverName(car.current_driver_id)}</span>
                              </div>
                            ) : (
                              <span className="text-gray-400 italic">Unassigned</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={car.current_driver_id ? "default" : "outline"}
                              className={car.current_driver_id ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}
                            >
                              {car.current_driver_id ? "Rented" : "Available"}
                            </Badge>
                            {car.status !== 'active' && (
                              <Badge variant="outline" className="ml-2 bg-yellow-100 text-yellow-800">
                                {car.status}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {car.assignment_start ? (
                              <div className="flex items-center gap-1 text-sm">
                                <Calendar className="w-3 h-3" />
                                {format(new Date(car.assignment_start), 'dd/MM/yyyy')}
                              </div>
                            ) : (
                              <span className="text-gray-400 text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              {(user?.role === 'admin' || 
                                (user?.role === 'fleet_owner' && fleetOwners.find(fo => fo.email === user.email)?.id === car.fleet_owner_id)) && (
                                <>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleOpenAssignDriver(car)}
                                  >
                                    {car.current_driver_id ? 'Reassign' : 'Assign Driver'}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleOpenCarForm(car)}
                                  >
                                    <Edit className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleDeleteCar(car.id)}
                                    className="text-red-600 hover:text-red-800"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  {filteredCars.length === 0 && (
                    <div className="text-center py-12">
                      <div className="w-12 h-12 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                        <CarIcon className="w-6 h-6 text-gray-400" />
                      </div>
                      <h3 className="font-semibold text-gray-900 mb-2">
                        {searchTerm ? 'No vehicles found' : 'No vehicles yet'}
                      </h3>
                      <p className="text-gray-500">
                        {searchTerm ? 'Try adjusting your search' : 'Add your first vehicle to get started'}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {user?.role === 'admin' && (
            <>
              <TabsContent value="fleet-owners">
                <Card className="shadow-lg">
                  <CardHeader className="border-b border-gray-100">
                    <div className="flex justify-between items-center">
                      <CardTitle className="flex items-center gap-2">
                        <Users className="w-6 h-6" />
                        Fleet Owners ({filteredFleetOwners.length})
                      </CardTitle>
                      <div className="flex gap-4 items-center">
                        <div className="relative max-w-sm">
                          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
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
                          <TableRow className="bg-gray-50">
                            <TableHead>Fleet Owner</TableHead>
                            <TableHead>Contact Information</TableHead>
                            <TableHead>Company</TableHead>
                            <TableHead>Vehicles</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredFleetOwners.map((owner) => {
                            const ownerVehicles = cars.filter(car => car.fleet_owner_id === owner.id);
                            return (
                              <TableRow key={owner.id} className="hover:bg-gray-50">
                                <TableCell>
                                  <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-semibold">
                                      {owner.full_name?.charAt(0)?.toUpperCase() || 'F'}
                                    </div>
                                    <div>
                                      <p className="font-semibold text-gray-900">
                                        {owner.full_name || 'N/A'}
                                      </p>
                                      <p className="text-sm text-gray-500">ID: {owner.id.slice(-8)}</p>
                                      {owner.uen && (
                                        <p className="text-xs text-gray-400">UEN: {owner.uen}</p>
                                      )}
                                    </div>
                                  </div>
                                </TableCell>
                                
                                <TableCell>
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-2 text-sm">
                                      <Mail className="w-4 h-4 text-gray-400" />
                                      {owner.email}
                                    </div>
                                    {owner.phone && (
                                      <div className="flex items-center gap-2 text-sm text-gray-600">
                                        <Phone className="w-4 h-4 text-gray-400" />
                                        {owner.phone}
                                      </div>
                                    )}
                                    {owner.payout_method && (
                                      <div className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded inline-block">
                                        {owner.payout_method}
                                      </div>
                                    )}
                                  </div>
                                </TableCell>

                                <TableCell>
                                  {owner.company_name ? (
                                    <div className="flex items-center gap-2">
                                      <Building className="w-4 h-4 text-gray-400" />
                                      <span className="text-sm">{owner.company_name}</span>
                                    </div>
                                  ) : (
                                    <span className="text-gray-400 italic">-</span>
                                  )}
                                </TableCell>

                                <TableCell>
                                  <Badge variant="outline" className="bg-blue-50 text-blue-700">
                                    {ownerVehicles.length} vehicle{ownerVehicles.length !== 1 ? 's' : ''}
                                  </Badge>
                                </TableCell>

                                <TableCell>
                                  <Badge 
                                    variant={owner.status === 'active' ? 'default' : 'outline'}
                                    className={owner.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}
                                  >
                                    {owner.status || 'active'}
                                  </Badge>
                                </TableCell>

                                <TableCell>
                                  <div className="flex gap-2">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleOpenFleetOwnerForm(owner)}
                                    >
                                      <Edit className="w-4 h-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleDeleteFleetOwner(owner.id)}
                                      className="text-red-600 hover:text-red-800"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>

                      {filteredFleetOwners.length === 0 && (
                        <div className="text-center py-12">
                          <div className="w-12 h-12 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                            <Users className="w-6 h-6 text-gray-400" />
                          </div>
                          <h3 className="font-semibold text-gray-900 mb-2">
                            {searchTerm ? 'No fleet owners found' : 'No fleet owners yet'}
                          </h3>
                          <p className="text-gray-500">
                            {searchTerm ? 'Try adjusting your search' : 'Add your first fleet owner to get started'}
                          </p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="drivers">
                <Card className="shadow-lg">
                  <CardHeader className="border-b border-gray-100">
                    <div className="flex justify-between items-center">
                      <CardTitle className="flex items-center gap-2">
                        <Users className="w-6 h-6" />
                        Drivers ({filteredDrivers.length})
                      </CardTitle>
                      <div className="flex gap-4 items-center">
                        <div className="relative max-w-sm">
                          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                          <Input
                            placeholder="Search drivers..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10"
                          />
                        </div>
                        <Button
                          onClick={() => handleOpenDriverForm()}
                          className="bg-blue-600 hover:bg-blue-700"
                        >
                          <Plus className="w-5 h-5 mr-2" />
                          Add Driver
                        </Button>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-gray-50">
                            <TableHead>Driver</TableHead>
                            <TableHead>Contact Information</TableHead>
                            <TableHead>Assigned Vehicle</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredDrivers.map((driver) => {
                            const assignedCar = cars.find(car => car.current_driver_id === driver.id);
                            return (
                              <TableRow key={driver.id} className="hover:bg-gray-50">
                                <TableCell>
                                  <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-green-100 text-green-700 rounded-full flex items-center justify-center font-semibold">
                                      {driver.firstName?.charAt(0)?.toUpperCase() || 'D'}
                                    </div>
                                    <div>
                                      <p className="font-semibold text-gray-900">
                                        {`${driver.firstName} ${driver.lastName}` || 'N/A'}
                                      </p>
                                      <p className="text-sm text-gray-500">ID: {driver.id.slice(-8)}</p>
                                    </div>
                                  </div>
                                </TableCell>
                                
                                <TableCell>
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-2 text-sm">
                                      <Mail className="w-4 h-4 text-gray-400" />
                                      {driver.email}
                                    </div>
                                    {driver.phone && (
                                      <div className="flex items-center gap-2 text-sm text-gray-600">
                                        <Phone className="w-4 h-4 text-gray-400" />
                                        {driver.phone}
                                      </div>
                                    )}
                                  </div>
                                </TableCell>

                                <TableCell>
                                  {assignedCar ? (
                                    <div className="flex items-center gap-2">
                                      <CarIcon className="w-4 h-4 text-gray-400" />
                                      <span className="text-sm font-medium">{assignedCar.plate_number}</span>
                                    </div>
                                  ) : (
                                    <span className="text-gray-400 italic">No vehicle assigned</span>
                                  )}
                                </TableCell>

                                <TableCell>
                                  <Badge 
                                    variant={assignedCar ? 'default' : 'outline'}
                                    className={assignedCar ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}
                                  >
                                    {assignedCar ? 'Active' : 'Available'}
                                  </Badge>
                                </TableCell>

                                <TableCell>
                                  <div className="flex gap-2">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleOpenDriverForm(driver)}
                                    >
                                      <Edit className="w-4 h-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleDeleteDriver(driver.id)}
                                      className="text-red-600 hover:text-red-800"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>

                      {filteredDrivers.length === 0 && (
                        <div className="text-center py-12">
                          <div className="w-12 h-12 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                            <Users className="w-6 h-6 text-gray-400" />
                          </div>
                          <h3 className="font-semibold text-gray-900 mb-2">
                            {searchTerm ? 'No drivers found' : 'No drivers yet'}
                          </h3>
                          <p className="text-gray-500">
                            {searchTerm ? 'Try adjusting your search' : 'Add your first driver to get started'}
                          </p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </>
          )}
        </Tabs>

        {/* Dialogs */}
        <CarFormDialog
          open={isCarFormOpen}
          onOpenChange={setIsCarFormOpen}
          car={selectedCar}
          onSubmit={handleCarFormSubmit}
          fleetOwners={fleetOwners}
          currentUserRole={user?.role}
          currentUserId={user?.id}
        />

        <FleetOwnerFormDialog
          open={isFleetOwnerFormOpen}
          onOpenChange={setIsFleetOwnerFormOpen}
          fleetOwner={selectedFleetOwner}
          onSubmit={handleFleetOwnerFormSubmit}
        />

        <DriverFormDialog
          open={isDriverFormOpen}
          onOpenChange={setIsDriverFormOpen}
          driver={selectedDriver}
          onSubmit={handleDriverFormSubmit}
        />

        <AssignDriverDialog
          open={isAssignDriverOpen}
          onOpenChange={setIsAssignDriverOpen}
          car={selectedCar}
          drivers={drivers}
          onAssign={handleAssignDriver}
        />
      </div>
    </div>
  );
}
