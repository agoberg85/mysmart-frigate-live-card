# MySmart Frigate Live Card

A custom Lovelace card for Home Assistant to display a live Frigate camera stream with pan, zoom, snapshots, and fullscreen controls.

## Support development
Buy me a coffee: https://buymeacoffee.com/mysmarthomeblog

Subscribe to Youtube channel: https://www.youtube.com/@My_Smart_Home

## Features
- **Native Live View:** Uses Home Assistant camera streaming with HLS playback when available.
- **MJPEG Fallback:** Falls back to MJPEG automatically if HLS is unavailable.
- **Pan & Zoom:** Supports mouse wheel zoom, drag-to-pan, and touch pinch gestures.
- **Quick Controls:** Includes mute, snapshot, fullscreen, and zoom reset actions.
- **Buildable Locally:** Bundled with Rollup so you can run `npm install && npm run build` instead of relying on jsDelivr.

## Installation

### HACS (Recommended)
1. Go to the HACS page in your Home Assistant instance.
2. Click the three-dot menu in the top right.
3. Select "Custom repositories".
4. In the "Repository" field, paste the URL of this repository (`https://github.com/agoberg85/mysmart-frigate-live-card`).
5. For "Category", select "Dashboard".
6. Click "Add".
7. The `mysmart-frigate-live-card` will now appear in the HACS Frontend list. Click "Install".

### Manual Installation
1. Download the `mysmart-frigate-live-card.js` file from the latest release.
2. Copy the file to the `www` directory in your Home Assistant `config` folder.
3. In your Lovelace dashboard, go to "Manage Resources" and add a new resource:
   - URL: `/local/mysmart-frigate-live-card.js`
   - Resource Type: `JavaScript Module`

## Configuration

### Main Options
| Name | Type | Required? | Description | Default |
| :--- | :--- | :--- | :--- | :--- |
| `type` | string | **Required** | `custom:mysmart-frigate-live` | |
| `entity` | string | **Required** | Camera entity to display. | |
| `title` | string | Optional | Title shown in the card header. | `''` |

## Example

```yaml
type: custom:mysmart-frigate-live
entity: camera.front_door
title: Front Door Live
```

## Local development

```bash
npm install
npm run build
```

This creates the bundled file `mysmart-frigate-live-card.js` in the repository root.
