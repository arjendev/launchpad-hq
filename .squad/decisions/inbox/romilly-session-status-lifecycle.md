# Decision: Fix session status lifecycle semantics

**Author:** Romilly (Backend Dev)  
**Date:** 2025-01-20  
**Status:** Implemented

## Context

A freshly created Copilot session was permanently stuck — the send-prompt route rejected all messages with a 409 because the session started as `"active"`, and the guard blocks sends when `status === "active"`.

## Decision

Redefine what "active" and "idle" mean in the session lifecycle:

- **"idle"** = session is ready to receive input (waiting for a prompt)
- **"active"** = session is currently processing a prompt (generating a response)

### Status transitions

| Event                    | New status | Rationale                              |
|--------------------------|-----------|----------------------------------------|
| `session.start`          | `idle`    | Session just started, waiting for input |
| `session.idle`           | `idle`    | Explicitly idle                         |
| `user.message`           | `active`  | Prompt sent, now processing             |
| `assistant.message.delta`| `active`  | Still generating response               |
| `tool.executionStart`    | `active`  | Tool running as part of response        |
| `assistant.message`      | `idle`    | Response complete, ready for next input |
| `tool.executionComplete` | no change | More events may follow                  |
| `session.error`          | `error`   | Error state                             |

Stub sessions created from firehose events also start as `"idle"`.

## Impact

- Unblocks the entire send-prompt flow — sessions can now receive messages after creation
- No API or type changes; the status type was already `"active" | "idle" | "error"`
- All 603 existing tests pass with updated assertions
