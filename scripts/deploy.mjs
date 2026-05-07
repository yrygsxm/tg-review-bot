import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const databaseId = process.env.D1_DATABASE_ID;

if (!databaseId) {
  console.error("Missing D1_DATABASE_ID.");
  console.error("Set it in Cloudflare Workers Builds > Settings > Variables and Secrets.");
  process.exit(1);
}

const configPath = new URL("../wrangler.jsonc", import.meta.url);
const rawConfig = await readFile(configPath, "utf8");
const deployConfig = JSON.parse(rawConfig);

for (const database of deployConfig.d1_databases ?? []) {
  if (database.binding === "DB") {
    database.database_id = databaseId;
  }
}

if (
  !deployConfig.d1_databases?.some(
    (database) => database.binding === "DB" && database.database_id === databaseId
  )
) {
  console.error("Failed to inject D1_DATABASE_ID into wrangler.jsonc.");
  process.exit(1);
}

deployConfig.keep_vars = true;
delete deployConfig.vars;

const generatedConfig = new URL("../.wrangler.generated.jsonc", import.meta.url);
await writeFile(generatedConfig, `${JSON.stringify(deployConfig, null, 2)}\n`);

const child = spawn(
  "npx",
  ["wrangler", "deploy", "--config", ".wrangler.generated.jsonc", ...process.argv.slice(2)],
  {
    cwd: new URL("..", import.meta.url),
    stdio: "inherit",
    shell: process.platform === "win32"
  }
);

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
