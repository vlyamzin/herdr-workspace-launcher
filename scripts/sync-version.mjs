// Runs from `npm version`: copies the new package.json version into herdr-plugin.toml and
// turns the CHANGELOG's "Unreleased" section into the release section.
import fs from "node:fs";

const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));

const manifest = fs.readFileSync("herdr-plugin.toml", "utf8");
if (!/^version = ".*"$/m.test(manifest)) throw new Error("herdr-plugin.toml: no top-level version line");
fs.writeFileSync("herdr-plugin.toml", manifest.replace(/^version = ".*"$/m, `version = "${version}"`));

const changelog = fs.readFileSync("CHANGELOG.md", "utf8");
if (!changelog.includes("## [Unreleased]")) throw new Error("CHANGELOG.md: no '## [Unreleased]' section");
const date = new Date().toISOString().slice(0, 10);
fs.writeFileSync("CHANGELOG.md", changelog.replace("## [Unreleased]", `## [Unreleased]\n\n## [${version}] - ${date}`));
