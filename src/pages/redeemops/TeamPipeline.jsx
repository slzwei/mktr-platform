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
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import AlertTriangle from 'lucide-react/icons/alert-triangle';
import Moon from 'lucide-react/icons/moon';
import { RoAvatar, prettyEnum } from '@/components/redeemops/ui';

const PIPELINE_KEY = ['redeem-ops', 'team-pipeline'];

/* The five working columns. LOST is not a column — it's the drop bar below. */
const STAGES = ['NEW', 'CONTACTED', 'MEETING', 'PROPOSAL', 'PARTNERED'];

const STAGE_DOT = {
  NEW: 'var(--ro-tag-gray-fg)',
  CONTACTED: 'var(--ro-tag-yellow-fg)',
  MEETING: 'var(--ro-tag-blue-fg)',
  PROPOSAL: 'var(--ro-tag-purple-fg)',
  PARTNERED: 'var(--ro-tag-green-fg)',
  LOST: 'var(--ro-tag-red-fg)',
};

const STAGE_HINT = {
  NEW: 'Not yet reached out',
  CONTACTED: 'First touch made',
  MEETING: 'Meeting booked or done',
  PROPOSAL: 'Terms on the table',
  PARTNERED: 'Signed on',
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
  const snoozed = p.availability === 'follow_up_later';
  return (
    <div
      className={`bg-white border border-border rounded-xl px-3 py-2.5 select-none ${dragging ? 'shadow-2xl rotate-2 cursor-grabbing' : ''}`}
    >
      <p className="text-[13.5px] font-semibold m-0 leading-tight flex items-center gap-1.5">
        <span className="truncate">{partnerName(p)}</span>
        {snoozed && (
          <Moon className="w-3 h-3 shrink-0" style={{ color: 'var(--ro-text-3)' }} aria-label="Snoozed" />
        )}
        {(p.atRiskFlag || p.staleFlag) && !snoozed && (
          <AlertTriangle className="w-3 h-3 shrink-0" style={{ color: 'var(--ro-tag-yellow-fg)' }} aria-hidden="true" />
        )}
      </p>
      {(p.category || p.lostReason) && (
        <p className="text-[11.5px] m-0 mt-0.5 truncate" style={{ color: 'var(--ro-text-2)' }}>
          {p.pipelineStage === 'LOST' && p.lostReason ? `Lost — ${prettyEnum(p.lostReason)}` : p.category}
        </p>
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

function Lane({ stage, items, activeCard, legalTargets, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const isSource = activeCard?.pipelineStage === stage;
  const isLegal = !!activeCard && legalTargets.includes(stage);
  const dimmed = !!activeCard && !isLegal && !isSource;

  return (
    <div
      ref={setNodeRef}
      className="flex-1 min-w-[210px] rounded-2xl flex flex-col min-h-0 transition-opacity"
      style={{
        background: isOver && isLegal ? '#EFF6FF' : 'var(--ro-subtle)',
        opacity: dimmed ? 0.45 : 1,
        outline: isOver && isLegal ? '2px dashed var(--ro-azure)' : 'none',
        outlineOffset: '-2px',
      }}
    >
      <div className="flex items-center gap-2 px-3.5 pt-3 pb-2" title={STAGE_HINT[stage]}>
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: STAGE_DOT[stage] }} />
        <span className="text-[12.5px] font-bold">{prettyEnum(stage)}</span>
        <span className="ml-auto text-[11px] font-bold bg-white border border-border rounded-full px-2 py-px" style={{ color: 'var(--ro-text-2)' }}>
          {items.length}
        </span>
      </div>
      <div className="px-2 pb-2.5 flex flex-col gap-2 overflow-y-auto min-h-[56px] flex-1">
        {children}
      </div>
    </div>
  );
}

/* Red strip that appears while dragging — the only way to mark a deal Lost. */
function LostDropBar({ activeCard, legalTargets }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'LOST' });
  const isLegal = !!activeCard && legalTargets.includes('LOST');
  if (!activeCard) return null;
  return (
    <div
      ref={setNodeRef}
      className="mt-2.5 rounded-2xl grid place-items-center h-[52px] text-[12.5px] font-bold transition-colors"
      style={{
        background: isOver && isLegal ? '#FEF2F2' : 'var(--ro-subtle)',
        color: isLegal ? 'var(--ro-tag-red-fg)' : 'var(--ro-text-3)',
        outline: `2px dashed ${isLegal ? 'var(--ro-tag-red-fg)' : 'var(--ro-border-strong)'}`,
        outlineOffset: '-2px',
        opacity: isLegal ? 1 : 0.45,
      }}
    >
      {isLegal ? 'Mark as Lost — drop here (asks for a reason)' : 'Partnered businesses can’t be marked Lost'}
    </div>
  );
}

export default function TeamPipeline() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [activeCard, setActiveCard] = useState(null);
  const [confirmMove, setConfirmMove] = useState(null); // { card } — Partnered is a milestone, confirm it
  const [lostMove, setLostMove] = useState(null); // { card } — Lost requires a reason
  const [lostReason, setLostReason] = useState(null);
  const [showLost, setShowLost] = useState(false);

  const constants = useQuery({
    queryKey: ['redeem-ops', 'constants'],
    queryFn: redeemOpsApi.getConstants,
    staleTime: Infinity,
  });
  const boardQuery = useQuery({ queryKey: PIPELINE_KEY, queryFn: redeemOpsApi.getTeamPipeline });

  const undoMutation = useMutation({
    mutationFn: (partnerId) => redeemOpsApi.undoStage(partnerId),
    onSuccess: () => {
      toast.success('Move undone');
      queryClient.invalidateQueries({ queryKey: PIPELINE_KEY });
    },
    onError: (err) => {
      toast.error('Could not undo', { description: err.message });
      queryClient.invalidateQueries({ queryKey: PIPELINE_KEY });
    },
  });

  const stageMutation = useMutation({
    mutationFn: ({ partnerId, toStage, lostReason: lr }) => redeemOpsApi.changeStage(partnerId, toStage, undefined, lr),
    onError: (err) => {
      toast.error('Move rejected', { description: err.message });
      queryClient.invalidateQueries({ queryKey: PIPELINE_KEY });
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: PIPELINE_KEY });
      // Mis-drop safety net: 5-minute server-enforced undo, offered right here.
      toast.success(`Moved ${vars.name} to ${prettyEnum(vars.toStage)}`, {
        duration: 8000,
        action: { label: 'Undo', onClick: () => undoMutation.mutate(vars.partnerId) },
      });
    },
  });

  // 6px of movement before a drag starts, so plain clicks still open the record.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const transitions = constants.data?.stageTransitions || {};
  const lostReasons = constants.data?.lostReasons || [];
  const partners = boardQuery.data?.partners || [];

  const byStage = useMemo(() => {
    const map = {};
    for (const p of partners) {
      (map[p.pipelineStage] = map[p.pipelineStage] || []).push(p);
    }
    return map;
  }, [partners]);

  const lostItems = byStage.LOST || [];
  const legalTargets = activeCard ? (transitions[activeCard.pipelineStage] || []) : [];

  const executeMove = (card, toStage, lr = null) => {
    // Optimistic: move the card locally, server confirms (and audits) the change.
    queryClient.setQueryData(PIPELINE_KEY, (prev) => prev && ({
      ...prev,
      partners: prev.partners.map((p) => (p.id === card.id
        ? { ...p, pipelineStage: toStage, lostReason: toStage === 'LOST' ? lr : p.lostReason, stageSince: new Date().toISOString() }
        : p)),
    }));
    stageMutation.mutate({ partnerId: card.id, toStage, lostReason: lr, name: partnerName(card) });
  };

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
    if (toStage === 'PARTNERED') {
      // Milestone move: seeds onboarding, unlocks rewards, and the server
      // requires a contact + phone/email on file — confirm before committing.
      setConfirmMove({ card });
      return;
    }
    if (toStage === 'LOST') {
      setLostReason(null);
      setLostMove({ card });
      return;
    }
    executeMove(card, toStage);
  };

  return (
    <div className="flex flex-col h-full min-h-0 p-6 md:p-8 md:pb-4 gap-0">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="ro-title">Team pipeline</h1>
          <p className="ro-sub">Drag a business forward — or onto the red bar to mark it Lost. Click to open.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowLost((v) => !v)}
          className="ml-auto h-[34px] px-4 rounded-full text-[12.5px] font-semibold border cursor-pointer"
          style={showLost
            ? { background: 'var(--ro-bunker)', borderColor: 'var(--ro-bunker)', color: '#fff' }
            : { background: '#fff', borderColor: 'var(--ro-border-strong)', color: 'var(--ro-bunker)' }}
        >
          Lost ({lostItems.length})
        </button>
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={({ active }) => setActiveCard(active.data.current?.partner || null)}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveCard(null)}
      >
        <div className="flex gap-2.5 overflow-x-auto pb-1 items-stretch flex-1 min-h-0 mt-4">
          {STAGES.map((stage) => {
            const items = byStage[stage] || [];
            return (
              <Lane key={stage} stage={stage} items={items} activeCard={activeCard} legalTargets={legalTargets}>
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
                  <p className="text-[11.5px] m-0 px-1.5 py-2" style={{ color: 'var(--ro-text-3)' }}>
                    {STAGE_HINT[stage]}
                  </p>
                )}
              </Lane>
            );
          })}
          {showLost && (
            <Lane stage="LOST" items={lostItems} activeCard={activeCard} legalTargets={legalTargets}>
              {lostItems.slice(0, 30).map((p) => (
                <BoardCard
                  key={p.id}
                  p={p}
                  draggable={canDragCard(user, p)}
                  onOpen={(pid) => navigate(`/redeem-ops/partners/${pid}`)}
                />
              ))}
              {lostItems.length === 0 && (
                <p className="text-[11.5px] m-0 px-1.5 py-2" style={{ color: 'var(--ro-text-3)' }}>
                  Nothing marked Lost — drag back to Contacted to re-engage.
                </p>
              )}
            </Lane>
          )}
        </div>
        <LostDropBar activeCard={activeCard} legalTargets={legalTargets} />
        <DragOverlay dropAnimation={null}>
          {activeCard ? <div className="w-[234px]"><CardInner p={activeCard} dragging /></div> : null}
        </DragOverlay>
      </DndContext>

      <Dialog open={!!confirmMove} onOpenChange={(open) => { if (!open) setConfirmMove(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark {confirmMove ? partnerName(confirmMove.card) : ''} as Partnered?</DialogTitle>
            <DialogDescription>
              This starts the onboarding checklist and unlocks rewards for this business.
              The person who agreed must be on its Contacts tab with a phone or email —
              the move is refused otherwise.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmMove(null)}>Cancel</Button>
            <Button
              onClick={() => {
                const m = confirmMove;
                setConfirmMove(null);
                if (m) executeMove(m.card, 'PARTNERED');
              }}
            >
              Mark as Partnered
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!lostMove} onOpenChange={(open) => { if (!open) setLostMove(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark {lostMove ? partnerName(lostMove.card) : ''} as Lost</DialogTitle>
            <DialogDescription>Why didn’t this one work out? Kept on record — you can re-engage later.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            {lostReasons.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setLostReason(r)}
                className="h-[42px] px-4 rounded-xl text-[13px] font-semibold border text-left cursor-pointer"
                style={r === lostReason
                  ? { background: 'var(--ro-bunker)', borderColor: 'var(--ro-bunker)', color: '#fff' }
                  : { background: '#fff', borderColor: 'var(--ro-border-strong)', color: 'var(--ro-bunker)' }}
              >
                {prettyEnum(r)}
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLostMove(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!lostReason}
              onClick={() => {
                const m = lostMove;
                setLostMove(null);
                if (m) executeMove(m.card, 'LOST', lostReason);
              }}
            >
              Mark as Lost
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
