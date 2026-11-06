import type { FlowSpec } from "../flow.ts";
import type { Topic } from "../topic.ts";

const flow: FlowSpec = {
  nodes: [
    { id: "browser", kind: "client", label: "Browser", sub: "client", x: 0, y: 0.45 },
    { id: "resolver", kind: "dns", label: "DNS resolver", sub: "your ISP or 1.1.1.1", x: 0.02, y: 0 },
    { id: "auth", kind: "dns", label: "Name servers", sub: "root, .com, shop", x: 0.34, y: 0 },
    { id: "proxy", kind: "proxy", label: "Reverse proxy", sub: "nginx", x: 0.3, y: 0.45 },
    { id: "api", kind: "api", label: "API server", sub: "your code", x: 0.58, y: 0.45 },
    { id: "redis", kind: "redis", label: "Redis", sub: "cache", x: 0.98, y: 0 },
    { id: "db", kind: "db", label: "Postgres", sub: "database", x: 0.98, y: 0.34 },
    { id: "store", kind: "storage", label: "RustFS", sub: "file storage", x: 0.98, y: 0.66 },
    { id: "queue", kind: "queue", label: "BullMQ", sub: "job queue", x: 0.72, y: 1 },
    { id: "worker", kind: "worker", label: "Worker", sub: "background", x: 0.98, y: 1 },
    { id: "office", kind: "client", label: "Office laptop", sub: "many users", x: 0, y: 1 },
    { id: "forward", kind: "proxy", label: "Forward proxy", sub: "company gateway", x: 0.3, y: 1 },
  ],
  scenarios: [
    {
      id: "journey",
      label: "One request, start to finish",
      summary: "You type `shop.example.com/products/7` and press Enter. Follow what happens, from the name lookup to the response.",
      steps: [
        {
          phase: "DNS",
          title: "The browser needs an address, not a name",
          body: "Networks route by IP address. The browser checks its own cache and the operating system's. If neither has the name, it asks a recursive resolver.",
          hops: [["browser", "resolver", "A? shop.example.com", "request"]],
          set: { browser: ["no cached address"] },
        },
        {
          phase: "DNS",
          title: "The resolver walks the hierarchy",
          body: "The resolver asks a root server who handles `.com`, then asks `.com` who handles `example.com`, then asks that domain's authoritative server for the record.",
          hops: [["resolver", "auth", "where is shop…?", "request"], ["auth", "resolver", "93.184.216.34", "response"]],
          card: { at: "auth", title: "Name servers", tag: "three questions", rows: ["root   → ask the .com servers", ".com   → ask ns1.example.com", "ns1    → A 93.184.216.34  TTL 300"] },
        },
        {
          phase: "DNS",
          title: "The answer is cached for its TTL",
          body: "For the next 300 seconds nobody repeats that work. This is why DNS changes do not appear instantly: old answers live on until their TTL ends.",
          hops: [["resolver", "browser", "93.184.216.34", "response"]],
          set: { browser: ["IP cached, TTL 300s"], resolver: ["cached, TTL 300s"] },
        },
        {
          phase: "Connect",
          title: "A secure connection is opened",
          body: "TCP first agrees a connection in three messages. TLS then proves the server owns the domain and agrees encryption keys. On HTTP/3 this happens in one combined handshake over QUIC.",
          hops: [["browser", "proxy", "TCP SYN, TLS hello", "request"], ["proxy", "browser", "certificate", "response"]],
          card: { at: "proxy", title: "Handshake", tag: "before any data", rows: ["SYN → SYN-ACK → ACK", "TLS: certificate proves identity", "both sides derive session keys"] },
        },
        {
          phase: "Request",
          title: "The HTTP request reaches the reverse proxy",
          body: "The browser only ever sees the proxy. nginx ends TLS here, applies limits, and chooses which application server should do the work.",
          hops: [["browser", "proxy", "GET /products/7", "request"]],
          card: { at: "proxy", title: "nginx", tag: "front door", rows: ["TLS ends here", "body size within limit", "route: / → upstream api", "set X-Forwarded-For"] },
          code: "client-server/nginx.conf#nginx",
        },
        {
          phase: "Backend",
          title: "The API validates, then checks the cache",
          body: "Your code runs for the first time. It rejects bad input before touching anything else, then looks in Redis, because memory answers in well under a millisecond.",
          hops: [["proxy", "api", "GET /products/7", "request"], ["api", "redis", "GET product:7", "request"], ["redis", "api", "nil, not cached", "response"]],
          code: "client-server/server.ts#server",
        },
        {
          phase: "Backend",
          title: "The database is the source of truth",
          body: "On a cache miss the API queries Postgres. This is slower because it may read from disk, which is exactly why the result is saved to Redis on the way back.",
          hops: [["api", "db", "SELECT … WHERE id=7", "request"], ["db", "api", "{ name: Keyboard }", "response"], ["api", "redis", "SET product:7 EX 60", "data"]],
          set: { redis: ["product:7  TTL 60"] },
        },
        {
          phase: "Response",
          title: "The response travels back",
          body: "The API returns JSON with a status code. The proxy forwards it, and the browser renders. The next person asking for product 7 gets it from Redis.",
          hops: [["api", "proxy", "200 OK", "response"], ["proxy", "browser", "200 OK + JSON", "response"]],
        },
      ],
    },
    {
      id: "write",
      label: "A write: database, files and jobs",
      summary: "Now a user creates a product with a photo. A write touches every part of the backend. Each tool does one job, in a deliberate order.",
      steps: [
        {
          phase: "Upload",
          title: "The photo goes to object storage",
          body: "Files do not belong in the database or on the API's disk. The API hands out a short-lived signed URL, and the browser uploads straight to RustFS.",
          hops: [["browser", "proxy", "POST /uploads", "request"], ["proxy", "api", "POST /uploads", "request"], ["api", "browser", "signed URL", "response"], ["browser", "store", "PUT photo.jpg", "data"]],
          set: { store: ["files/ab12  3.1 MB"] },
        },
        {
          phase: "Save",
          title: "The record goes to the database",
          body: "The database stores the object's key, never the file itself. This is the moment the write becomes real: if this step fails, the user sees an error.",
          hops: [["browser", "api", "POST /products", "request"], ["api", "db", "INSERT product", "request"], ["db", "api", "COMMIT", "response"]],
          set: { db: ["product 8, key files/ab12"] },
        },
        {
          phase: "Invalidate",
          title: "Stale cache entries are removed",
          body: "The cached product list is now out of date. Deleting it means the next read rebuilds a fresh copy from the database.",
          hops: [["api", "redis", "DEL products:list", "request"]],
          set: { redis: null },
        },
        {
          phase: "Queue",
          title: "Slow work goes to a queue",
          body: "Resizing images takes seconds. Adding a job to BullMQ takes about a millisecond, so the API can answer straight away.",
          hops: [["api", "queue", "add resize job", "job"], ["api", "browser", "201 Created", "response"]],
          set: { queue: ["1 waiting"] },
        },
        {
          phase: "Background",
          title: "A worker finishes the job later",
          body: "The user already has their response. A separate process picks up the job, makes thumbnails, and saves them. If it crashes, the job is retried, and no user request fails.",
          hops: [["queue", "worker", "resize job", "job"], ["worker", "store", "PUT thumb.jpg", "data"], ["worker", "db", "UPDATE thumb_key", "job"]],
          set: { queue: ["1 completed"], store: ["files/ab12  3.1 MB", "thumbs/ab12  48 KB"] },
        },
      ],
    },
    {
      id: "proxies",
      label: "Forward and reverse proxies",
      summary: "Both sit in the middle and pass traffic along. The difference is who they work for. A forward proxy acts for clients. A reverse proxy acts for servers.",
      steps: [
        {
          phase: "Forward proxy",
          title: "A forward proxy represents the clients",
          body: "Company laptops send traffic through a gateway. The website sees the gateway's address, not the laptop's. The company can log, filter and cache outbound traffic.",
          hops: [["office", "forward", "GET news site", "request"]],
          card: { at: "forward", title: "Forward proxy", tag: "works for clients", rows: ["is this site allowed?", "hide the client's address", "cache shared downloads"] },
        },
        {
          phase: "Forward proxy",
          title: "The server only sees the proxy",
          body: "The client is configured to use the proxy, and the server has no idea it exists. VPNs and corporate gateways work this way.",
          hops: [["forward", "proxy", "from 198.51.100.4", "request"]],
        },
        {
          phase: "Reverse proxy",
          title: "A reverse proxy represents the servers",
          body: "Now the roles flip. Clients believe the proxy is the website. The servers behind it are invisible, so they can change, fail and scale without anyone noticing.",
          hops: [["browser", "proxy", "GET /products/7", "request"]],
          card: { at: "proxy", title: "Reverse proxy", tag: "works for servers", rows: ["end TLS in one place", "balance across instances", "reject oversized requests", "serve static files"] },
        },
        {
          phase: "Reverse proxy",
          title: "The application stays private",
          body: "The API has no public address, so the only way in is through the proxy. That is what makes it safe for the proxy to control headers like `X-Forwarded-For`.",
          hops: [["proxy", "api", "X-Forwarded-For set", "request"], ["api", "proxy", "200 OK", "response"], ["proxy", "browser", "200 OK", "response"]],
        },
      ],
    },
  ],
};

export const clientServer: Topic = {
  slug: "client-server",
  title: "Client-Server Architecture",
  nav: "Client-Server",
  group: "Foundations",
  lede: "What really happens between pressing Enter and seeing a page: DNS, proxies, your code, the database, the cache, file storage and background jobs, in one complete journey.",
  learn: [
    {
      heading: "What it is",
      blocks: [
        { p: "A client asks, and a server answers. Almost all software on the internet follows this pattern. The client is anything that starts a conversation: a browser, a phone app, or another server. The server waits, does the work, and replies." },
        { p: "A real backend is many servers cooperating. Each one exists because it solves a problem the others handle badly. Once you know why each piece is there, any architecture diagram becomes readable." },
      ],
    },
    {
      heading: "The pieces, and why each exists",
      blocks: [
        {
          table: {
            head: ["Piece", "Problem it solves", "Example"],
            rows: [
              ["DNS", "People remember names, networks route by number", "Route 53, Cloudflare"],
              ["CDN", "Light takes time, so keep copies near users", "Cloudflare, CloudFront"],
              ["Reverse proxy", "One safe front door for many servers", "nginx, Caddy, HAProxy"],
              ["Load balancer", "One server is a limit and a single point of failure", "nginx, ALB"],
              ["API server", "Business rules need to run somewhere you control", "Fastify, Express"],
              ["Cache", "Databases are slow compared with memory", "Redis"],
              ["Database", "Data must survive and stay consistent", "Postgres"],
              ["Object storage", "Files are too big for a database or one disk", "RustFS, S3"],
              ["Job queue", "Slow work should not make users wait", "BullMQ"],
            ],
          },
        },
      ],
    },
    {
      heading: "Latency: why the order matters",
      blocks: [
        { p: "Every design decision in a backend comes back to these rough numbers. They differ by orders of magnitude, so a request's speed depends on which of them it touches." },
        {
          table: {
            head: ["Operation", "Rough time"],
            rows: [
              ["Reading from memory (Redis on the same network)", "under 1 ms"],
              ["Simple indexed database query", "1 to 10 ms"],
              ["Round trip inside one data centre", "about 0.5 ms"],
              ["Round trip across a continent", "30 to 80 ms"],
              ["Round trip across an ocean", "100 to 200 ms"],
            ],
          },
        },
        { callout: "These are typical orders of magnitude, not guarantees. Measure your own system before you optimise it.", title: "Rules of thumb" },
      ],
    },
    {
      heading: "Forward and reverse proxies",
      blocks: [
        { p: "Both pass traffic along. A forward proxy sits with the clients and hides them from servers. A reverse proxy sits with the servers and hides them from clients. If the client had to be configured to use it, it is a forward proxy. If the client has no idea it exists, it is a reverse proxy." },
      ],
    },
  ],
  flow,
  build: {
    intro: "You will run a real API behind a real nginx, with two instances and round-robin balancing. It is the same shape as a production deployment, on your own machine.",
    needs: ["Node.js 20 or newer", "Docker Desktop"],
    install: "npm init -y\nnpm pkg set type=module\nnpm install fastify zod\nnpm install -D typescript tsx @types/node",
    tree: "my-api/\n├─ docker-compose.yml   the services\n├─ nginx.conf           the reverse proxy\n└─ server.ts            the API",
    steps: [
      {
        title: "Look at DNS yourself",
        explain: [
          "Before writing code, watch a lookup. The first command asks your resolver. The second walks the hierarchy from the root, the same path as the animation. `curl -v` then prints the connection, the TLS handshake and the request as they happen.",
        ],
        shell: "dig +short example.com\ndig +trace example.com\ncurl -v https://example.com -o /dev/null",
      },
      {
        title: "Write the API",
        explain: [
          "`/healthz` is how a load balancer knows this instance can take traffic. Every production API needs one.",
          "`zod` parses the URL parameter before it reaches anything else. A value that fails gets a 400, and your logic only ever sees valid data.",
          "`trustProxy` makes `req.ip` read the client from `X-Forwarded-For`. That header comes from outside your system, so it can only be trusted because of what nginx does in the next step.",
        ],
        code: "client-server/server.ts#server",
        where: "In an existing project this is your server entry point. Add the health route and the input parsing, and set `trustProxy` only if a proxy really is the sole way in.",
      },
      {
        title: "Put nginx in front",
        explain: [
          "`upstream` lists the instances, and nginx rotates between them. `keepalive` reuses connections to your app, which only works together with `proxy_http_version 1.1` and an empty `Connection` header.",
          "`proxy_set_header X-Forwarded-For $remote_addr` overwrites whatever the client sent. The common `$proxy_add_x_forwarded_for` appends to it instead, so a client could claim any address and slip past IP-based limits. Use the overwrite on your outermost proxy.",
          "The timeouts make a stuck server cost a few seconds rather than a held connection forever.",
        ],
        code: "client-server/nginx.conf#nginx",
        where: "Save as `nginx.conf` next to your compose file. In production, replace `host.docker.internal` with your real instance addresses.",
      },
      {
        title: "Start the services",
        explain: [
          "This file runs everything used across these guides. Postgres publishes port `5433` and nginx `8088`, because `5432` and `8080` are often already taken on a developer's machine.",
        ],
        code: "docker-compose.yml",
        shell: "docker compose up -d --wait nginx",
      },
      {
        title: "Run two instances and try it",
        explain: [
          "Start the API twice on different ports, then call the proxy repeatedly. `servedBy` alternates between instances. Stop one and the requests keep working. Stop both and nginx answers `502 Bad Gateway`, which is what that status always means: the proxy is fine, and what is behind it is not.",
        ],
        shell: "curl http://localhost:8088/api/products/7\ncurl http://localhost:8088/api/products/7\ncurl -i http://localhost:8088/api/products/abc   # 400",
      },
    ],
    integrate: [
      "Add `/healthz` first. It is one route, and it makes every later step possible.",
      "Put the proxy in front before you need a second instance. Moving later means changing DNS under live traffic.",
      "Make the API stateless: no sessions in memory and no files on local disk. Any instance must be able to serve any request.",
      "Close the application's port to the public, so the proxy really is the only way in.",
    ],
    mistakes: [
      { title: "Appending to X-Forwarded-For at the edge", text: "The client controls the first value, so a forged address reaches your app. On the outermost proxy, overwrite it with `$remote_addr`. The tests for this guide send a forged address and confirm it never reaches the app." },
      { title: "Trusting the proxy header while the app is public", text: "If clients can reach the app directly, they can send any `X-Forwarded-For` they like. Only enable `trustProxy` when the app is reachable solely through your proxy." },
      { title: "Keeping state in the server's memory", text: "Sessions held in one instance vanish when traffic moves to another, and on every deploy. Keep them in Redis." },
      { title: "No timeouts", text: "With nothing to stop them, one slow dependency holds connections open until the server runs out of them." },
    ],
  },
  simulate: {
    intro: "This is a live model of what you just learned. Press Run, then push it until it breaks.",
    preset: "client-server",
    tries: [
      "Click API 1 and press Take down. Traffic moves to API 2 and errors stay at zero, because the proxy routes around it.",
      "Take down both APIs. Every request now fails with 503.",
      "Press Traffic spike a few times and watch which component turns into the bottleneck first.",
      "Add a Redis from the palette, connect both APIs to it, and compare latency.",
    ],
  },
  sources: [
    { label: "nginx: using X-Forwarded-For and proxy headers", url: "https://nginx.org/en/docs/http/ngx_http_proxy_module.html" },
    { label: "Fastify server options: trustProxy", url: "https://fastify.dev/docs/latest/Reference/Server/" },
  ],
};
