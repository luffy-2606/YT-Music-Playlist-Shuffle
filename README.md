# YT Music True Shuffle

A Chrome extension that completely and permanently shuffles your YouTube Music playlists. 

YouTube Music's default shuffle often repeats tracks or only shuffles a small portion of your list. This extension bypasses that by physically reordering the tracks in your playlist via the YouTube Music API, guaranteeing a truly random and complete mix every single time.

## Key Features

- **True Randomization:** Permanently reorders the actual tracks in your playlist.
- **Automatic Backups:** Automatically saves the original order of your playlist locally before applying any changes.
- **One-Click Restore:** Instantly revert your playlist back to its original state using the saved backup.
- **Native Integration:** Injects seamless, native-looking controls directly into the YouTube Music web player, plus a convenient extension popup.
- **Safe Execution:** Includes state-locking and connection-polling to prevent overlapping actions or crashes during heavy operations.

## Installation

Currently, this extension can be installed locally in developer mode:

1. Clone or download this repository to your local machine.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle switch in the top right corner.
4. Click the **Load unpacked** button.
5. Select the compiled output folder (usually `dist` or `build`) of this repository.

## Usage

1. Navigate to [YouTube Music](https://music.youtube.com).
2. Open any playlist that you own.
3. You can trigger the shuffle in two ways:
  - **Injected UI:** Click the "True Shuffle" button injected directly into the playlist header.
  - **Extension Popup:** Click the extension icon in your Chrome toolbar to open the control panel.
4. Wait for the operation to complete. The extension will automatically handle pagination for large playlists.
5. To revert, simply open the extension popup or click the injected UI button and select "Restore original order".

## Local Development

This project is built using TypeScript. To set up the development environment:

1. Install dependencies:

```bash
   npm install
```

2. Build the project:

```Bash
   node build.mjs
```

*Note: Use your specific build watch command (e.g., npm run watch) during active development.*

3. Load the output directory into Chrome as detailed in the Installation section.

## Contributing

Contributions are welcome. If you find a bug or have a feature request, please open an issue first to discuss what you would like to change.

When submitting pull requests, please ensure that your code adheres to the existing TypeScript structure and that any new UI elements match the native YouTube Music design language.

## Star History

<a href="https://www.star-history.com/?repos=luffy-2606%2FYT-Music-Playlist-Shuffle&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=luffy-2606/YT-Music-Playlist-Shuffle&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=luffy-2606/YT-Music-Playlist-Shuffle&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=luffy-2606/YT-Music-Playlist-Shuffle&type=date&legend=top-left" />
 </picture>
</a>

## License

GPL-3.0 -- see [LICENSE](LICENSE)
