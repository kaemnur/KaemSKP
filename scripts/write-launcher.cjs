const { writeFileSync } = require("node:fs");
const { join } = require("node:path");

const launcher = `const { appendFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { pathToFileURL } = require("node:url");

function log(message) {
  try {
    appendFileSync(join(tmpdir(), "kaemskp-main.log"), \`\${new Date().toISOString()} launcher: \${message}\\n\`);
  } catch {}
}

log("start");
import(pathToFileURL(join(__dirname, "index.js")).href).catch((error) => {
  log(error && error.stack ? error.stack : String(error));
  setTimeout(() => {
    throw error;
  }, 0);
});
`;

writeFileSync(join(process.cwd(), "out", "main", "launcher.cjs"), launcher);
