import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { useToast } from "@/components/ui/use-toast";
import { Users, Plus, Pencil, Trash2, Loader2, Search, X } from "lucide-react";

export default function AdminAgentGroups() {
    const { toast } = useToast();
    const qc = useQueryClient();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingGroup, setEditingGroup] = useState(null);
    const [saving, setSaving] = useState(false);

    // Form state
    const [formName, setFormName] = useState("");
    const [formDescription, setFormDescription] = useState("");
    const [formAgents, setFormAgents] = useState([]);

    // Agent search
    const [agentSearch, setAgentSearch] = useState("");

    const { data: groups = [], isLoading: loading } = useQuery({
        queryKey: ['admin', 'agent-groups'],
        queryFn: async () => {
            const res = await apiClient.get('/admin/agent-groups');
            return res.data || [];
        },
    });

    const { data: lyfeAgents = [] } = useQuery({
        queryKey: ['lyfe', 'agents'],
        queryFn: async () => {
            const res = await apiClient.get('/lyfe/agents');
            return res.data || [];
        },
    });

    const openCreateDialog = () => {
        setEditingGroup(null);
        setFormName("");
        setFormDescription("");
        setFormAgents([]);
        setAgentSearch("");
        setDialogOpen(true);
    };

    const openEditDialog = (group) => {
        setEditingGroup(group);
        setFormName(group.name);
        setFormDescription(group.description || "");
        setFormAgents(group.members || []);
        setAgentSearch("");
        setDialogOpen(true);
    };

    const handleSave = async () => {
        if (!formName.trim()) return;
        setSaving(true);

        try {
            const body = {
                name: formName.trim(),
                description: formDescription.trim() || null,
                agents: formAgents
            };

            if (editingGroup) {
                await apiClient.put(`/admin/agent-groups/${editingGroup.id}`, body);
                toast({ title: "Success", description: "Agent group updated" });
            } else {
                await apiClient.post('/admin/agent-groups', body);
                toast({ title: "Success", description: "Agent group created" });
            }

            setDialogOpen(false);
            qc.invalidateQueries({ queryKey: ['admin', 'agent-groups'] });
        } catch (err) {
            toast({ title: "Error", description: err.message || "Failed to save group", variant: "destructive" });
        }
        setSaving(false);
    };

    const handleDelete = async (groupId) => {
        try {
            await apiClient.delete(`/admin/agent-groups/${groupId}`);
            toast({ title: "Success", description: "Agent group deleted" });
            qc.invalidateQueries({ queryKey: ['admin', 'agent-groups'] });
        } catch (err) {
            const msg = err.response?.data?.message || "Failed to delete group";
            toast({ title: "Error", description: msg, variant: "destructive" });
        }
    };

    const addAgent = (agent) => {
        if (!formAgents.some(a => a.phone === agent.phone)) {
            setFormAgents(prev => [...prev, {
                phone: agent.phone,
                email: agent.email,
                name: agent.name,
                lyfeId: agent.id
            }]);
        }
        setAgentSearch("");
    };

    const removeAgent = (phone) => {
        setFormAgents(prev => prev.filter(a => a.phone !== phone));
    };

    const filteredLyfeAgents = lyfeAgents.filter(a =>
        (a.name || '').toLowerCase().includes(agentSearch.toLowerCase()) ||
        (a.phone || '').includes(agentSearch)
    ).slice(0, 10);

    return (
        <div className="p-6 lg:p-8 max-w-5xl mx-auto">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <Users className="w-6 h-6" />
                        Agent Groups
                    </h1>
                    <p className="text-muted-foreground">Manage groups of agents for round-robin lead assignment.</p>
                </div>
                <Button onClick={openCreateDialog}>
                    <Plus className="w-4 h-4 mr-2" />
                    Create Group
                </Button>
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin" />
                </div>
            ) : groups.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center">
                        <Users className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                        <p className="text-muted-foreground">No agent groups yet. Create one to get started.</p>
                    </CardContent>
                </Card>
            ) : (
                <Card>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Agents</TableHead>
                                <TableHead>Description</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {groups.map(group => (
                                <TableRow key={group.id}>
                                    <TableCell className="font-medium">{group.name}</TableCell>
                                    <TableCell>
                                        <Badge variant="secondary">{(group.members || []).length} agents</Badge>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground text-sm">
                                        {group.description || "-"}
                                    </TableCell>
                                    <TableCell className="text-right space-x-2">
                                        <Button variant="ghost" size="sm" onClick={() => openEditDialog(group)}>
                                            <Pencil className="w-4 h-4" />
                                        </Button>
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="ghost" size="sm" className="text-red-600">
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>Delete Agent Group</AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        Are you sure you want to delete "{group.name}"? This cannot be undone.
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                    <AlertDialogAction onClick={() => handleDelete(group.id)}>
                                                        Delete
                                                    </AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </Card>
            )}

            {/* Create / Edit Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editingGroup ? "Edit Agent Group" : "Create Agent Group"}</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Group Name *</Label>
                            <Input
                                value={formName}
                                onChange={(e) => setFormName(e.target.value)}
                                placeholder="e.g., Q1 Roadshow Team"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Description</Label>
                            <Textarea
                                value={formDescription}
                                onChange={(e) => setFormDescription(e.target.value)}
                                placeholder="Optional notes about this group..."
                                rows={2}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Agents ({formAgents.length})</Label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <Input
                                    className="pl-9"
                                    value={agentSearch}
                                    onChange={(e) => setAgentSearch(e.target.value)}
                                    placeholder="Search agents by name or phone..."
                                />
                            </div>

                            {agentSearch && (
                                <div className="border rounded-md max-h-40 overflow-y-auto">
                                    {filteredLyfeAgents.length > 0 ? filteredLyfeAgents.map(agent => (
                                        <button
                                            key={agent.id || agent.phone}
                                            type="button"
                                            className="w-full text-left px-3 py-2 hover:bg-accent text-sm flex justify-between"
                                            onClick={() => addAgent(agent)}
                                        >
                                            <span>{agent.name}</span>
                                            <span className="text-muted-foreground">{agent.phone}</span>
                                        </button>
                                    )) : (
                                        <p className="px-3 py-2 text-sm text-muted-foreground">No agents found</p>
                                    )}
                                </div>
                            )}

                            {formAgents.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {formAgents.map(agent => (
                                        <Badge key={agent.phone} variant="secondary" className="flex items-center gap-1">
                                            {agent.name || agent.phone}
                                            <button type="button" onClick={() => removeAgent(agent.phone)}>
                                                <X className="w-3 h-3" />
                                            </button>
                                        </Badge>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleSave} disabled={saving || !formName.trim()}>
                            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                            {editingGroup ? "Update" : "Create"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
