// Reports t("key") calls whose key is missing from messages/en.json or messages/fr.json.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const messages = { en: require("../messages/en.json"), fr: require("../messages/fr.json") };

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

let problems = 0;
for (const file of [...walk(path.join(root, "app")), ...walk(path.join(root, "components"))]) {
  const src = fs.readFileSync(file, "utf8");
  const namespaces = {};
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*"([\w.]+)"\s*\)/g)) {
    namespaces[m[1]] = m[2];
  }
  for (const [fn, ns] of Object.entries(namespaces)) {
    const re = new RegExp(`\\b${fn}\\(\\s*"([\\w.]+)"`, "g");
    for (const m of src.matchAll(re)) {
      for (const lang of ["en", "fr"]) {
        const value = [ns, m[1]].join(".").split(".").reduce((o, k) => (o == null ? o : o[k]), messages[lang]);
        if (value === undefined) {
          problems++;
          console.log(`${lang}: ${path.relative(root, file)} -> ${ns}.${m[1]}`);
        }
      }
    }
  }
}
console.log(problems === 0 ? "No missing keys." : `${problems} missing key reference(s).`);
