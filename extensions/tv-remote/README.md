# TV Remote

A remote control for an Android TV or Google TV device on the local network,
such as the waipu.tv 4K Stick.

It speaks Android TV Remote v2, the protocol Google's own phone remote uses.
No developer options or ADB are needed.

## Setup

1. Find the TV's IP address (on the stick: Settings → Network & Internet →
   your Wi-Fi, or your router's device list).
2. Enter it in the widget and choose **Pair**. The TV shows a six-character
   code.
3. Type the code into the widget.

The pairing is remembered. The client key is stored encrypted in
`~/.kavibay/tv-remote.json`, together with a fingerprint of each paired TV's
certificate. If the TV's address changes, pair again under the new address.
