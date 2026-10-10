# Contributing to Playweft Games

## Getting started

Follow the [README quick start](README.md#quick-start) to install dependencies
and run the games. Local play does not require the platform. Changes affecting
room play should also be exercised through a
[Playweft room](README.md#multiplayer-with-playweft).

## Reporting a problem

Open an [issue](https://github.com/playweft/playweft-games/issues) with:

- The game, local or room mode, and relevant match settings.
- Browser/version, operating system, and device or viewport size.
- Steps to reproduce, expected behavior, and actual behavior.
- A screenshot or useful console output, with personal information removed.

For rule bugs, include the board position or sequence of moves needed to
reproduce the problem. For room bugs, describe each player's actions and view.

## Making a change

1. Fork the repository and create a branch for your change.
2. Follow the conventions of the game or shared component you are editing.
3. For changes to game behavior, add a regression test covering the observed
   problem. Check local and room implementations when both provide the feature.
4. Run `npm run check` to build all games and execute the test suite.
5. Open a pull request describing the problem, resulting behavior, and validation.
   Include desktop/mobile screenshots for visible UI changes.

Game source lives in `games/<game>/`; shared code belongs in `src/` when multiple
games need it. Keep generated `dist/` files and `node_modules/` out of commits.
If you add an asset, record its source and license with it.

New games also need a manifest, help page, build entry in `vite.config.js`, and
catalogue entries in `index.html` and `public/featured-games.json`. Update the
README game table. Follow the
[package and bridge contract](https://github.com/playweft/playweft/blob/main/docs/game-integration/README.md)
when adding or changing room support.
