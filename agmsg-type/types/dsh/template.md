<!-- dsh overlay. -->
<!-- agmsg:slot delivery -->
<!-- agmsg:render-overlay __AGENT_TYPE__ -->
  5. dsh delivery is owned by the dsh-agmsg plugin: while a dsh session is joined, the plugin streams new messages into it. There is no mode to pick here.
<!-- /agmsg:slot delivery -->
<!-- agmsg:slot execute-extra -->
dsh is not spawnable from agmsg yet: start `dsh-tui` yourself and join from inside it with `/agmsg join <team> <name>`.
<!-- /agmsg:slot execute-extra -->
<!-- agmsg:slot mode -->
If argument is "mode", run `delivery.sh status __AGENT_TYPE__ "$(pwd)"`.
Only `monitor` is supported for dsh; the dsh-agmsg plugin's `delivery` setting turns it off.
<!-- /agmsg:slot mode -->
