#!/bin/sh
if [ "$RUN_MODE" = "cron-sa61" ]; then
  exec node scripts/sa61-weekly-reminder.js
else
  exec npm start
fi
