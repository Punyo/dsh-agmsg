#!/usr/bin/env bash
# dsh delivery plug: delivery is owned by the dsh-agmsg plugin.
#
# The plugin starts one watch.sh per joined dsh session from inside the dsh
# process and injects each streamed message into that session's agent. There
# is no SessionStart / Stop hook file to write, so apply is a no-op and the
# reported mode is always monitor. Sourced into delivery.sh's context.

agmsg_delivery_apply() { :; }

agmsg_delivery_status() {
  echo "mode: monitor"
  echo "  delivered by the dsh-agmsg plugin while a joined dsh session is running"
}

# The watchers belong to live dsh sessions; the plugin's own `delivery`
# setting is the switch. Do not stop them from outside.
agmsg_delivery_on_disable() {
  echo "dsh delivery is managed by the dsh-agmsg plugin; set its 'delivery' option to 'off' instead."
}

agmsg_delivery_stop_directive() {
  echo "dsh sessions stop their own watcher when they leave the team or exit."
}
