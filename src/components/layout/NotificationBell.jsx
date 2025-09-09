import { useEffect, useState, useRef } from 'react';
import { Bell } from 'lucide-react';
import { notifications as notificationsAPI } from '@/api/client';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu.jsx';

export default function NotificationBell() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [since, setSince] = useState(null);
  const timerRef = useRef(null);

  async function load() {
    try {
      setLoading(true);
      const list = await notificationsAPI.list({ limit: 15, since });
      setItems(list);
      setSince(new Date().toISOString());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, 30000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const unreadCount = items.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="relative p-2 rounded-lg hover:bg-gray-100">
        <Bell className="w-5 h-5 text-gray-600" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] leading-none px-1.5 py-0.5 rounded-full">
            {unreadCount}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-h-96 overflow-auto">
        <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {loading && <div className="px-3 py-2 text-sm text-gray-500">Loading...</div>}
        {!loading && items.length === 0 && (
          <div className="px-3 py-2 text-sm text-gray-500">No notifications</div>
        )}
        {!loading && items.map(n => (
          <DropdownMenuItem key={n.id} className="flex flex-col items-start gap-0.5">
            <div className="text-sm font-medium">{n.title}</div>
            <div className="text-xs text-gray-500">{n.message}</div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}


