# @bob-work/chat-display

Shared **chat display rules** for Bob Work Desktop and Bob Mobile.

Desktop remains the source of truth. Mobile must consume this package rather than
maintaining a forked Markdown normalizer or timestamp formatter.

## Exports

- `normalizeAssistantMarkdown` — repair streamed / imperfect assistant Markdown before GFM rendering
- `formatMessageTimestamp` — `HH:mm · Today` / `HH:mm · weekday date` in the user locale

## Tests

```bash
npm test
```
