#!/bin/sh
if [ "$RUN_MODE" = "cron-sa61" ]; then
  exec node scripts/sa61-weekly-reminder.js
elif [ "$RUN_MODE" = "cron-redeemed-audience" ]; then
  exec node scripts/sync-redeemed-audience.js
else
  exec npm start
fi
