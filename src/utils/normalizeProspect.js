/**
 * Shared normalizeProspect utility.
 *
 * Normalizes a backend prospect record into the flat UI shape expected by
 * tables, detail panels, and shared components. Merges field mappings from
 * AdminProspects, MyProspects and AdminAgentDetail so every consumer gets a
 * consistent object.
 */
export default function normalizeProspect(p) {
 const name = [p.firstName, p.lastName].filter(Boolean).join(" ") || p.name ||"";
 let status = (p.leadStatus || p.status ||"new").toLowerCase();

 const createdDate = p.createdAt || p.created_date || new Date().toISOString();

 // Map leadSource to simplified UI values used in filters / display
 const source = (p.leadSource || p.source ||"other").toLowerCase();
 let simplifiedSource ="other";
 if (source ==="qr_code") simplifiedSource ="qr";
 else if (source ==="website") simplifiedSource ="form";
 else if (source ==="call_bot") simplifiedSource ="call bot";
 else if (source) simplifiedSource = source;

 const assignedAgentId = p.assignedAgentId || p.assigned_agent_id ||"";
 const assignedAgentName = p.assignedAgent
 ? ([p.assignedAgent.firstName, p.assignedAgent.lastName].filter(Boolean).join(" ") || p.assignedAgent.email ||"Agent")
 : (p.assigned_agent_name ||"");

 return {
 id: p.id,
 firstName: p.firstName,
 lastName: p.lastName,
 name,
 phone: p.phone ||"",
 email: p.email ||"",
 company: p.company ||"",
 postal_code: p.location?.zipCode || p.postal_code ||"",
 date_of_birth: p.dateOfBirth || p.date_of_birth || null,
 status,
 leadStatus: status,
 created_date: createdDate,
 createdAt: createdDate,
 source: simplifiedSource,
 leadSource: p.leadSource || simplifiedSource,
 assigned_agent_id: assignedAgentId,
 assigned_agent_name: assignedAgentName,
 assignedAgentId: p.assignedAgentId,
 campaign_id: p.campaignId || p.campaign_id ||"",
 campaign: p.campaign,
 notes: p.notes,
 };
}
