# gitBusy installation

## Mac app

1. Open the `gitBusy-macos-arm64.dmg` file.
2. Drag `gitBusy.app` to Applications.
3. If macOS warns that the developer cannot be verified, control-click `gitBusy.app`, choose **Open**, then confirm **Open**. This unsigned build is intended for local testing; notarization requires Apple Developer Program membership.
4. **First double-click:** starts gitBusy’s local server and opens the browser.
5. **Second double-click:** stops gitBusy’s local server, removes gitBusy’s Tailscale route if enabled, clears the runtime marker, and closes matching gitBusy browser tabs when macOS allows it.
6. Closing the browser window or tab does **not** stop the local server. Double-click `gitBusy.app` again to stop the services.

The current app bundle is built for Apple Silicon (`arm64`). An Intel build will be produced separately if needed.

## GitHub authentication

The app keeps GitHub credentials on the Mac and reads them through the local Git credential helper. Before the first run, install and authenticate GitHub CLI if it is not already configured:

```bash
brew install gh
gh auth login
gh auth setup-git
```

Do not put a GitHub token in this document, the browser, or the app URL.

## Tailscale mobile access

Tailscale’s Personal plan is free for personal, non-commercial use. Create an account at [login.tailscale.com/start](https://login.tailscale.com/start) using Apple, Google, Microsoft, or GitHub.

1. Install Tailscale on the Mac from [tailscale.com/download](https://tailscale.com/download), open it, and sign in.
2. Install Tailscale on the phone or tablet from the [iOS App Store](https://apps.apple.com/us/app/tailscale/id1470499037) or [Google Play](https://play.google.com/store/apps/details?id=com.tailscale.ipn), then sign in with the same account.
3. Accept the VPN-configuration prompt on both devices and confirm they appear connected in the Tailscale app or Machines page.
4. Tailscale Serve requires HTTPS certificates to be enabled for the tailnet. Approve the prompt if Tailscale asks during setup, or enable HTTPS certificates in the Tailscale admin console.
5. Start gitBusy on the Mac, open **Settings**, and choose **Enable Tailscale access**.
6. Open the displayed HTTPS URL ending in `/gitbusy` on the phone or tablet.
7. Enter the pairing code shown in gitBusy Settings on the Mac.

Tailscale access is off by default. To stop it, choose **Stop mobile access** in Settings or double-click `gitBusy.app` again. Use gitBusy v0.1.4 or newer for the corrected Tailscale command and Vite host allowlist. Older v0.1.2 builds may fail during Serve configuration, and v0.1.3 builds may reject the forwarded `*.ts.net` Host header. Existing Tailscale routes are preserved.

## Source install

The source package is `gitBusy-source-v0.1.4.zip`. It is for technical users who want to run gitBusy locally:

```bash
unzip gitBusy-source-v0.1.4.zip
cd gitBusy-source-v0.1.4
npm install
npm run dev
```

Open the localhost URL printed by Vite. `npm run dev` is the current development server and is required because the GitHub bridge is implemented as Vite middleware. A production `npm run start` server will be added before a general public release.

## Privacy

GitHub requests are made by the local server. The browser receives repository data, not the GitHub credential. Local organization data is stored in browser storage. No folder is uploaded merely by choosing it in the Folders workspace; publishing a folder is a separate explicit gitBusy action.
