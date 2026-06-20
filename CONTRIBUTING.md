# Contributing to YT Music True Shuffle

## Branch model

This project has two branches:

- **`dev`** — where all PRs land.
- **`main`** — what users run. Curated and tested by the maintainer. Fast-forwarded to a stable `dev` commit at each release.

**Open your PR against `dev`, not `main`.** The GitHub "base" dropdown defaults to `dev`. If you opened a PR against `main` by accident, click "Edit" on the PR and change the base — no rebase needed.

End-users cloning the repo will land on `main` by default. 
To run the development version: `git checkout dev` after clone.

## Before You Start

- Search existing issues and pull requests before opening a new one.
- Avoid broad rewrites, formatting-only changes, or moving many files unless the issue is specifically about structure.

## Setup

```bash
git clone https://github.com/luffy-2606/YT-Music-True-Shuffle.git
cd YT-Music-True-Shuffle

git checkout dev
git pull origin

npm install
node build.mjs
```

## Running Checks

Check if your work builds before commiting: ``node build.mjs``

Do test all flows you worked on to see if any errors pop up.

## Pull Requests

Good pull requests usually include:

- A short explanation of the bug or feature.
- The files or areas changed.
- Manual test steps or automated test results from running the actual app, not just the test suite.
- Screenshots or short recordings for UI changes.
- Links to related issues, for example `Fixes #123`.

## Code conventions

Don't hardcode values that the project already exposes through a constant or a helper. Hardcoded literals drift out of sync, break on non-default deployments, and reintroduce bugs we've already fixed.

**Commits:** use [Conventional Commits](https://www.conventionalcommits.org), `type(scope): summary` (e.g. `fix(search): ...`, `feat(notes): ...`, `docs(contributing): ...`). Common types: `fix`, `feat`, `refactor`, `docs`, `test`, `chore`, `ci`. Keep the subject short and imperative; put the "why" in the body when it isn't obvious.
