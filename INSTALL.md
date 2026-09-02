# gitBusy installation

## Mac app

1. Open the `gitBusy-macos-arm64.dmg` file.
2. Drag `gitBusy.app` to Applications.
3. If macOS warns that the developer cannot be verified, control-click `gitBusy.app`, choose **Open**, then confirm **Open**. This unsigned build is intended for local testing; notarization requires Apple Developer Program membership.
4. Open `gitBusy.app` again to start gitBusy. Opening it a second time stops gitBusy and its local server.

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

Open gitBusy Settings and choose **Enable Tailscale access**. gitBusy keeps its server on loopback and adds a tailnet-only HTTPS route at `/gitbusy`. Open the displayed URL on a phone or tablet and enter the pairing code shown on the Mac.

Tailscale must be installed and signed in on the Mac and on the mobile device. Tailscale access is off by default. Local notes, favorites, tags, projects, and selected folders remain local to the device in this build.

## Source install

The source package is `gitBusy-source-v0.1.1.zip`. It is for technical users who want to run gitBusy locally:

```bash
unzip gitBusy-source-v0.1.1.zip
cd gitBusy-source-v0.1.1
npm install
npm run dev
```

Open the localhost URL printed by Vite. `npm run dev` is the current development server and is required because the GitHub bridge is implemented as Vite middleware. A production `npm run start` server will be added before a general public release.

## Privacy

GitHub requests are made by the local server. The browser receives repository data, not the GitHub credential. Local organization data is stored in browser storage. No folder is uploaded merely by choosing it in the Folders workspace; publishing a folder is a separate explicit gitBusy action.
