// Node sidecar hosting an impers (curl-impersonate) session.
// The Bun CLI spawns this because koffi's NAPI bindings crash under Bun.
// Protocol: newline-delimited JSON over stdio.
//   -> {"id":1,"method":"GET","url":"...","headers":{...},"cookies":{...},"body":"raw string?"}
//   <- {"id":1,"status":200,"text":"..."}  |  {"id":1,"error":"..."}
import { Session } from "impers";
import readline from "node:readline";

const session = new Session({ impersonate: "chrome", timeout: 40 });

const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

send({ ready: true });

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  Promise.resolve()
    .then(async () => {
      const opts = {};
      if (req.headers && Object.keys(req.headers).length) opts.headers = req.headers;
      if (req.cookies && Object.keys(req.cookies).length) opts.cookies = req.cookies;
      if (typeof req.body === "string" && req.body.length) opts.content = req.body;
      const res = await session.request(req.method, req.url, opts);
      send({ id: req.id, status: res.status, text: res.text });
    })
    .catch((err) => send({ id: req.id, error: String(err?.message ?? err) }));
});
process.stdin.on("end", () => process.exit(0));
