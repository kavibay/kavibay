# TV Remote

A remote control for a Samsung TV on the local network, optionally together
with a waipu.tv 4K Stick or another Android TV / Google TV device.

## Setup

1. Add the widget. It searches the network and lists the Samsung TVs it
   finds; pick yours (or type its IP address).
2. The TV asks whether to allow Kavibay. Choose **Allow** with the TV's
   remote.

## With a waipu.tv 4K Stick

Turn on **Use a waipu.tv 4K Stick / Android TV for navigation** in the
widget settings. The widget then lists the Android TV devices it finds; pick
the stick and type the six-character code it shows on screen.

From then on navigation, OK, back, digits and channel keys go to the stick.
Volume, mute and power stay with the TV: the stick's own volume tops out at
the TV's level, and it does not pass volume on over HDMI-CEC.

## Streaming services

Buttons for YouTube, Netflix, Prime Video, Disney+, Spotify and Apple TV start
the app on the device navigation goes to. Pick which ones show under
**Streaming services** in the widget settings.

On a stick they open through each app's own deep link (`apps.rs`). A stick
refuses package launches (`market://`, `intent:`, `android-app:`), so an app
without a deep link — WOW is one — cannot be started this way.

## What is stored

Everything lives in `~/.kavibay/tv-remote.json`: the client key that paired
with the stick and the token the Samsung TV issued, both encrypted, plus a
fingerprint of each device's certificate. If a device's address changes, set
it up again under the new address.
