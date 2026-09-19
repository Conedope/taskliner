# taskliner

A plain-text task/checklist tracker for the command line. One line per task,
persisted to a single JSON file. Zero dependencies — Node.js built-ins only.

```console
$ taskliner add "Buy oat milk" --priority high --tag groceries --due 2026-10-01
added t1: Buy oat milk
```

## Install

Clone the repo and link it, or run it directly:

```console
$ git clone <this-repo> && cd taskliner
$ npm link                      # puts `taskliner` on your PATH
$ node bin/taskliner.js --help  # or run it without installing
```

Requires Node.js >= 18 (continuous-tested on 20 and 22).

## Commands

| Command | What it does |
| --- | --- |
| `taskliner add "TITLE" [--priority high\|medium\|low] [--tag a] [--tag b] [--due YYYY-MM-DD] [--notes "..."]` | Add a task |
| `taskliner list` | List open tasks (default) |
| `taskliner list --done` / `--open` | Filter by state |
| `taskliner list --tag groceries` / `--priority high` | Filter by tag or priority |
| `taskliner list --sort due\|priority\|created` | Sort the listing |
| `taskliner list --json` | Emit raw task JSON (great for CI) |
| `taskliner done ID [...]` | Mark one or more tasks done |
| `taskliner reopen ID` | Move a task back to open |
| `taskliner edit ID --title "..." [--priority high] [--due ...] [--tag a,b] [--notes "..."]` | Edit a task |
| `taskliner rm ID [...]` | Delete one or more tasks |
| `taskliner stats` | Totals per state, completion %, priority breakdown |
| `taskliner tag` | Tag tallies across all tasks |
| `taskliner --help` / `--version` | Help / version |

Run `taskliner` with no arguments — it's the same as `taskliner list`.

### Example session

```console
$ taskliner add "Write report" --tag work --due 2026-11-01
added t1: Write report
$ taskliner add "Walk the dog" --priority low
added t2: Walk the dog
$ taskliner add "Buy oat milk" --priority high --tag groceries --due 2026-10-01
added t3: Buy oat milk
$ taskliner done t1
done t1: Write report
```

```console
$ taskliner list
ID       PRIO  TITLE         TAGS       DUE
--------------------------------------------------
t1  [x]  -     Write report  work       2026-11-01
t2  [ ]  low   Walk the dog  -          -
t3  [ ]  high  Buy oat milk  groceries  2026-10-01

$ taskliner stats
total:       3
open:        2
done:        1
completion:  33.3%
high:        1
medium:      0
low:         1
none:        1

$ taskliner list --open --sort priority
ID       PRIO  TITLE         TAGS       DUE
--------------------------------------------------
t3  [ ]  high  Buy oat milk  groceries  2026-10-01
t2  [ ]  low   Walk the dog  -          -
```

Done tasks carry a compact `[x]` marker; open tasks show `[ ]`. Columns are
aligned by task so the table is readable at a glance.

## Storage

Tasks live in `~/.taskliner.json` by default. The file is created on first
write. Writes are atomic-ish: the CLI writes to a temp file in the same
directory, then renames it over the store.

To keep multiple lists, point `--file` at different paths, or set the
`TASKLINE_FILE` environment variable:

```console
$ taskliner --file ~/work.json add "Standup notes"
$ TASKLINE_FILE=~/home.json taskliner add "Buy oat milk"
```

If the store file is corrupt or not a taskliner array, the CLI prints a clear
message and exits `1` without touching the file.

Task fields: `id`, `title`, `done`, `priority` (`high`/`medium`/`low`/`none`),
`tags[]`, `due` (date string), `notes`, `createdAt`. IDs are stable, sequential
and human-typable: `t1`, `t2`, …

## Development

```console
npm test     # node --test test/*.test.js
```

Tests use temp directories and the `--file` mechanism exclusively — they never
touch your real home directory.

## License

MIT © 2026 Conedope. See [LICENSE](LICENSE).