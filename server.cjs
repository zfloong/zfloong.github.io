const http = require("http");
const fs = require("fs");
const path = require("path");
const mime = { ".html":"text/html", ".css":"text/css", ".js":"application/javascript" };
const dir = "C:\\Users\\65451\\Documents\\Codex\\2026-07-17\\zfloong-zfloong-github-io-https-github\\repo";
http.createServer((req, res) => {
  let file = path.join(dir, req.url === "/" ? "index.html" : req.url);
  let ext = path.extname(file);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("404"); return; }
    res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
    res.end(data);
  });
}).listen(8086, () => process.stdout.write("OK"));
