import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable,
} from '@dnd-kit/core';
import { toast } from 'sonner';
import { redeemOpsApi } from '@/api/redeemOps';
import { useAuthStore } from '@/stores/authStore';
import AlertTriangle from 'lucide-react/icons/alert-triangle';
import { RoAvatar, prettyEnum } from '@/components/redeemops/ui';

const PIPELINE_KEY = ['redeem-ops', 'team-pipeline'];

/* Stage → lane dot colour (same six families as RoStageTag). */
const STAGE_DOT = {
  CLAIMED: 'var(--ro-tag-gray-fg)',
  RESEARCHING: 'var(--ro-tag-gray-fg)',
  CONTACTED: 'var(--ro-tag-yellow-fg)',
  REPLIED: 'var(--ro-tag-blue-fg)',
  MEETING_BOOKED: 'var(--ro-tag-blue-fg)',
  MEETING_COMPLETED: 'var(--ro-tag-blue-fg)',
  PROPOSAL_SENT: 'var(--ro-tag-purple-fg)',
  NEGOTIATING: 'var(--ro-tag-purple-fg)',
  PARTNERED: 'var(--ro-tag-green-fg)',
  FOLLOW_UP_LATER: 'var(--ro-tag-yellow-fg)',
  NO_RESPONSE: 'var(--ro-tag-yellow-fg)',
  NOT_INTERESTED: 'var(--ro-tag-gray-fg)',
  DISQUALIFIED: 'var(--ro-tag-red-fg)',
};

/* Phase scoping — each chip fits its stages on one screen. */
const PHASES = {
  active: {
    label: 'Active',
    stages: ['CLAIMED', 'RESEARCHING', 'CONTACTED', 'REPLIED', 'MEETING_BOOKED', 'MEETING_COMPLETED', 'PROPOSAL_SENT', 'NEGOTIATING', 'PARTNERED'],
  },
  prospecting: { label: 'Prospecting', stages: ['CLAIMED', 'RESEARCHING'] },
  conversation: { label: 'Conversation', stages: ['CONTACTED', 'REPLIED', 'NO_RESPONSE', 'FOLLOW_UP_LATER'] },
  momentum: { label: 'Momentum', stages: ['MEETING_BOOKED', 'MEETING_COMPLETED', 'PROPOSAL_SENT', 'NEGOTIATING'] },
  closed: { label: 'Closed', stages: ['PARTNERED', 'NOT_INTERESTED', 'DISQUALIFIED'] },
};

function partnerName(p) {
  return p.tradingName || p.brandName || p.legalName;
}

function timeInStage(p) {
  const since = p.stageSince || p.claimedAt || p.lastActivityAt;
  if (!since) return null;
  const ms = Date.now() - new Date(since).getTime();
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return 'now';
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Mirrors partnerService.canActOnRow — managers move any card, execs their own. */
function canDragCard(user, p) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (['super_admin', 'ops_admin', 'bdm'].includes(user.redeemOpsRole)) return true;
  return p.ownerUserId === user.id;
}

function CardInner({ p, dragging }) {
  const t = timeInStage(p);
  return (
    <div
      className={`bg-white border border-border rounded-xl px-3 py-2.5 select-none ${dragging ? 'shadow-2xl rotate-2 cursor-grabbing' : ''}`}
    >
      <p className="text-[13.5px] font-semibold m-0 leading-tight flex items-center gap-1.5">
        <span className="truncate">{partnerName(p)}</span>
        {(p.atRiskFlag || p.staleFlag) && (
          <AlertTriangle className="w-3 h-3 shrink-0" style={{ color: 'var(--ro-tag-yellow-fg)' }} aria-hidden="true" />
        )}
      </p>
      {p.category && (
        <p className="text-[11.5px] m-0 mt-0.5 truncate" style={{ color: 'var(--ro-text-2)' }}>{p.category}</p>
      )}
      <div className="flex items-center gap-1.5 mt-2">
        {p.owner?.fullName ? (
          <>
            <RoAvatar name={p.owner.fullName} size={20} />
            <span className="text-[11px]" style={{ color: 'var(--ro-text-3)' }}>
              {p.owner.fullName.split(/\s+/)[0]}{t ? ` · ${t}` : ''}
            </span>
          </>
        ) : (
          <span className="text-[11px]" style={{ color: 'var(--ro-text-3)' }}>Unowned{t ? ` · ${t}` : ''}</span>
        )}
      </div>
    </div>
  );
}

function BoardCard({ p, draggable, onOpen }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: p.id,
    data: { partner: p },
    disabled: !draggable,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onOpen(p.id)}
      className={draggable ? 'cursor-grab' : 'cursor-pointer'}
      style={{ opacity: isDragging ? 0.35 : 1, touchAction: 'none' }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(p.id); }}
    >
      <CardInner p={p} />
    </div>
  );
}

function Lane({ stage, items, activeCard, legalTargets, collapsed, onExpand, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const isSource = activeCard?.pipelineStage === stage;
  const isLegal = !!activeCard && legalTargets.includes(stage);
  const dimmed = !!activeCard && !isLegal && !isSource;

  if (collapsed && !isOver) {
    return (
      <button
        ref={setNodeRef}
        type="button"
        onClick={onExpand}
        className="w-11 flex-none rounded-2xl flex flex-col items-center gap-2 py-3 border-0 cursor-pointer transition-opacity"
        style={{
          background: isLegal ? 'var(--ro-azure-tint, #EFF6FF)' : 'var(--ro-subtle)',
          opacity: dimmed ? 0.45 : 1,
          outline: isLegal ? '2px dashed var(--ro-azure)' : 'none',
          outlineOffset: '-2px',
        }}
        title={`${prettyEnum(stage)} — expand`}
      >
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: STAGE_DOT[stage] }} />
        <span
          className="text-[11.5px] font-bold"
          style={{ writingMode: 'vertical-rl', color: 'var(--ro-text-2)' }}
        >
          {prettyEnum(stage)}
        </span>
        <span className="text-[10.5px] font-bold bg-white border border-border rounded-full px-1.5" style={{ color: 'var(--ro-text-2)' }}>
          {items.length}
        </span>
      </button>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className="w-[250px] flex-none rounded-2xl flex flex-col min-h-0 transition-opacity"
      style={{
        background: isOver && isLegal ? '#EFF6FF' : 'var(--ro-subtle)',
        opacity: dimmed ? 0.45 : 1,
        outline: isOver && isLegal ? '2px dashed var(--ro-azure)' : 'none',
        outlineOffset: '-2px',
      }}
    >
      <div className="flex items-center gap-2 px-3.5 pt-3 pb-2">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: STAGE_DOT[stage] }} />
        <span className="text-[12.5px] font-bold">{prettyEnum(stage)}</span>
        <span className="ml-auto text-[11px] font-bold bg-white border border-border rounded-full px-2 py-px" style={{ color: 'var(--ro-text-2)' }}>
          {items.length}
        </span>
      </div>
      <div className="px-2 pb-2.5 flex flex-col gap-2 overflow-y-auto min-h-[56px]">
        {children}
      </div>
    </div>
  );
}

export default function TeamPipeline() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [phase, setPhase] = useState('active');
  const [expanded, setExpanded] = useState({});
  const [activeCard, setActiveCard] = useState(null);

  const constants = useQuery({
    queryKey: ['redeem-ops', 'constants'],
    queryFn: redeemOpsApi.getConstants,
    staleTime: Infinity,
  });
  const boardQuery = useQuery({ queryKey: PIPELINE_KEY, queryFn: redeemOpsApi.getTeamPipeline });

  const stageMutation = useMutation({
    mutationFn: ({ partnerId, toStage }) => redeemOpsApi.changeStage(partnerId, toStage),
    onError: (err) => {
      toast.error('Move rejected', { description: err.message });
      queryClient.invalidateQueries({ queryKey: PIPELINE_KEY });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PIPELINE_KEY }),
  });

  // 6px of movement before a drag starts, so plain clicks still open the record.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const transitions = constants.data?.stageTransitions || {};
  const partners = boardQuery.data?.partners || [];

  const byStage = useMemo(() => {
    const map = {};
    for (const p of partners) {
      (map[p.pipelineStage] = map[p.pipelineStage] || []).push(p);
    }
    return map;
  }, [partners]);

  const stages = PHASES[phase].stages;
  const legalTargets = activeCard ? (transitions[activeCard.pipelineStage] || []) : [];

  const handleDragEnd = ({ over }) => {
    const card = activeCard;
    setActiveCard(null);
    if (!card || !over) return;
    const toStage = String(over.id);
    if (toStage === card.pipelineStage) return;
    if (!(transitions[card.pipelineStage] || []).includes(toStage)) {
      toast.error(`Can't move ${prettyEnum(card.pipelineStage)} → ${prettyEnum(toStage)} directly`);
      return;
    }
    // Optimistic: move the card locally, server confirms (and audits) the change.
    queryClient.setQueryData(PIPELINE_KEY, (prev) => prev && ({
      ...prev,
      partners: prev.partners.map((p) => (p.id === card.id ? { ...p, pipelineStage: toStage, stageSince: new Date().toISOString() } : p)),
    }));
    stageMutation.mutate({ partnerId: card.id, toStage });
  };

  return (
    <div className="flex flex-col h-full min-h-0 p-6 md:p-8 md:pb-4 gap-0">
      <div>
        <h1 className="ro-title">Team pipeline</h1>
        <p className="ro-sub">Drag a business to move its stage — only legal next steps light up. Click to open.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-4 mb-4">
        {Object.entries(PHASES).map(([key, ph]) => (
          <button
            key={key}
            type="button"
            onClick={() => setPhase(key)}
            className="h-[34px] px-4 rounded-full text-[12.5px] font-semibold border cursor-pointer"
            style={key === phase
              ? { background: 'var(--ro-bunker)', borderColor: 'var(--ro-bunker)', color: '#fff' }
              : { background: '#fff', borderColor: 'var(--ro-border-strong)', color: 'var(--ro-bunker)' }}
          >
            {ph.label}
          </button>
        ))}
        <span className="ml-auto text-[12px] hidden md:inline" style={{ color: 'var(--ro-text-3)' }}>
          Empty stages are collapsed — click to expand
        </span>
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={({ active }) => setActiveCard(active.data.current?.partner || null)}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveCard(null)}
      >
        <div className="flex gap-2.5 overflow-x-auto pb-4 items-stretch flex-1 min-h-0">
          {stages.map((stage) => {
            const items = byStage[stage] || [];
            const collapsed = items.length === 0 && !expanded[stage];
            return (
              <Lane
                key={stage}
                stage={stage}
                items={items}
                activeCard={activeCard}
                legalTargets={legalTargets}
                collapsed={collapsed}
                onExpand={() => setExpanded((e) => ({ ...e, [stage]: true }))}
              >
                {items.slice(0, 30).map((p) => (
                  <BoardCard
                    key={p.id}
                    p={p}
                    draggable={canDragCard(user, p)}
                    onOpen={(pid) => navigate(`/redeem-ops/partners/${pid}`)}
                  />
                ))}
                {items.length > 30 && (
                  <p className="text-[11.5px] text-center font-semibold m-0 py-1.5 bg-white border border-border rounded-full" style={{ color: 'var(--ro-text-2)' }}>
                    + {items.length - 30} more
                  </p>
                )}
                {items.length === 0 && (
                  <p className="text-[11.5px] m-0 px-1.5 py-2" style={{ color: 'var(--ro-text-3)' }}>Empty</p>
                )}
              </Lane>
            );
          })}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeCard ? <div className="w-[234px]"><CardInner p={activeCard} dragging /></div> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
