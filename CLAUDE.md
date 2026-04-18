# Banana — Railway Simulation App

## Tooling

- **Package manager & runtime**: Bun — always use `bun` instead of `npm`, `pnpm`, `yarn`, or `node`
- **Build**: Vite
- **Test framework**: Bun's built-in test runner (`bun test`)
- **Formatting**: Prettier — 4-space indentation, single quotes, trailing comma `es5` (see `.prettierrc`)

## Commands

```bash
bun install          # Install dependencies
bun run dev          # Dev server
bun run dev:local    # Dev server with local tiles
bun run build        # Production build
bun run preview      # Preview production build
bun test             # Run tests
bun run format       # Format with Prettier
bun run format:check # Check formatting
```

## Git

### Commits

Conventional commits scoped to area:

```
feat(timetable): add shift template editing
fix(signals): resolve auto-driver signal handling
docs: update README with new examples
```

### Branches

`feat/`, `fix/`, `docs/`, `perf/` + descriptive name (e.g. `feat/timetable`, `fix/signal-handling`)

## State Machine Architecture

All human interaction logic must be built on `@ue-too/being` state machines. State machines are the cornerstone of this app's input handling — do not implement interaction logic with ad-hoc event listeners or boolean flags.

### Pattern

1. Define states as a const array + `CreateStateType`
2. Define an event mapping type (event name → payload)
3. Define a context interface extending `BaseContext` with the callbacks/services the state machine needs
4. Implement states using `TemplateState` with `EventReactions`
5. Compose into a `TemplateStateMachine`

### Existing Examples

Reference these for conventions and patterns:

- **Tool switching**: `src/trains/input-state-machine/tool-switcher-state-machine.ts`
- **Train placement**: `src/trains/input-state-machine/train-kmt-state-machine.ts`
- **Layout editing**: `src/trains/input-state-machine/layout-kmt-state-machine.ts`
- **Station placement**: `src/stations/station-placement-state-machine.ts`
- **Train editor tools**: `src/train-editor/train-editor-tool-switcher.ts`
- **Bogie editing**: `src/train-editor/bogie-kmt-state-machine.ts`
- **Image editing**: `src/train-editor/image-edit-state-machine.ts`
- **KMT extension (board)**: `src/trains/input-state-machine/kmt-state-machine-extension.ts`

## Icons

All icons must be imported from `@/assets/icons` — never directly from `lucide-react` or other icon packages. The barrel file at `src/assets/icons/index.ts` re-exports Lucide icons via `src/assets/icons/lucide.ts` alongside custom SVG icons. To add a new Lucide icon, add it to the export list in `lucide.ts`.

## Testing

Tests use **Bun's built-in test runner** (`bun test`). Import test utilities from `bun:test`, not from `vitest` or `jest`. Module mocking uses `mock.module()` from `bun:test`.
