import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Plus, Search, Package, Edit, MoreHorizontal, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { LeadPackage } from '@/api/entities';
import { toast } from 'sonner';
import LeadPackageTemplateDialog from '@/components/lead-packages/LeadPackageTemplateDialog';

const AdminLeadPackages = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPackage, setEditingPackage] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: '',
    description: '',
    onConfirm: null,
    destructive: false,
  });

  const openConfirm = useCallback(({ title, description, onConfirm, destructive = true }) => {
    setConfirmDialog({ open: true, title, description, onConfirm, destructive });
  }, []);

  const closeConfirm = useCallback(() => {
    setConfirmDialog((prev) => ({ ...prev, open: false }));
  }, []);
  const queryClient = useQueryClient();

  const { data: packagesRaw, isLoading: loading } = useQuery({
    queryKey: ['leadPackages', 'list'],
    queryFn: () => LeadPackage.list(),
    select: (response) => response.packages || (Array.isArray(response) ? response : []),
  });
  const packages = packagesRaw ?? [];

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
        toast.success('Package updated successfully');
      } else {
        await LeadPackage.create(data);
        toast.success('Package created successfully');
      }
      queryClient.invalidateQueries({ queryKey: ['leadPackages'] });
    } catch (error) {
      console.error('Submit error:', error);
      throw error;
    }
  };

  const handleDeletePackage = (pkg) => {
    openConfirm({
      title: 'Delete Package',
      description: `Are you sure you want to delete "${pkg.name}"?`,
      onConfirm: async () => {
        try {
          await LeadPackage.delete(pkg.id);
          toast.success('Package deleted/archived successfully');
          queryClient.invalidateQueries({ queryKey: ['leadPackages'] });
        } catch (error) {
          console.error('Delete error:', error);
          toast.error('Failed to delete package');
        }
        closeConfirm();
      },
    });
  };

  const filteredPackages = packages.filter(
    (pkg) =>
      pkg.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      pkg.campaign?.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">Lead Packages</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Manage global package templates for agents.</p>
        </div>
        <Button onClick={handleCreatePackage} className="bg-blue-600 hover:bg-blue-700">
          <Plus className="w-4 h-4 mr-2" />
          Create Package
        </Button>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row gap-4 justify-between items-center">
          <div className="relative w-full sm:w-[300px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
            <Input
              placeholder="Search packages..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 focus:bg-white dark:focus:bg-gray-900 transition-colors"
            />
          </div>
        </div>

        <div className="min-h-[400px]">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50">
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
                      <Loader2 className="w-6 h-6 animate-spin text-blue-600 dark:text-blue-400" />
                    </div>
                  </TableCell>
                </TableRow>
              ) : filteredPackages.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-64 text-center text-gray-500 dark:text-gray-400">
                    <div className="flex flex-col items-center gap-2">
                      <Package className="w-8 h-8 text-gray-300 dark:text-gray-600" />
                      <p>No packages found</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredPackages.map((pkg) => (
                  <TableRow
                    key={pkg.id}
                    className="group hover:bg-blue-50/30 dark:hover:bg-blue-950/10 transition-colors"
                  >
                    <TableCell className="font-medium text-gray-900 dark:text-gray-100">{pkg.name}</TableCell>
                    <TableCell className="text-gray-600 dark:text-gray-400">{pkg.campaign?.name || 'N/A'}</TableCell>
                    <TableCell className="text-gray-900 dark:text-gray-100 font-medium">${pkg.price}</TableCell>
                    <TableCell className="text-gray-600 dark:text-gray-400">{pkg.leadCount}</TableCell>
                    <TableCell>
                      <Badge
                        className={
                          pkg.status === 'active'
                            ? 'bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-950/30'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                        }
                      >
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
                          <DropdownMenuItem
                            onClick={() => handleDeletePackage(pkg)}
                            className="text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-400"
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
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

      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => {
          if (!open) closeConfirm();
        }}
        title={confirmDialog.title}
        description={confirmDialog.description}
        onConfirm={confirmDialog.onConfirm}
        confirmText="Delete"
        destructive={confirmDialog.destructive}
      />
    </div>
  );
};

export default AdminLeadPackages;
