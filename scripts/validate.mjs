import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const shouldFix = process.argv.includes("--fix");
const SOURCE_LANGUAGE = "en";
const PLURAL_SUFFIX = /^(.+)_(zero|one|two|few|many|other)$/;
const PLACEHOLDER = /\{\{\s*([^\s,}]+)[^}]*\}\}/g;
const SKIPPED_DIRECTORIES = new Set(["scripts", "node_modules"]);

const errors = [];
const report = (file, key, message) =>
  errors.push(`${relative(root, file)}${key ? ` ${key}` : ""}: ${message}`);

const placeholdersOf = (value) =>
  new Set([...value.matchAll(PLACEHOLDER)].map(([, name]) => name));

const readCatalog = (file) => {
  const text = readFileSync(file, "utf8");
  let catalog;
  try {
    catalog = JSON.parse(text);
  } catch (error) {
    report(file, null, `invalid JSON (${error.message})`);
    return null;
  }
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    report(file, null, "must be a flat JSON object");
    return null;
  }
  const formatted = `${JSON.stringify(catalog, null, 2)}\n`;
  if (text !== formatted) {
    if (shouldFix) writeFileSync(file, formatted);
    else report(file, null, "not formatted, run node scripts/validate.mjs --fix");
  }
  for (const [key, value] of Object.entries(catalog)) {
    if (typeof value !== "string") report(file, key, "value must be a string");
    else if (value.trim() === "") report(file, key, "value is empty");
  }
  return catalog;
};

const resolveSource = (source, key) => {
  if (key in source) {
    return { reference: source[key], isPluralForm: PLURAL_SUFFIX.test(key) };
  }
  const match = PLURAL_SUFFIX.exec(key);
  if (!match) return null;
  const [, base] = match;
  const reference = source[`${base}_other`] ?? source[`${base}_one`];
  return reference === undefined ? null : { reference, isPluralForm: true };
};

const checkLanguageCode = (file, code) => {
  try {
    if (Intl.getCanonicalLocales(code)[0] !== code) {
      report(file, null, `language code should be ${Intl.getCanonicalLocales(code)[0]}`);
      return false;
    }
  } catch {
    report(file, null, `"${code}" is not a valid language code`);
    return false;
  }
  return true;
};

const checkCatalog = (file, code, catalog, source) => {
  const categories = new Set(
    new Intl.PluralRules(code).resolvedOptions().pluralCategories
  );
  for (const [key, value] of Object.entries(catalog)) {
    if (typeof value !== "string") continue;
    const match = PLURAL_SUFFIX.exec(key);
    if (match && !categories.has(match[2])) {
      report(file, key, `"${match[2]}" is not a plural form in ${code}`);
    }
    if (code === SOURCE_LANGUAGE) continue;
    const resolved = resolveSource(source, key);
    if (!resolved) {
      report(file, key, `key does not exist in ${SOURCE_LANGUAGE}.json`);
      continue;
    }
    const expected = placeholdersOf(resolved.reference);
    const actual = placeholdersOf(value);
    for (const name of actual) {
      if (!expected.has(name)) report(file, key, `unknown placeholder {{${name}}}`);
    }
    for (const name of expected) {
      if (actual.has(name)) continue;
      if (resolved.isPluralForm && name === "count") continue;
      report(file, key, `missing placeholder {{${name}}}`);
    }
  }
};

const findCatalogFolders = (directory) => {
  const entries = readdirSync(directory);
  if (entries.includes(`${SOURCE_LANGUAGE}.json`)) return [directory];
  const found = [];
  for (const name of entries.sort()) {
    if (name.startsWith(".") || SKIPPED_DIRECTORIES.has(name)) continue;
    const path = join(directory, name);
    if (statSync(path).isDirectory()) found.push(...findCatalogFolders(path));
    else if (directory !== root && name.endsWith(".json")) {
      report(path, null, `belongs in a folder that has ${SOURCE_LANGUAGE}.json`);
    }
  }
  return found;
};

const folders = findCatalogFolders(root);

let checkedFiles = 0;
for (const directory of folders) {
  const sourceFile = join(directory, `${SOURCE_LANGUAGE}.json`);
  const source = readCatalog(sourceFile) ?? {};
  for (const name of readdirSync(directory).sort()) {
    const file = join(directory, name);
    if (!name.endsWith(".json")) {
      report(file, null, "only <language>.json files belong here");
      continue;
    }
    const code = name.slice(0, -".json".length);
    const catalog = code === SOURCE_LANGUAGE ? source : readCatalog(file);
    checkedFiles += 1;
    if (!catalog || !checkLanguageCode(file, code)) continue;
    checkCatalog(file, code, catalog, source);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  console.error(`\n${errors.length} problem(s) in ${checkedFiles} file(s)`);
  process.exit(1);
}
console.log(`${checkedFiles} file(s) in ${folders.length} folder(s) are valid`);
