# structured-english-vscode

Language support for Structured English pseudocode in VS Code.

```
# Make sure vim is set up
IF vim is not installed
    Install the vim package with dnf
ELSE
    Update vim with dnf
END IF
```

## Features

- **Highlighting**: keywords (shown in bold), operators, conditions, steps,
  literals (`` `code` ``, `"quoted text"`, URLs and paths) and comments. It uses
  semantic tokens, so every theme colors it.
- **Error checking**: reports unclosed blocks, unmatched closers, missing or
  extra text after keywords, branches after `ELSE`/`OTHERWISE`, and wrong
  indentation.
- **Matching keywords**: put the cursor on a keyword to highlight the rest of
  its block (`IF` … `ELSE IF` … `ELSE` … `END IF`).
- **Auto-indent** after block openers and branches, and outdent on branches
  and closers.
- **Comment toggling** with `#`.

Files ending in `.se` open as Structured English.

## Language

Keywords count only when written in capitals at the start of a line. In
closing keywords the space is optional: `END IF` and `ENDIF` both work.

| Block  | Keywords                                            |
| ------ | --------------------------------------------------- |
| IF     | `IF` cond, `ELSE IF` cond, `ELSE`, `END IF`         |
| CASE   | `CASE` value, `WHEN` value, `OTHERWISE`, `END CASE` |
| FOR    | `FOR` items, `END FOR`                              |
| WHILE  | `WHILE` cond, `END WHILE`                           |
| REPEAT | `REPEAT`, `UNTIL` cond                              |

Operators: `AND`, `OR`, `NOT`, `EACH`, `IN`, `THEN`, `DO`.

Comments: lines starting with `#`, `*` or `//`.

A block's body must be indented deeper than its opener, and every line of the
body must use the same indentation. Branches and closers must line up with the
opener.
