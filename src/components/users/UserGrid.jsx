import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Search,
  Trash2,
  Edit,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { getUserStatus, statusStyles } from "./userHelpers";

export default function UserGrid({
  users,
  pagination,
  totalPages,
  onPageChange,
  onEditUser,
  onDeleteUser,
}) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
        {users.length === 0 ? (
          <div className="col-span-full h-64 flex flex-col items-center justify-center text-gray-500 dark:text-gray-400">
            <div className="w-12 h-12 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mb-3">
              <Search className="w-6 h-6 text-gray-400 dark:text-gray-500" />
            </div>
            <p className="font-medium text-gray-900 dark:text-gray-100">No users found</p>
          </div>
        ) : (
          users.map(user => (
            <UserCard
              key={user.id}
              user={user}
              onEditUser={onEditUser}
              onDeleteUser={onDeleteUser}
            />
          ))
        )}
      </div>

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div className="border-t border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800 p-4 flex items-center justify-between">
          <span className="text-sm text-gray-500 dark:text-gray-400 hidden sm:inline">
            Page {pagination.currentPage} of {totalPages}
          </span>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(pagination.currentPage - 1)}
              disabled={pagination.currentPage === 1}
              className="h-8 shadow-sm bg-white dark:bg-gray-900"
            >
              <ChevronLeft className="w-4 h-4 mr-1" /> Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(pagination.currentPage + 1)}
              disabled={pagination.currentPage === totalPages}
              className="h-8 shadow-sm bg-white dark:bg-gray-900"
            >
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

const UserCard = React.memo(function UserCard({ user, onEditUser, onDeleteUser }) {
  const { statusKey, statusLabel } = getUserStatus(user, true);
  const isSystemAgent = user.firstName === 'System' && user.lastName === 'Agent';

  return (
    <Card className="shadow-sm hover:shadow-md transition-shadow border-gray-200/50 dark:border-gray-700/50 overflow-hidden group">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 bg-gray-50/30 dark:bg-gray-800/30">
        <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold uppercase text-sm ring-1 ring-blue-100 dark:ring-blue-900">
          {(user.firstName?.[0] || user.email?.[0] || '?')}
        </div>
        <Badge variant="outline" className={`${statusStyles[statusKey]} font-normal`}>
          {statusLabel}
        </Badge>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="text-lg font-semibold truncate text-gray-900 dark:text-gray-100" title={user.email}>
          {user.firstName ? `${user.firstName} ${user.lastName || ''}` : user.email}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-4 truncate">{user.email}</div>

        <div className="flex items-center justify-between text-sm mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
          <Badge variant="secondary" className="font-medium capitalize bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
            {user.role}
          </Badge>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" onClick={() => onEditUser(user)} className="h-8 w-8 text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400">
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onDeleteUser(user.id)}
              className="h-8 w-8 text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400"
              disabled={isSystemAgent}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});
