#!/bin/sh
# The scheduler container's loop: runs every periodic job once an hour. Each job is independent (a failing one is
# logged and the rest still run), and every job is safe to repeat. Daily jobs run in the 06:00 UTC hour only, so a
# person doesn't get the same greeting 24 times.
while true; do
  for job in \
    expire_stale_service_requests expire_stale_rides process_marketplace_orders process_hotel_reservations \
    process_event_bookings sync_channel_calendars send_course_reminders process_messages \
    process_listing_expirations process_privacy_requests; do
    python manage.py "$job" || echo "scheduler: $job failed"
  done
  if [ "$(date -u +%H)" = "06" ]; then
    for job in send_daily_greetings prune_visitor_events; do
      python manage.py "$job" || echo "scheduler: $job failed"
    done
  fi
  sleep 3600
done
