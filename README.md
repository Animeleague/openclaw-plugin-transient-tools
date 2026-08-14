# OpenClaw Transient Tools

`openclaw-plugin-transient-tools` keeps recent tool interactions available as bounded, transient context while preventing tool-call/result history from endlessly growing OpenClaw session transcripts.

It is designed for tool-heavy agents, especially long-lived OpenClaw/Codex sessions.

## Default behaviour

- Retain the newest **200** completed tool interactions in process memory.
- Inject at most **40,000 estimated tokens** of transient tool context on a turn.
- Inject at most **2,000 estimated tokens per interaction**; larger interactions are truncated only for future carry-forward.
- The **current tool call/result is never truncated or changed** by this plugin.
- Persistent `toolResult` rows are blocked.
- Assistant `toolCall` blocks are stripped from persistent transcript writes; tool-call-only assistant rows are blocked.
- Normal user messages and normal assistant replies continue to persist.
- Exact compatibility aliases are deduplicated before any remaining write:
  - `toolCall.input` is removed only when JSON-equivalent to `toolCall.arguments`.
  - tool-result `content` is removed only when it is exactly equal to `text`.
- By default, same-model interactions are **not** re-injected. This avoids duplicating history already held by a warm model thread. Cross-model interactions are injected, which is useful for warm multi-model routing such as Sol/Luna.
- Gateway restart clears the ring deliberately: the tool history is genuinely transient.

## Why a plugin?

OpenClaw 2026.7.1 already exposes the right hooks:

- `after_tool_call` captures tool completions on harness paths that emit it.
- `before_message_write` provides a Codex transcript-mirror fallback: the plugin pairs the mirrored assistant tool-call row with its `toolResult` before blocking both writes. When those mirror hooks omit `sessionKey`, the plugin correlates the mirrored user row back to the matching prompt/session via Codex's mirror scope, and fails closed if that correlation is ambiguous.
- `before_prompt_build` records the logical session and adds bounded transient per-turn context.

That means this optimisation does not need to patch OpenClaw's compiled runtime.

## Configuration

```json
{
  "plugins": {
    "entries": {
      "transient-tools": {
        "enabled": true,
        "config": {
          "maxInteractions": 200,
          "maxTransientTokens": 40000,
          "maxInteractionTokens": 2000,
          "persistToolHistory": false,
          "dedupeAliases": true,
          "injectSameModel": false
        }
      }
    }
  }
}
```

### `injectSameModel`

Keep this `false` for warm-thread harnesses where the same model already has its native tool history. Set it to `true` for stateless/reconstructed providers that need the plugin to carry tool context into subsequent turns on the same model.

## Install locally

From a directory:

```bash
openclaw plugins install -l /path/to/openclaw-plugin-transient-tools
```

From an npm-pack tarball:

```bash
openclaw plugins install npm-pack:/path/to/openclaw-plugin-transient-tools-0.1.5.tgz
```

Then restart the Gateway and inspect the plugin:

```bash
openclaw gateway restart
openclaw plugins inspect transient-tools --runtime --json
```


## Live diagnostics

The ring remains process-memory only. For troubleshooting, an authenticated diagnostic tool can write a one-off snapshot of the **live Gateway ring** to the current user's Downloads folder:

```text
transient_tools_dump
```

The JSON dump includes the bounded retained interactions plus capture/injection diagnostics: session refs, run/model correlation, missing-session cases, duplicate drops, same-model skips, token-budget stops, and recent hook decisions. The plugin never dumps automatically, including during Gateway shutdown. Treat diagnostic dumps as potentially sensitive because tool arguments/results may contain private data.

## Verification

After installation:

1. Make a harmless tool call.
2. Confirm the current turn receives the full result.
3. Inspect only the new session JSONL rows: normal user/assistant conversation should persist, while the tool call/result should not.
4. If using model routing, switch models and confirm the earlier tool interaction appears in transient prompt context without being written to JSONL.

## Compatibility

Initial release targets OpenClaw **2026.7.1** / plugin API `>=2026.7.1 <2026.8.0`.

## License

MIT
