import React, { useState, useEffect } from "react";
import { Plus, Search, Archive, Package, Edit, MoreHorizontal, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { LeadPackage } from "@/api/entities";
import { useToast } from "@/components/ui/use-toast";
import LeadPackageTemplateDialog from "@/components/lead-packages/LeadPackageTemplateDialog";

const AdminLeadPackages = () => {
    const [packages, setPackages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingPackage, setEditingPackage] = useState(null);
    const { toast } = useToast();

    useEffect(() => {
        loadPackages();
    }, []);

    const loadPackages = async () => {
        try {
            setLoading(true);
            const response = await LeadPackage.list();
            // Handle response format variations
            const list = response.packages || (Array.isArray(response) ? response : []);
            setPackages(list);
        } catch (error) {
            console.error("Failed to load packages:", error);
            toast({
                title: "Error",
                description: "Failed to load lead packages",
                variant: "destructive",
            });
        } finally {
            setLoading(false);
        }
    };

    const handleCreatePackage = () => {
        setEditingPackage(null);
        setIsDialogOpen(true);
    };

    const handleEditPackage = (pkg) => {
        setEditingPackage(pkg);
        setIsDialogOpen(true);
    };

    const handleSubmitPackage = async (data) => {
        try {
            if (editingPackage) {
                await LeadPackage.update(editingPackage.id, data);
                toast({ title: "Success", description: "Package updated successfully" });
            } else {
                await LeadPackage.create(data);
                toast({ title: "Success", description: "Package created successfully" });
            }
            loadPackages();
        } catch (error) {
            console.error("Submit error:", error);
            throw error; // Re-throw to be handled by the dialog
        }
    };

    const filteredPackages = packages.filter(pkg =>
        pkg.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        pkg.campaign?.name?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="p-6 max-w-[1600px] mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-gray-900">Lead Packages</h1>
                    <p className="text-gray-500 mt-1">Manage global package templates for agents.</p>
                </div>
                <Button onClick={handleCreatePackage} className="bg-blue-600 hover:bg-blue-700">
                    <Plus className="w-4 h-4 mr-2" />
                    Create Package
                </Button>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200">
                <div className="p-4 border-b border-gray-200 flex flex-col sm:flex-row gap-4 justify-between items-center">
                    <div className="relative w-full sm:w-[300px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <Input
                            placeholder="Search packages..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-9 bg-gray-50 border-gray-200 focus:bg-white transition-colors"
                        />
                    </div>
                </div>

                <div className="min-h-[400px]">
                    <Table>
                        <TableHeader>
                            <TableRow className="hover:bg-gray-50/50">
                                <TableHead className="w-[300px]">Package Name</TableHead>
                                <TableHead>Campaign</TableHead>
                                <TableHead>Price (SGD)</TableHead>
                                <TableHead>Leads</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="w-[100px] text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-24 text-center">
                                        <div className="flex justify-center items-center">
                                            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : filteredPackages.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-64 text-center text-gray-500">
                                        <div className="flex flex-col items-center gap-2">
                                            <Package className="w-8 h-8 text-gray-300" />
                                            <p>No packages found</p>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredPackages.map((pkg) => (
                                    <TableRow key={pkg.id} className="group hover:bg-blue-50/30 transition-colors">
                                        <TableCell className="font-medium text-gray-900">{pkg.name}</TableCell>
                                        <TableCell className="text-gray-600">{pkg.campaign?.name || 'N/A'}</TableCell>
                                        <TableCell className="text-gray-900 font-medium">${pkg.price}</TableCell>
                                        <TableCell className="text-gray-600">{pkg.leadCount}</TableCell>
                                        <TableCell>
                                            <Badge className={
                                                pkg.status === 'active' ? "bg-green-100 text-green-700 hover:bg-green-100" : "bg-gray-100 text-gray-700 hover:bg-gray-100"
                                            }>
                                                {pkg.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" className="h-8 w-8 p-0">
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => handleEditPackage(pkg)}>
                                                        <Edit className="w-4 h-4 mr-2" />
                                                        Edit details
                                                    </DropdownMenuItem>
                                                    {/* Add Archive functionality later if needed */}
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </div>

            <LeadPackageTemplateDialog
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                onSubmit={handleSubmitPackage}
                editingPackage={editingPackage}
            />
        </div>
    );
};

export default AdminLeadPackages;
