# opencode-cmux

OpenCode plugin that mirrors a small set of OpenCode events into cmux.

It is intentionally narrow in scope:

- Sets a single cmux sidebar status for OpenCode activity
- Sends desktop notifications for completions, errors, permissions, and questions
- Writes matching entries to the cmux log
- Does nothing outside a cmux workspace

## Requirements

- OpenCode ≥ 1.0
- [cmux](https://cmux.app) installed and `cmux` available on your `PATH`
- The plugin is a no-op when not running inside a cmux workspace

## Installation

Add to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["github:zharinov/opencode-cmux"]
}
```

OpenCode will download the package automatically on next start.

### Local / development

Symlink the source entry directly into OpenCode's plugin directory:

```bash
ln -sf ~/path/to/opencode-cmux/index.ts ~/.config/opencode/plugins/cmux.js
```

Make sure `opencode-cmux` is **not** listed in `opencode.json` when using the symlink, to avoid loading it twice.

## What it does

| Event                           | cmux                                    |
| ------------------------------- | --------------------------------------- |
| Session starts working          | Status `working` (amber, terminal)      |
| Top-level session completes     | Notify, success log, clear status       |
| Session error                   | Notify, error log, clear status         |
| Permission requested            | Notify, status `waiting` (red, lock)    |
| AI asks a question              | Notify, status `question` (purple)      |
| Permission or question answered | Back to `working` if nothing is pending |

## What it does not do

- It does not create or manage cmux splits, panes, or layouts.
- It does not run `opencode attach`.
- It does not require `opencode --port` or talk to OpenCode over HTTP.
- It does not emit completion notifications for subagent sessions.
- It does not fail the OpenCode run if `cmux` is missing or a cmux command errors; all cmux integration is best-effort.

## How it works

The plugin listens to OpenCode lifecycle, permission, and question events, then shells out to `cmux notify`, `cmux set-status`, `cmux clear-status`, and `cmux log`. It keeps only one status key (`opencode`) updated in the current cmux workspace. If the process is not running inside cmux, or if a cmux command fails, the plugin silently skips the action.

## License

MIT
