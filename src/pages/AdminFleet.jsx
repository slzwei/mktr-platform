import { useQuery } from"@tanstack/react-query";
import { User } from"@/api/entities";
import { Car } from"@/api/entities";
import { FleetOwner } from"@/api/entities";
import { useCurrentUser } from"@/hooks/queries/useUsersQuery";
import { Card, CardContent, CardHeader, CardTitle } from"@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from"@/components/ui/tabs";
import { apiClient } from"@/api/client";
import {
 Car as CarIcon,
 UserCheck,
 UserX,
 Users,
} from"lucide-react";

import CarsTab from"../components/fleet/CarsTab";
import DriversTab from"../components/fleet/DriversTab";
import FleetOwnersTab from"../components/fleet/FleetOwnersTab";

export default function AdminFleet() {
 const { data: user } = useCurrentUser();

 const { data: driversRaw } = useQuery({
 queryKey: ['users', 'drivers'],
 queryFn: () => User.filter({ role: 'driver_partner' }),
 enabled: !!user,
 });
 const drivers = Array.isArray(driversRaw) ? driversRaw : (driversRaw?.users || []);

 const { data: fleetOwnersRaw } = useQuery({
 queryKey: ['fleetOwners', 'list'],
 queryFn: () => FleetOwner.list({ sort: '-created_date', limit: 100 }),
 enabled: !!user,
 });
 const fleetOwners = Array.isArray(fleetOwnersRaw) ? fleetOwnersRaw : (fleetOwnersRaw?.fleetOwners || []);

 const { data: foUsersResp } = useQuery({
 queryKey: ['users', 'fleet-owners'],
 queryFn: () => apiClient.get('/users', { role: 'fleet_owner', page: 1, limit: 200 }).catch(() => ({ data: { users: [] } })),
 enabled: !!user,
 });
 const fleetOwnerUsers = foUsersResp?.data?.users || [];

 const { data: carsRaw, isLoading: carsLoading } = useQuery({
 queryKey: ['cars', 'fleet-page', user?.role, user?.id],
 queryFn: async () => {
 if (user.role === 'admin') {
 const data = await Car.list({ sort: '-created_date', limit: 500 });
 return Array.isArray(data) ? data : (data.cars || []);
 } else if (user.role === 'fleet_owner') {
 const foData = await FleetOwner.list({ sort: '-created_date', limit: 100 });
 const foList = Array.isArray(foData) ? foData : (foData.fleetOwners || []);
 const userFo = foList.find(fo => fo.email === user.email);
 if (userFo) {
 const data = await Car.filter({ fleet_owner_id: userFo.id });
 return Array.isArray(data) ? data : (data.cars || []);
 }
 return [];
 } else if (user.role === 'driver_partner') {
 const data = await Car.filter({ current_driver_id: user.id });
 return Array.isArray(data) ? data : (data.cars || []);
 }
 return [];
 },
 enabled: !!user,
 });
 const cars = carsRaw ?? [];
 const loading = !user || carsLoading;

 if (loading) {
 return (
 <div className="p-6 lg:p-8">
 <div className="animate-pulse space-y-6">
 <div className="h-8 bg-muted rounded w-64"></div>
 <div className="h-96 bg-muted rounded-xl"></div>
 </div>
 </div>
 );
 }

 // Role gating handled by ProtectedRoute; avoid double-deny here

 return (
 <div className="p-6 lg:p-8 min-h-screen bg-background">
 <div className="max-w-7xl mx-auto">
 <div className="flex justify-between items-center mb-8">
 <div>
 <h1 className="text-3xl font-bold text-foreground">Fleet Management</h1>
 <p className="text-muted-foreground mt-1">
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
 <Users className="h-4 w-4 text-muted-foreground"/>
 </CardHeader>
 <CardContent>
 <div className="text-2xl font-bold">{fleetOwners.length}</div>
 </CardContent>
 </Card>

 <Card>
 <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
 <CardTitle className="text-sm font-medium">Total Vehicles</CardTitle>
 <CarIcon className="h-4 w-4 text-muted-foreground"/>
 </CardHeader>
 <CardContent>
 <div className="text-2xl font-bold">{cars.length}</div>
 </CardContent>
 </Card>

 <Card>
 <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
 <CardTitle className="text-sm font-medium">Rented Vehicles</CardTitle>
 <UserCheck className="h-4 w-4 text-muted-foreground"/>
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
 <UserX className="h-4 w-4 text-muted-foreground"/>
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
 <CarsTab cars={cars} drivers={drivers} fleetOwners={fleetOwners} />
 </TabsContent>

 {user?.role === 'admin' && (
 <>
 <TabsContent value="fleet-owners">
 <FleetOwnersTab fleetOwners={fleetOwners} fleetOwnerUsers={fleetOwnerUsers} cars={cars} />
 </TabsContent>

 <TabsContent value="drivers">
 <DriversTab drivers={drivers} cars={cars} />
 </TabsContent>
 </>
 )}
 </Tabs>
 </div>
 </div>
 );
}
