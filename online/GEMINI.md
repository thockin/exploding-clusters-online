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

Blank code lines should never have whitespace.

Code lines should never have trailing whitespace.

Always change as little as possible to get the desired effect.

# Testing

Tests are very important and should always be added for new functionality.

Prefer unit tests over browser tests where possible, as they are faster and
more reliable.  Write code so that it is easily unit testable.

When running browser tests, use `npx playwright test --workers 4` to manage the
impact on the machine.
