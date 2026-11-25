import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const shouldFix = process.argv.includes("--fix");
const SOURCE_LANGUAGE = "en";
const LANGUAGES_FILE = join(root, "languages.json");
const PLURAL_SUFFIX = /^(.+)_(zero|one|two|few|many|other)$/;
const PLACEHOLDER = /\{\{\s*([^\s,}]+)[^}]*\}\}/g;
const SKIPPED_DIRECTORIES = new Set(["scripts", "node_modules"]);

const errors = [];
const report = (file, key, message) =>
  errors.push(`${relative(root, file)}${key ? ` ${key}` : ""}: ${message}`);

const placeholdersOf = (value) =>
  new Set([...value.matchAll(PLACEHOLDER)].map(([, name]) => name));

const pluralCategoriesOf = (code) =>
  new Intl.PluralRules(code).resolvedOptions().pluralCategories;

const readJson = (file) => {
  const text = readFileSync(file, "utf8");
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    report(file, null, `invalid JSON (${error.message})`);
    return undefined;
  }
  const formatted = `${JSON.stringify(value, null, 2)}\n`;
  if (text !== formatted) {
    if (shouldFix) writeFileSync(file, formatted);
    else report(file, null, "not formatted, run node scripts/validate.mjs --fix");
  }
  return value;
};

const readCatalog = (file) => {
  const catalog = readJson(file);
  if (catalog === undefined) return null;
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    report(file, null, "must be a flat JSON object");
    return null;
  }
  for (const [key, value] of Object.entries(catalog)) {
    if (typeof value !== "string") report(file, key, "value must be a string");
    else if (value.trim() === "") report(file, key, "value is empty");
  }
  return catalog;
};

const canonicalCodeOf = (code) => {
  try {
    return Intl.getCanonicalLocales(code)[0];
  } catch {
    return null;
  }
};

const checkLanguageCode = (file, code) => {
  const canonical = canonicalCodeOf(code);
  if (!canonical) {
    report(file, null, `"${code}" is not a valid language code`);
    return false;
  }
  if (canonical !== code) {
    report(file, null, `language code should be ${canonical}`);
    return false;
  }
  return true;
};

const readLanguages = () => {
  let languages;
  try {
    languages = readJson(LANGUAGES_FILE);
  } catch {
    report(LANGUAGES_FILE, null, "missing, it lists every language that must be translated");
    return [];
  }
  if (languages === undefined) return [];
  if (!Array.isArray(languages) || languages.some((code) => typeof code !== "string")) {
    report(LANGUAGES_FILE, null, "must be a JSON array of language codes");
    return [];
  }
  const seen = new Set();
  for (const code of languages) {
    if (seen.has(code)) report(LANGUAGES_FILE, null, `"${code}" is listed twice`);
    seen.add(code);
  }
  if (!seen.has(SOURCE_LANGUAGE)) report(LANGUAGES_FILE, null, `must list ${SOURCE_LANGUAGE}`);
  const sorted = [...languages].sort();
  if (languages.some((code, index) => code !== sorted[index])) {
    report(LANGUAGES_FILE, null, "codes must be in alphabetical order");
  }
  return [...seen].filter((code) => checkLanguageCode(LANGUAGES_FILE, code));
};

const pluralFormOf = (source, key) => {
  const match = PLURAL_SUFFIX.exec(key);
  if (!match || !(`${match[1]}_other` in source)) return null;
  return { base: match[1], category: match[2] };
};

const resolveSource = (source, key) => {
  const pluralForm = pluralFormOf(source, key);
  if (key in source) return { reference: source[key], isPluralForm: pluralForm !== null };
  if (!pluralForm) return null;
  return { reference: source[`${pluralForm.base}_other`], isPluralForm: true };
};

const checkCatalog = (file, code, catalog, source) => {
  const categories = new Set(pluralCategoriesOf(code));
  for (const [key, value] of Object.entries(catalog)) {
    if (typeof value !== "string") continue;
    const pluralForm = pluralFormOf(source, key);
    if (pluralForm && !categories.has(pluralForm.category)) {
      report(file, key, `"${pluralForm.category}" is not a plural form in ${code}`);
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

const checkCompleteness = (file, code, catalog, source) => {
  const categories = pluralCategoriesOf(code);
  const pluralBases = new Set();
  for (const key of Object.keys(source)) {
    const pluralForm = pluralFormOf(source, key);
    if (pluralForm) {
      pluralBases.add(pluralForm.base);
    } else if (!(key in catalog)) {
      report(file, key, `missing, every language in languages.json needs every key in ${SOURCE_LANGUAGE}.json`);
    }
  }
  for (const base of pluralBases) {
    for (const category of categories) {
      const key = `${base}_${category}`;
      if (!(key in catalog)) report(file, key, `missing, ${code} needs the "${category}" plural form`);
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

const languages = readLanguages();
const hasLanguageList = languages.length > 0;
const listed = new Set(languages);
const folders = findCatalogFolders(root);

let checkedFiles = 0;
for (const directory of folders) {
  const sourceFile = join(directory, `${SOURCE_LANGUAGE}.json`);
  const source = readCatalog(sourceFile) ?? {};
  const names = readdirSync(directory).sort();
  for (const code of languages) {
    if (!names.includes(`${code}.json`)) {
      report(join(directory, `${code}.json`), null, "missing, every language in languages.json needs a file");
    }
  }
  for (const name of names) {
    const file = join(directory, name);
    if (!name.endsWith(".json")) {
      report(file, null, "only <language>.json files belong here");
      continue;
    }
    const code = name.slice(0, -".json".length);
    const catalog = code === SOURCE_LANGUAGE ? source : readCatalog(file);
    checkedFiles += 1;
    if (!catalog || !checkLanguageCode(file, code)) continue;
    if (hasLanguageList && !listed.has(code)) {
      report(file, null, `${code} is not in languages.json, add it there or remove this file`);
      continue;
    }
    checkCatalog(file, code, catalog, source);
    if (hasLanguageList) checkCompleteness(file, code, catalog, source);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  console.error(`\n${errors.length} problem(s) in ${checkedFiles} file(s)`);
  process.exit(1);
}
console.log(
  `${checkedFiles} file(s) in ${folders.length} folder(s) are valid and cover all ${languages.length} languages`
);
