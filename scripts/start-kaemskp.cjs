const { spawn, exec } = require("node:child_process");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const host = "127.0.0.1";
const port = 3726;
const cwd = path.resolve(__dirname, "..");

async function main() {
  const existing = await findRunningServer();
  if (existing) {
    openBrowser(existing);
    return;
  }
  if (!(await isPortFree(port))) {
    throw new Error("Port 3726 sedang digunakan. Tutup proses KaemSKP lama.");
  }

  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined && value !== ""));
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32" ? ["/c", "npm", "run", "start"] : ["run", "start"];

  const child = spawn(command, args, {
    cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: childEnv
  });
  child.unref();

  const url = await waitForServer();
  openBrowser(url);
}

function findRunningServer() {
  return new Promise(async (resolve) => {
    const ok = await health(port);
    if (ok) {
      resolve(`http://${host}:${port}`);
      return;
    }
    resolve(null);
  });
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(async () => {
      const existing = await findRunningServer();
      if (existing) {
        clearInterval(timer);
        resolve(existing);
      } else if (Date.now() - started > 30000) {
        clearInterval(timer);
        reject(new Error("Server KaemSKP tidak merespons dalam 30 detik."));
      }
    }, 500);
  });
}

function health(port) {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: "/api/health", timeout: 500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => tester.close(() => resolve(true)));
    tester.listen(port, host);
  });
}

function openBrowser(url) {
  if (process.env.KAEMSKP_NO_OPEN === "1") return;
  if (process.platform === "win32") {
    exec(`start "" "${url}"`);
  } else if (process.platform === "darwin") {
    exec(`open "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
