
import { useState, useEffect } from "react";
import { User } from "@/api/entities";
import { auth, agents as agentsAPI } from "@/api/client";
import { LeadPackage } from "@/api/entities"; // Assuming LeadPackage entity exists
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";


import { 
  Plus, 
  Edit, 
  Eye,
  Search,
  AlertTriangle,
  Phone,
  Mail,
  Package // Import Package icon
} from "lucide-react";
import { format } from "date-fns";

import AgentFormDialog from "../components/agents/AgentFormDialog";
import AgentDetailsDialog from "../components/agents/AgentDetailsDialog";
import LeadPackageDialog from "../components/agents/LeadPackageDialog";

export default function AdminAgents() {
  const [user, setUser] = useState(null);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isPackageDialogOpen, setIsPackageDialogOpen] = useState(false); // New state for package dialog
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [userData, agentsData] = await Promise.all([
        auth.getCurrentUser(),
        agentsAPI.getAll()
      ]);

      setUser(userData);
      setAgents(agentsData?.agents || []);
    } catch (error) {
      console.error('Error loading agents:', error);
    }
    setLoading(false);
  };

  const handleOpenForm = (agent = null) => {
    setSelectedAgent(agent);
    setIsFormOpen(true);
  };

  const handleFormSubmit = async (formData) => {
    try {
      // Normalize fields to backend schema
      const name = (formData.full_name || '').trim();
      const [firstName, ...rest] = name.split(' ');
      const lastName = rest.join(' ').trim() || '-';
      const isActive = (formData.status || 'active') === 'active';

      if (selectedAgent) {
        await User.update(selectedAgent.id, {
          firstName,
          lastName,
          email: formData.email,
          phone: formData.phone,
          isActive,
          owed_leads_count: parseInt(formData.owed_leads_count) || 0
        });
      } else {
        // Create new agent using User entity
        await User.create({
          email: formData.email,
          firstName,
          lastName,
          phone: formData.phone,
          role: 'agent',
          isActive,
          owed_leads_count: parseInt(formData.owed_leads_count) || 0
        });
      }
      
      await loadData();
      setIsFormOpen(false);
      setSelectedAgent(null);
    } catch (error) {
      console.error('Error saving agent:', error);
    }
  };

  const handleOpenDetails = (agent) => {
    setSelectedAgent(agent);
    setIsDetailsOpen(true);
  };

  // New function to open lead package dialog
  const handleOpenPackageDialog = (agent) => {
    setSelectedAgent(agent);
    setIsPackageDialogOpen(true);
  };

  // New function to handle lead package submission
  const handlePackageSubmit = async (packageData) => {
    try {
      // Assuming LeadPackage.create exists and is correctly implemented
      await LeadPackage.create(packageData); 
      await loadData(); // Refresh agent data after package creation
      setIsPackageDialogOpen(false);
      setSelectedAgent(null);
    } catch (error) {
      console.error('Error creating lead package:', error);
    }
  };

  const filteredAgents = agents.filter(agent => 
    agent.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    agent.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    agent.phone?.includes(searchTerm)
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

  if (user?.role !== 'admin') {
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
            <h1 className="text-3xl font-bold text-gray-900">Admin - Agent Management</h1>
            <p className="text-gray-600 mt-1">
              Manage your sales agents and their information.
            </p>
          </div>
          <Button onClick={() => handleOpenForm()} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="w-5 h-5 mr-2" />
            Add Agent
          </Button>
        </div>

        <Card className="shadow-lg">
          <CardHeader className="border-b border-gray-100">
            <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <Input
                  placeholder="Search agents..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </CardHeader>
          
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead>Agent</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Leads Owed</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAgents.map((agent) => (
                    <TableRow key={agent.id} className="hover:bg-gray-50">
                      <TableCell>
                        <div>
                          <p className="font-semibold text-gray-900">{agent.fullName || `${agent.firstName || ''} ${agent.lastName || ''}`.trim()}</p>
                          <p className="text-sm text-gray-500">Agent ID: {agent.id.slice(-8)}</p>
                        </div>
                      </TableCell>
                      
                      <TableCell>
                        <div className="space-y-1 text-sm">
                          <div className="flex items-center gap-1 text-gray-600">
                            <Mail className="w-3 h-3" />
                            {agent.email}
                          </div>
                          {agent.phone && (
                            <div className="flex items-center gap-1 text-gray-500">
                              <Phone className="w-3 h-3" />
                              {agent.phone}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      
                      <TableCell>
                        <Badge className={agent.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
                          {agent.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      
                      <TableCell>
                        <span className="font-semibold">{agent.owed_leads_count || 0}</span>
                      </TableCell>
                      
                      <TableCell>
                        <span className="text-sm text-gray-600">
                          {agent.createdAt ? format(new Date(agent.createdAt), 'dd/MM/yyyy') : '-'}
                        </span>
                      </TableCell>
                      
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenDetails(agent)}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenForm(agent)}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          {/* New button for lead package dialog */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenPackageDialog(agent)}
                            className="text-blue-600 hover:text-blue-800"
                          >
                            <Package className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              
              {filteredAgents.length === 0 && (
                <div className="text-center py-12">
                  <div className="w-12 h-12 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                    <Search className="w-6 h-6 text-gray-400" />
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-2">No agents found</h3>
                  <p className="text-gray-500">Try adjusting your search or add new agents</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <AgentFormDialog
          open={isFormOpen}
          onOpenChange={setIsFormOpen}
          agent={selectedAgent}
          onSubmit={handleFormSubmit}
        />

        <AgentDetailsDialog
          open={isDetailsOpen}
          onOpenChange={setIsDetailsOpen}
          agent={selectedAgent}
        />

        {/* New LeadPackageDialog component */}
        <LeadPackageDialog
          open={isPackageDialogOpen}
          onOpenChange={setIsPackageDialogOpen}
          agent={selectedAgent}
          onSubmit={handlePackageSubmit}
        />
      </div>
    </div>
  );
}
