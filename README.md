# Photo Gallery & Portfolio

A professional photo gallery and portfolio application built with Next.js 15, TypeScript, and Tailwind CSS. This project is designed for **demoing GitHub Copilot features** in a real-world, component-driven Next.js application. The included demos showcase how Copilot can assist with code generation, refactoring, UI building, and more.

## Demos

- All demo guides and examples are in the [`demos/`](demos/) folder.
- For more information about each demo, refer to the [README](demos/README.md) file in the `demos/` directory.
- To get started, check out the first demo [`features-demo.md`](demos/features-demo.md) for a walkthrough of gallery features and Copilot capabilities.

### Demo Tracks

Latest recommended guides (Option 2):

- [Features Demo (Option 2)](demos/features-demo-option-2.md)
- [Engineering Practices Demo (Option 2)](demos/engineering-practices-option-2.md)
- [Customize Copilot Demo (Option 2)](demos/customize-copilot-option-2.md)
- [Cloud Agent Demo (Option 2)](demos/cloud-agent-option-2.md)

Original guides:

- [Features Demo](demos/features-demo.md)
- [Engineering Practices Demo](demos/engineering-practices.md)
- [Customize Copilot Demo](demos/customize-copilot.md)
- [Copilot Spaces Demo](demos/copilot-spaces.md)
- [Cloud Agent Demo](demos/cloud-agent.md)

### Creating a New Demo

If you want to contribute and create a new demo, follow these steps:

1. Open GitHub Copilot Chat.
2. Type the prompt `/create-copilot-demo` with an explanation of your demo idea.
3. Copilot will generate a new demo file in the `demos/` directory.
4. Fill in remaining sections with detailed instructions, examples, and expected results.

After finishing the demo, don't forget this quick follow-up:

1. Add in the overview, key skills, and demo link to the [demo README](demos/README.md)

## Getting Started

### Technical Requirements

- **Node.js** v18 or newer
- **npm** (or yarn, pnpm, bun)

### Quick Start with GitHub Codespaces

The fastest way to get started is using GitHub Codespaces:

1. Click the **"Code"** button on the GitHub repository page
2. Select the **"Codespaces"** tab
3. Click **"Create codespace on main"** (or your current branch)
4. Wait for the codespace to build and start

The codespace will automatically:
- Install all dependencies (`npm install`)
- Start the development server (`npm run dev`)
- Configure GitHub Copilot and essential VS Code extensions
- Forward port 3000 for the Next.js application

Once ready, you can access the application at the forwarded port URL provided in the terminal.

### Local Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/ps-copilot-sandbox/copilot-intermediate-gallery-repo.git
   cd gallery-repo
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```bash
src/
├── app/                 # Next.js 15 App Router pages
├── components/          # Reusable React components
├── lib/                 # Utility functions and helpers
demos/                   # Demo guides and templates
```

## Photo Downloads

Each gallery card's download button retrieves that photo's `Photo.url`. Only the
active photo's download action is disabled; other cards and gallery controls remain
usable. Loading and browser handoff are announced to assistive technology. Errors
appear on the affected card, and the same button can retry. "Download started"
means the file was handed to the browser, not that it was saved to disk.

`src/lib/photo-download.ts` exposes the typed, independently mockable
`PhotoDownloadService`; `src/hooks/usePhotoDownload.ts` owns per-photo state,
duplicate-request prevention, and unmount cancellation. The service accepts JPEG,
PNG, GIF, and WebP responses, checks MIME/signature agreement, and decodes the image
before offering it for download. It requires a modern browser with Fetch, Blob,
AbortController, and `createImageBitmap` support. Temporary anchors are removed
immediately and object URLs are revoked shortly after browser handoff.

Filenames prefer a valid `Content-Disposition` filename (including UTF-8
`filename*`) only from a same-origin final response. All filenames are sanitized
for filesystem safety and use an extension matching the image type. Missing or
unusable metadata falls back to the photo title and ID, then `photo-<id>`.
URLs and response bodies are never included in user-facing errors or logs.

The nine small PNGs in `public/photos/` are original, deterministic demo fixtures
generated from raw RGB gradients and geometric shapes with the project's existing
[Sharp](https://sharp.pixelplumbing.com/) dependency. They are not photographs,
contain no third-party imagery, and require no external image service. The gallery
continues to show its existing gradient previews.

Future remote assets must allow browser fetches through
[CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS).
Their server must expose `Content-Disposition` through
`Access-Control-Expose-Headers`, and a trusted adapter must explicitly authorize
using that metadata; the default service ignores cross-origin filenames.
Do not embed deployment-specific URLs, credentials, or signed URLs in source code.
Bulk downloads and server-side ZIP generation are not implemented.

## Download Tests

The tests use [Next.js's Jest integration](https://nextjs.org/docs/app/guides/testing/jest)
with [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/),
[jest-dom](https://github.com/testing-library/jest-dom), and
[user-event](https://testing-library.com/docs/user-event/intro/). Network requests,
image decoding, browser download APIs, and the grid's download service are mocked;
no external image service is contacted.

```bash
npm test -- --runInBand
npx --no-install tsc --noEmit
```

Tests cover payload/error handling, safe filenames, browser-resource cleanup,
independent downloads, duplicate clicks, retry, keyboard/ARIA behavior, and existing
gallery interactions. For a manual smoke check, run `npm run dev`, download a photo
from `/gallery`, and verify its filename and PNG content. Also check keyboard focus,
a narrow touch viewport, dark mode, and failure/retry using browser network tools.