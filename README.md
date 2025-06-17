# Jut.su NonStop

An extension for automating anime viewing on jut.su.

## Features

- **Auto-Skip Openings** – automatically skips anime openings when detected.
- **Auto-Next Episode** – automatically proceeds to the next episode after the current one ends.
- **Fullscreen Mode Persistence** – keeps fullscreen mode active when switching between episodes.
- **Enhanced Fullscreen Mode** – hides site elements for a more comfortable viewing experience.
- **Playback Speed Control** – allows you to change the video playback speed.

## Installation

1. Download the latest version of the extension from the [Releases](https://github.com/your-username/jut_su_auto_skip/releases) section.
2. Extract the archive to a convenient location.
3. In your browser, go to the extensions management page.
4. Enable Developer Mode.
5. Click "Load unpacked extension" and select the folder with the extracted files.

## Usage

After installing the extension:

1. Go to jut.su
2. Open any anime episode.
3. The extension will automatically activate all features.
4. To configure settings, click the extension icon in your browser’s toolbar.

## Settings

- **Auto-Skip Openings** – enable/disable automatic skipping of openings.
- **Auto-Next Episode** – enable/disable automatic transition to the next episode.
- **Fullscreen Mode** – enable/disable enhanced fullscreen mode.
- **Interface Language** – switch between Russian and English.

## Project Structure

```
src/
├── locales/        # Localizations
│   ├── en/         # English
│   └── ru/         # Russian
├── content.js      # Main script for site interaction
├── icon.png        # Extension icon
├── popup.html      # HTML for the settings popup
└── popup.js        # JavaScript for the settings popup
```

## Technical Details

The extension uses:
- Content Script to interact with the site's DOM elements.
- Popup for parameter configuration.
- Chrome Storage API to save settings.
- MutationObserver to track changes on the page.

## License

MIT License

## Author

teruoru
