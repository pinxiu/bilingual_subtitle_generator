import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...options });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const cwd = process.cwd(); // server/
const venvDir = path.join(cwd, ".venv");

const pythonBin =
  process.platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");

const requirements = path.join(cwd, "requirements.txt");

// 1) Create venv if missing
if (!fs.existsSync(pythonBin)) {
  console.log("🐍 Creating venv at", venvDir);
  // Use system python to create venv
  const sysPython = process.platform === "win32" ? "python" : "python3";
  run(sysPython, ["-m", "venv", venvDir]);
}

// 2) Install Python deps into venv
if (!fs.existsSync(requirements)) {
  console.error("requirements.txt not found at:", requirements);
  process.exit(1);
}

console.log("📦 Installing Python dependencies into venv...");
run(pythonBin, ["-m", "pip", "install", "--upgrade", "pip"]);
run(pythonBin, ["-m", "pip", "install", "-r", requirements]);

// 3) Download stanza resources into a predictable project folder
const stanzaDir = path.join(cwd, ".stanza");
fs.mkdirSync(stanzaDir, { recursive: true });

console.log("🌐 Downloading Stanza resources (en, zh)...");
run(
  pythonBin,
  ["-c", "import stanza; stanza.download('en'); stanza.download('zh')"],
  { env: { ...process.env, STANZA_RESOURCES_DIR: stanzaDir } }
);

console.log("✅ Venv ready:", pythonBin);
console.log("✅ Stanza dir:", stanzaDir);
