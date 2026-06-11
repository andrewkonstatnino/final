import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import net from "node:net";
import tls from "node:tls";

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const SALES_EMAIL = "sales@herculeantechnologies.com";
const ROOT = new URL(".", import.meta.url).pathname;
const LEADS_DIR = join(ROOT, "data");
const LEADS_FILE = join(LEADS_DIR, "leads.jsonl");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
};

const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/api/leads") {
      await handleLead(request, response);
      return;
    }

    if (request.method === "GET" || request.method === "HEAD") {
      await serveStatic(request, response);
      return;
    }

    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error(error);
    sendJson(response, error.status || 500, { error: error.status ? error.message : "Something went wrong." });
  }
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(PORT, HOST, () => {
    console.log(`Herculean Technologies site running at http://${HOST}:${PORT}`);
  });
}

async function handleLead(request, response) {
  const lead = validateLead(await readJsonBody(request));
  const id = createHash("sha256")
    .update(`${lead.email}:${Date.now()}:${Math.random()}`)
    .digest("hex")
    .slice(0, 12);
  const record = {
    id,
    receivedAt: new Date().toISOString(),
    destination: SALES_EMAIL,
    ...lead,
  };

  await mkdir(LEADS_DIR, { recursive: true });
  await writeFile(LEADS_FILE, `${JSON.stringify(record)}\n`, { flag: "a" });

  const emailSent = await sendLeadEmail(record);
  sendJson(response, 200, { ok: true, id, emailSent });
}

export function validateLead(body) {
  const lead = {
    name: clean(body.name),
    email: clean(body.email),
    company: clean(body.company),
    phone: clean(body.phone),
    message: clean(body.message, 2000),
  };

  if (!lead.name || !lead.email || !lead.message) {
    throw Object.assign(new Error("Name, email, and message are required."), { status: 400 });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) {
    throw Object.assign(new Error("A valid email is required."), { status: 400 });
  }

  return lead;
}

function clean(value = "", max = 240) {
  return String(value).replace(/\s+/g, " ").trim().slice(0, max);
}

async function readJsonBody(request) {
  let raw = "";

  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 16_384) {
      throw Object.assign(new Error("Request body is too large."), { status: 413 });
    }
  }

  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw Object.assign(new Error("Invalid JSON."), { status: 400 });
  }
}

async function sendLeadEmail(lead) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log(`Lead ${lead.id} saved locally. Configure SMTP env vars to email ${SALES_EMAIL}.`);
    return false;
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const subject = `New Herculean Technologies lead: ${lead.name}`;
  const body = [
    `New lead received at ${lead.receivedAt}`,
    "",
    `Name: ${lead.name}`,
    `Email: ${lead.email}`,
    `Company: ${lead.company || "Not provided"}`,
    `Phone: ${lead.phone || "Not provided"}`,
    "",
    "Message:",
    lead.message,
  ].join("\n");

  await smtpSend({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from,
    to: SALES_EMAIL,
    replyTo: lead.email,
    subject,
    text: body,
  });

  return true;
}

async function smtpSend(options) {
  let socket = await connectSmtp(options);

  try {
    await expect(socket, 220);
    await command(socket, `EHLO ${process.env.SMTP_HELO || "localhost"}`, 250);

    if (!options.secure && options.port !== 25) {
      await command(socket, "STARTTLS", 220);
      socket = tls.connect({ socket, servername: options.host });
      await new Promise((resolve, reject) => {
        socket.once("secureConnect", resolve);
        socket.once("error", reject);
      });
      await command(socket, `EHLO ${process.env.SMTP_HELO || "localhost"}`, 250);
    }

    await command(socket, "AUTH LOGIN", 334);
    await command(socket, Buffer.from(options.user).toString("base64"), 334);
    await command(socket, Buffer.from(options.pass).toString("base64"), 235);
    await command(socket, `MAIL FROM:<${options.from}>`, 250);
    await command(socket, `RCPT TO:<${options.to}>`, 250);
    await command(socket, "DATA", 354);
    await command(socket, buildMessage(options), 250);
    await command(socket, "QUIT", 221);
  } finally {
    socket.end();
  }
}

async function connectSmtp(options) {
  const connector = options.secure ? tls.connect : net.connect;
  return new Promise((resolve, reject) => {
    const socket = connector({ host: options.host, port: options.port, servername: options.host });
    const event = options.secure ? "secureConnect" : "connect";
    socket.once(event, () => resolve(socket));
    socket.once("error", reject);
  });
}

function buildMessage({ from, to, replyTo, subject, text }) {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Reply-To: ${replyTo}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
  ];

  return `${headers.join("\r\n")}\r\n\r\n${text.replace(/\n/g, "\r\n")}\r\n.`;
}

function expect(socket, code) {
  return readResponse(socket).then((message) => {
    if (!message.startsWith(String(code))) {
      throw new Error(`SMTP expected ${code}, got ${message}`);
    }
  });
}

async function command(socket, line, code) {
  socket.write(`${line}\r\n`);
  await expect(socket, code);
}

function readResponse(socket) {
  return new Promise((resolve, reject) => {
    let data = "";

    const onData = (chunk) => {
      data += chunk.toString("utf8");
      const lines = data.trimEnd().split(/\r?\n/);
      const last = lines.at(-1) || "";

      if (/^\d{3} /.test(last)) {
        socket.off("data", onData);
        socket.off("error", reject);
        resolve(data.trimEnd());
      }
    };

    socket.on("data", onData);
    socket.once("error", reject);
  });
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const safePath = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const requestedPath = safePath === "/" ? "/index.html" : safePath;
  const filePath = join(ROOT, requestedPath);

  if (!filePath.startsWith(ROOT)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Not a file");

    response.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
      "Content-Length": fileStat.size,
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    createReadStream(filePath).pipe(response);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}

function sendJson(response, status, payload) {
  response.writeHead(payload.status || status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}
