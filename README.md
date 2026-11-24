# hydra-locales

Translations shared across Hydra projects. Every folder that holds an `en.json` is one set of strings, and each file in it is one language.

| Folder | Used by | What it holds |
| --- | --- | --- |
| `common/push/` | hydra-api | Text for push notifications on Android and iOS |

`common/` holds strings that more than one project shows to users. Strings that belong to a single app (launcher, Big Picture, mobile, web) will get their own folders as they move here.

## Format

Files are flat [i18next](https://www.i18next.com/) JSON, named after the language code: `en.json`, `pt-BR.json`, `zh.json`.

- `en.json` is the source. A key has to exist there before any other language can use it.
- Placeholders look like `{{displayName}}`. Keep every placeholder from the English text, spelled exactly the same.
- Plurals use i18next suffixes: `key_one`, `key_other`, and `key_few` or `key_many` where the language has them. Plural forms may leave out `{{count}}`.
- A missing key is fine. It falls back to English until someone translates it.

## Translating

1. Edit or create `<folder>/<language>.json`, for example `common/push/de.json`.
2. Run `node scripts/validate.mjs`. It checks JSON syntax, formatting, placeholders, plural forms and language codes. `node scripts/validate.mjs --fix` repairs formatting.
3. Open a pull request.

## Using it in a project

Pin a release tag as a git dependency:

```json
"@hydralauncher/locales": "github:hydralauncher/hydra-locales#v0.1.0"
```

Files are then available at `@hydralauncher/locales/common/push/<language>.json`. Projects without npm can add this repository as a git submodule pinned to the same tag.

## Releasing

Bump `version` in `package.json`, merge, then push a matching tag (`v0.2.0`). The release workflow validates the files and publishes the GitHub release.
