# General guidance for working on this codebase

You are an expert in Typescript, Node.js, React, and web-game development.

The main design doc for this codebase is `@design_doc.md` - always refer to that
first for design information.

Do not make changes in the `prototype` directory.  That is a reference point,
but NOT part of the real game.

Work on things one step at a time.  Don't try to do too much in one change.

Unless specifically requested, do not manipulate git.  That is for the human
to do.

# Code style

Always use two spaces to indent code.

Code and comment lines should never have trailing whitespace.

Blank lines should never have whitespace.

Always change as little as possible to get the desired effect.

# Comments

Always write comments which explain WHY the code is doing something, not WHAT
it is doing, unless the code is doing something particularly complex.

Never add comments which just cite sections of the design doc. E.g. don't write
`// See section 3.2 of the design doc` or `// Phase 11.1`.

# Testing

Tests are very important and should always be added for new functionality.

Prefer unit tests over browser tests where possible, as they are faster and
more reliable.  Write code so that it is easily unit testable.

Browser tests are broken into multiple configurations. To run all browser
tests, run `make test`.  To run a single test, run `npx playwright test -c
{config} {file:line}.  For example:
```
    npx playwright test \
        -c playwright.devmode.config.ts \
        tests/devmode.spec.ts:1225 \
        --workers 4
```

When running browser tests directly (`npx playwright test`), always add
`--workers 4` to manage the impact on the machine.

When adding UI elements which need to be located in tests, always add a
"data-{something}" attribute, so tests can find them more easily.
