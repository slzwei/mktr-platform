import { useEffect, useState, useCallback } from 'react';
import { Bell, UserPlus, DollarSign, Megaphone, AlertTriangle, Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

const STORAGE_KEY = 'mktr_notifications_read';

const notificationTypes = {
  prospect: { icon: UserPlus, color: 'bg-blue-500', label: 'Prospect' },
  commission: { icon: DollarSign, color: 'bg-emerald-500', label: 'Commission' },
  campaign: { icon: Megaphone, color: 'bg-purple-500', label: 'Campaign' },
  system: { icon: AlertTriangle, color: 'bg-red-500', label: 'System' },
};

function getRelativeTime(date) {
  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function generateMockNotifications() {
  const now = Date.now();
  return [
    { id: 'n1', type: 'prospect', message: 'New prospect "Sarah Chen" added via QR scan', createdAt: new Date(now - 12 * 60000) },
    { id: 'n2', type: 'commission', message: 'Commission of $250 approved for Agent Lee', createdAt: new Date(now - 45 * 60000) },
    { id: 'n3', type: 'campaign', message: 'Campaign "Q1 Launch" reached 1,000 impressions', createdAt: new Date(now - 2 * 3600000) },
    { id: 'n4', type: 'system', message: 'System maintenance scheduled for tonight at 11 PM', createdAt: new Date(now - 4 * 3600000) },
    { id: 'n5', type: 'prospect', message: 'Prospect "James Tan" status changed to Meeting Set', createdAt: new Date(now - 6 * 3600000) },
    { id: 'n6', type: 'commission', message: 'Monthly commission payout processed ($1,200)', createdAt: new Date(now - 12 * 3600000) },
    { id: 'n7', type: 'campaign', message: 'Campaign "Fleet Wrap Beta" is now active', createdAt: new Date(now - 24 * 3600000) },
    { id: 'n8', type: 'prospect', message: '3 new prospects added from Short Link campaign', createdAt: new Date(now - 36 * 3600000) },
  ];
}

export default function NotificationBell() {
  const [notifications, setNotifications] = useState([]);
  const [readIds, setReadIds] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setNotifications(generateMockNotifications());
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(readIds));
    } catch { /* ignore */ }
  }, [readIds]);

  const unreadCount = notifications.filter(n => !readIds.includes(n.id)).length;

  const markAllRead = useCallback(() => {
    setReadIds(notifications.map(n => n.id));
  }, [notifications]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="relative p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
          <Bell className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] leading-none px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
              {unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100">Notifications</h3>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-blue-600 hover:text-blue-700 h-auto py-1 px-2"
              onClick={markAllRead}
            >
              <Check className="w-3 h-3 mr-1" />
              Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-[400px] overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Bell className="w-8 h-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
              <p className="text-sm text-gray-500 dark:text-gray-400">No notifications yet</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">We'll notify you when something happens</p>
            </div>
          ) : (
            notifications.map((n) => {
              const typeConfig = notificationTypes[n.type] || notificationTypes.system;
              const Icon = typeConfig.icon;
              const isRead = readIds.includes(n.id);
              return (
                <div
                  key={n.id}
                  className={`flex items-start gap-3 px-4 py-3 border-b border-gray-50 dark:border-gray-700 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer ${!isRead ? 'bg-blue-50/30 dark:bg-blue-950/30' : ''}`}
                  onClick={() => {
                    if (!isRead) {
                      setReadIds(prev => [...prev, n.id]);
                    }
                  }}
                >
                  <div className={`mt-0.5 w-7 h-7 rounded-full ${typeConfig.color} flex items-center justify-center shrink-0`}>
                    <Icon className="w-3.5 h-3.5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-snug ${!isRead ? 'text-gray-900 dark:text-gray-100 font-medium' : 'text-gray-600 dark:text-gray-400'}`}>
                      {n.message}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{getRelativeTime(n.createdAt)}</p>
                  </div>
                  {!isRead && (
                    <div className="mt-2 w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                  )}
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
