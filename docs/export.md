# Export images

The viewer's Export button saves or copies the current view (SVG, PNG); a published Artifact may block downloads, in which case it shows the image to save by hand. After a build, the CLI exports whole boards for READMEs, docs and slides:

```bash
npx repoladder export REPO [--board id] [--format svg|png] [--theme light|dark]
```

It writes one standalone SVG per board to `REPO/.repoladder/export/<board>-<theme>.svg`, which renders as a plain `<img>` on GitHub. `--format png` also writes 2x PNGs when Playwright with Chromium is installed.
