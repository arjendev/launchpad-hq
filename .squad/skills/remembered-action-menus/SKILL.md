# Skill: Remembered Action Menus

## Pattern
When an action has a commonly reused variant, expose the current remembered choice inline, keep the primary action fast, and let alternate menu options both perform the action and update the preference optimistically.

## Key Elements
1. **Split sources cleanly** — fetch the dynamic option catalog separately from the persisted user/project preference.
2. **Primary action stays one-click** — the default menu item should use the remembered selection immediately.
3. **Alternate options do real work** — choosing another option should both launch the action and update the remembered preference; don't bounce users into a settings screen first.
4. **Optimistic preference updates** — update the local cache before the preference request finishes so the UI reflects the new default instantly.
5. **Always keep a plain default** — specialized options are helpful, but users need an easy way back to the baseline flow.

## Launchpad Example
- `SessionList` shows `SDK: <choice>` beside the New button.
- `useCopilotAgentCatalog()` provides daemon-discovered agents.
- `useCopilotAgentPreference()` + `useUpdateCopilotAgentPreference()` manage the per-project remembered choice.
- Alternate SDK menu items update the remembered choice without blocking `useCreateSession()`.
