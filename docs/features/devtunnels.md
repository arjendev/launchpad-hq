# DevTunnels

Access your Launchpad HQ dashboard remotely using Microsoft Dev Tunnels. Scan a QR code from your phone to connect.

## Overview

Dev Tunnels create a secure tunnel from your local HQ server to a public URL, enabling remote access from any device — including your phone.

## Setup

DevTunnel configuration is part of the [onboarding wizard](../guide/onboarding) or can be changed in [Settings](./settings).

### Prerequisites

- Microsoft Dev Tunnels CLI installed
- Azure account for tunnel authentication

### Enabling

1. Open **Settings** (gear icon in the top bar)
2. Navigate to the **DevTunnel** section
3. Toggle the tunnel on
4. A QR code appears in the top bar for quick mobile access

## QR Code Access

The top bar displays a clickable DevTunnel indicator. Clicking it shows a QR code that:

- Points to your tunnel URL
- Authenticates the remote device on scan
- Provides full dashboard access on mobile

## Remote Access

Once connected via the tunnel, remote devices get:

- Full three-pane dashboard
- Real-time WebSocket updates
- Project and session management

::: warning
Changing tunnel mode in Settings requires a restart to take effect.
:::
