import { useState, useMemo } from "react";
import {
  DndContext,
  closestCenter,
  DragOverlay,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

const COLUMNS = [
  { id: "new", label: "New", color: "blue" },
  { id: "contacted", label: "Contacted", color: "amber" },
  { id: "meeting", label: "Meeting", color: "violet" },
  { id: "close_won", label: "Won", color: "emerald" },
  { id: "close_lost", label: "Lost", color: "rose" },
];

const COLOR_MAP = {
  blue: {
    border: "border-t-blue-500",
    bg: "bg-blue-50",
    badge: "bg-blue-100 text-blue-700",
    dot: "bg-blue-500",
  },
  amber: {
    border: "border-t-amber-500",
    bg: "bg-amber-50",
    badge: "bg-amber-100 text-amber-700",
    dot: "bg-amber-500",
  },
  violet: {
    border: "border-t-violet-500",
    bg: "bg-violet-50",
    badge: "bg-violet-100 text-violet-700",
    dot: "bg-violet-500",
  },
  emerald: {
    border: "border-t-emerald-500",
    bg: "bg-emerald-50",
    badge: "bg-emerald-100 text-emerald-700",
    dot: "bg-emerald-500",
  },
  rose: {
    border: "border-t-rose-500",
    bg: "bg-rose-50",
    badge: "bg-rose-100 text-rose-700",
    dot: "bg-rose-500",
  },
};

const PRIORITY_COLORS = {
  high: "bg-red-100 text-red-700 border-red-200",
  medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
  low: "bg-green-100 text-green-700 border-green-200",
};

function normalizeStatus(prospect) {
  return (prospect.leadStatus || prospect.status || "new").toLowerCase();
}

function ProspectCard({ prospect, isDragging }) {
  const name = [prospect.firstName, prospect.lastName].filter(Boolean).join(" ") || "Unnamed";
  const company = prospect.company || prospect.companyName || null;
  const dateAdded = prospect.created_date || prospect.createdAt;
  const priority = (prospect.priority || "").toLowerCase();

  return (
    <div
      className={`bg-white rounded-lg border border-gray-200 p-3 shadow-sm cursor-grab active:cursor-grabbing transition-shadow ${
        isDragging ? "shadow-lg ring-2 ring-blue-400 opacity-90" : "hover:shadow-md"
      }`}
    >
      <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
      {company && (
        <p className="text-xs text-gray-500 truncate mt-0.5">{company}</p>
      )}
      <div className="flex items-center justify-between mt-2">
        {dateAdded ? (
          <span className="text-xs text-gray-400">
            {format(new Date(dateAdded), "MMM d, yyyy")}
          </span>
        ) : (
          <span />
        )}
        {priority && PRIORITY_COLORS[priority] && (
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 py-0 leading-4 ${PRIORITY_COLORS[priority]}`}
          >
            {priority}
          </Badge>
        )}
      </div>
    </div>
  );
}

function SortableCard({ prospect }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: prospect.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <ProspectCard prospect={prospect} />
    </div>
  );
}

function KanbanColumn({ column, prospects }) {
  const colors = COLOR_MAP[column.color];
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <div
      ref={setNodeRef}
      className={`flex-shrink-0 w-[220px] md:w-auto md:flex-1 flex flex-col rounded-xl border-t-4 ${colors.border} bg-gray-50 transition-colors ${
        isOver ? "bg-blue-50/50 ring-2 ring-blue-300" : ""
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-3">
        <div className={`w-2 h-2 rounded-full ${colors.dot}`} />
        <span className="text-sm font-semibold text-gray-700">{column.label}</span>
        <span
          className={`ml-auto inline-flex items-center justify-center text-xs font-medium rounded-full min-w-[20px] h-5 px-1.5 ${colors.badge}`}
        >
          {prospects.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2 min-h-[120px] max-h-[400px]">
        {prospects.map((p) => (
          <SortableCard key={p.id} prospect={p} />
        ))}
        {prospects.length === 0 && (
          <div className="text-xs text-gray-400 text-center py-6">No prospects</div>
        )}
      </div>
    </div>
  );
}

function SkeletonColumns() {
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {COLUMNS.map((col) => {
        const colors = COLOR_MAP[col.color];
        return (
          <div
            key={col.id}
            className={`flex-shrink-0 w-[220px] md:w-auto md:flex-1 rounded-xl border-t-4 ${colors.border} bg-gray-50 p-3`}
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="h-4 w-16 bg-gray-200 rounded animate-pulse" />
              <div className="ml-auto h-5 w-5 bg-gray-200 rounded-full animate-pulse" />
            </div>
            <div className="space-y-2">
              {Array.from({ length: 2 }, (_, i) => (
                <div key={i} className="h-[72px] bg-gray-200 rounded-lg animate-pulse" />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function ProspectKanban({ prospects, onStatusChange, loading }) {
  const [activeId, setActiveId] = useState(null);
  const [optimisticMoves, setOptimisticMoves] = useState({});

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const grouped = useMemo(() => {
    const groups = {};
    for (const col of COLUMNS) {
      groups[col.id] = [];
    }
    for (const p of prospects) {
      const overrideStatus = optimisticMoves[p.id];
      const status = overrideStatus || normalizeStatus(p);
      if (groups[status]) {
        groups[status].push(p);
      } else {
        // Fallback: put unknown statuses in "new"
        groups["new"].push(p);
      }
    }
    return groups;
  }, [prospects, optimisticMoves]);

  const activeProspect = activeId
    ? prospects.find((p) => p.id === activeId)
    : null;

  function handleDragStart(event) {
    setActiveId(event.active.id);
  }

  function handleDragEnd(event) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const prospectId = active.id;
    const prospect = prospects.find((p) => p.id === prospectId);
    if (!prospect) return;

    // Determine target column: over.id could be a column id or another card id
    let targetStatus = over.id;
    if (!COLUMNS.find((c) => c.id === targetStatus)) {
      // Dropped on a card - find which column that card is in
      const targetProspect = prospects.find((p) => p.id === over.id);
      if (targetProspect) {
        targetStatus =
          optimisticMoves[targetProspect.id] || normalizeStatus(targetProspect);
      } else {
        return;
      }
    }

    const currentStatus = optimisticMoves[prospectId] || normalizeStatus(prospect);
    if (currentStatus === targetStatus) return;

    // Optimistic update
    setOptimisticMoves((prev) => ({ ...prev, [prospectId]: targetStatus }));

    onStatusChange(prospectId, targetStatus)
      .then(() => {
        // Clear optimistic move on success (real data will arrive via refresh)
        setOptimisticMoves((prev) => {
          const next = { ...prev };
          delete next[prospectId];
          return next;
        });
      })
      .catch(() => {
        // Revert optimistic move on error
        setOptimisticMoves((prev) => {
          const next = { ...prev };
          delete next[prospectId];
          return next;
        });
      });
  }

  function handleDragCancel() {
    setActiveId(null);
  }

  if (loading) {
    return <SkeletonColumns />;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex gap-4 overflow-x-auto pb-2">
        {COLUMNS.map((col) => (
          <KanbanColumn
            key={col.id}
            column={col}
            prospects={grouped[col.id]}
          />
        ))}
      </div>
      <DragOverlay>
        {activeProspect ? (
          <div className="w-[200px]">
            <ProspectCard prospect={activeProspect} isDragging />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
