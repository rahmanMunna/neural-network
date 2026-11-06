import type { FlowSpec } from "../flow.ts";
import type { Topic } from "../topic.ts";

const flow: FlowSpec = {
  nodes: [
    { id: "browser", kind: "client", label: "Browser", x: 0, y: 0.45 },
    { id: "api", kind: "api", label: "API server", sub: "signs URLs", x: 0.38, y: 0 },
    { id: "db", kind: "db", label: "Postgres", sub: "metadata", x: 0.8, y: 0 },
    { id: "rustfs", kind: "storage", label: "RustFS", sub: "S3 API :9000", x: 0.42, y: 0.72 },
    { id: "d1", kind: "storage", label: "Drive 1", sub: "data", x: 1, y: 0.28 },
    { id: "d2", kind: "storage", label: "Drive 2", sub: "data", x: 1, y: 0.52 },
    { id: "d3", kind: "storage", label: "Drive 3", sub: "parity", x: 1, y: 0.76 },
    { id: "d4", kind: "storage", label: "Drive 4", sub: "parity", x: 1, y: 1 },
  ],
  scenarios: [
    {
      id: "upload",
      label: "Direct upload with a signed URL",
      summary: "Large files should not pass through your API. The API grants permission, and the browser talks straight to storage.",
      steps: [
        {
          phase: "Permission",
          title: "The browser asks to upload",
          body: "It sends the file's name and type, not the file. The API checks the user is allowed and the type is acceptable, then generates a random key so users cannot pick paths or overwrite each other.",
          hops: [["browser", "api", "POST /uploads", "request"]],
          card: { at: "api", title: "API", tag: "no file bytes here", rows: ["auth: who is asking?", "type: application/pdf allowed", "key: files/7f3a… (random)"] },
          code: "rustfs/uploads.ts#routes",
        },
        {
          phase: "Permission",
          title: "The API signs a URL",
          body: "It uses its secret key to sign a URL for this exact key, content type and method. The signature is computed locally, with no call to RustFS. The URL works for five minutes.",
          hops: [["api", "browser", "signed PUT URL", "response"]],
          code: "rustfs/s3.ts#presign",
        },
        {
          phase: "Upload",
          title: "The browser uploads straight to RustFS",
          body: "Your API is not involved, so a 2 GB video uses none of its memory or bandwidth. RustFS checks the signature: change the key or wait too long, and it answers 403.",
          hops: [["browser", "rustfs", "PUT cv.pdf", "data"], ["rustfs", "browser", "200 OK", "response"]],
          set: { rustfs: ["files/7f3a  private"] },
        },
        {
          phase: "Confirm",
          title: "The API records the file",
          body: "The browser reports back. The API asks RustFS for the real size, because a signed URL does not cap it, and rejects anything too big. Then it saves the key in the database.",
          hops: [["browser", "api", "POST complete", "request"], ["api", "rustfs", "HEAD files/7f3a", "request"], ["rustfs", "api", "2 MB", "response"], ["api", "db", "INSERT file row", "request"]],
          set: { db: ["key: files/7f3a"] },
        },
        {
          phase: "Download",
          title: "Reading uses another short-lived link",
          body: "The bucket stays private. The API checks permission and signs a fresh GET link, so access can be different per user and links cannot be shared for long.",
          hops: [["browser", "api", "GET /files/7f3a", "request"], ["api", "browser", "signed GET URL", "response"], ["browser", "rustfs", "GET with signature", "request"], ["rustfs", "browser", "file bytes", "data"]],
        },
      ],
    },
    {
      id: "erasure",
      label: "How a file survives a dead drive",
      summary: "RustFS does not keep whole copies. It splits each object into pieces and adds parity. These steps match what was measured on a 4-drive RustFS 1.0.4.",
      steps: [
        {
          phase: "Write",
          title: "The object is split into shards",
          body: "On 4 drives, RustFS uses 2 data shards and 2 parity shards. A 5 MB file became about 2.5 MB on each drive. That is 2× the raw size, the same cost as one mirror, but it tolerates more failures.",
          hops: [["browser", "rustfs", "PUT photo.jpg, 5 MB", "data"]],
          card: { at: "rustfs", title: "Erasure coding", tag: "2 data + 2 parity", rows: ["split into 2 data shards", "compute 2 parity shards", "add checksums to detect bitrot"] },
        },
        {
          phase: "Write",
          title: "One shard lands on each drive",
          body: "Each drive stores a `part.1` file and an `xl.meta` file describing the object. No single drive holds the whole object.",
          fan: [["rustfs", "d1", "shard 1", "data"], ["rustfs", "d2", "shard 2", "data"], ["rustfs", "d3", "parity 1", "data"], ["rustfs", "d4", "parity 2", "data"]],
          set: { d1: ["2.5 MB"], d2: ["2.5 MB"], d3: ["2.5 MB"], d4: ["2.5 MB"] },
        },
        {
          phase: "One failure",
          title: "One drive dies: everything still works",
          body: "Reads rebuild the missing piece from the others, and writes still have enough drives. Measured: with 1 of 4 drives offline, both GET and PUT succeeded.",
          down: ["d2"],
          hops: [["browser", "rustfs", "GET photo.jpg", "request"]],
          fan: [["d1", "rustfs", "shard 1", "data"], ["d3", "rustfs", "parity 1", "data"], ["d4", "rustfs", "parity 2", "data"]],
        },
        {
          phase: "Two failures",
          title: "Two drives die: read-only",
          body: "Any 2 shards can rebuild the file, so GET still works. But a PUT now returns 503. Writes need one more drive than reads, so that two halves of a split cluster cannot each accept different data.",
          down: ["d3"],
          hops: [["browser", "rustfs", "PUT new.jpg", "request"], ["rustfs", "browser", "503 unavailable", "error"]],
          card: { at: "rustfs", title: "Quorum check", tag: "2 of 4 drives alive", rows: [{ t: "read needs 2 → OK", tone: "response" }, { t: "write needs 3 → refused", tone: "error" }] },
        },
        {
          phase: "Three failures",
          title: "Three drives die: the data is gone",
          body: "One shard is not enough. Measured: both reads and writes failed. This is why drives must be separate hardware, and why RustFS refuses to start erasure coding on paths that share one physical disk.",
          down: ["d1"],
          hops: [["browser", "rustfs", "GET photo.jpg", "request"], ["rustfs", "browser", "503 unreadable", "error"]],
        },
        {
          phase: "Recovery",
          title: "Replaced drives are healed",
          body: "When drives return, the missing shards are rebuilt from the survivors. In testing, after removing an object's shards from 2 of 4 drives, reading it restored them.",
          up: ["d1", "d2", "d3"],
          set: { d2: ["healed"], d3: ["healed"] },
          fan: [["d4", "d2", "rebuild", "data"], ["d1", "d3", "rebuild", "data"]],
        },
      ],
    },
  ],
};

export const rustfs: Topic = {
  slug: "rustfs",
  title: "RustFS",
  nav: "RustFS",
  group: "Building blocks",
  lede: "Self-hosted object storage written in Rust. It speaks the S3 API, so the code you write works with AWS S3 and other S3-compatible stores too.",
  learn: [
    {
      heading: "What it is",
      blocks: [
        { p: "Object storage keeps files as objects in buckets, each with a key, the data and some metadata. There are no real folders and no in-place edits: you put a whole object and get a whole object, over HTTP." },
        { p: "RustFS is an open-source object store under the Apache 2.0 licence, written in Rust. It implements the S3 API, the standard Amazon created, which is why ordinary AWS SDKs work with it. You run it yourself, on your own hardware or cloud servers." },
      ],
    },
    {
      heading: "What problem it solves",
      blocks: [
        { p: "Every app eventually stores files: avatars, invoices, videos, exports. The usual first attempts both fail at scale." },
        {
          table: {
            head: ["Where files go", "What goes wrong"],
            rows: [
              ["The server's disk", "A second API instance cannot see the file, and a lost server loses the files"],
              ["The database", "Backups balloon, and the connections you need for queries are held by file transfers"],
              ["Object storage", "Separate from your servers, reached over HTTP, and it scales by adding drives"],
            ],
          },
        },
      ],
    },
    {
      heading: "Keep the key, not the URL",
      blocks: [
        { p: "Your database stores the object's key, such as `files/7f3a`. Build URLs when you need them. A stored URL breaks when your domain or storage changes, and a signed one expires within minutes anyway." },
      ],
    },
    {
      heading: "Signed URLs",
      blocks: [
        { p: "A signed URL carries proof of permission in its query string. Your API creates it with the secret key, locally and without a network call. RustFS recomputes the signature and refuses anything that does not match, including a changed key or an expired time. The tests for this guide confirm a tampered URL gets 403, and a plain unsigned read of a private object does too." },
      ],
    },
    {
      heading: "Erasure coding in plain words",
      blocks: [
        { p: "Suppose you store 2 numbers, a and b, plus their sum. Lose any one and you can work it out from the other two. Erasure coding is a stronger version of that idea." },
        {
          table: {
            head: ["Drives offline, of 4", "Read", "Write"],
            rows: [
              ["0", "Works", "Works"],
              ["1", "Works", "Works"],
              ["2", "Works", "503"],
              ["3", "Fails", "Fails"],
            ],
          },
        },
        { callout: "These results were measured on RustFS 1.0.4 with 4 drives, while writing this guide. Run the same test on your own layout before you rely on it.", title: "Measured, not assumed" },
      ],
    },
    {
      heading: "When to use it, and when not to",
      blocks: [
        {
          list: [
            "Use it when you want S3-style storage on your own infrastructure, for cost, data location or control.",
            "On a managed cloud with no such needs, plain S3 or R2 means no storage servers to run. Your code barely changes, so this is an easy decision to revisit.",
            "Storage for a database's data files needs a block device, not object storage.",
            "Check the project's status page for the features you depend on. Some, like MinIO on-disk compatibility, are marked as preview.",
          ],
        },
      ],
    },
  ],
  flow,
  build: {
    intro: "You will run RustFS, connect with the AWS SDK, and build the complete browser upload flow. Everything here passed against a real RustFS 1.0.4 server, including the check that an altered signature is refused.",
    needs: ["Node.js 20 or newer", "Docker Desktop"],
    install: "npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner @aws-sdk/lib-storage fastify zod",
    tree: "src/\n├─ storage/\n│  └─ s3.ts        client and helpers\n└─ uploads/\n   └─ routes.ts    the upload API",
    steps: [
      {
        title: "Run RustFS",
        explain: [
          "Port `9000` is the S3 API and `9001` is the web console. Set your own keys: the docs warn against the well-known default `rustfsadmin`.",
          "This single-drive setup is for development and has no redundancy. For erasure coding use at least 4 separate disks, with `RUSTFS_VOLUMES` set to a range like `/data/rustfs{0...3}`.",
          "RustFS refuses erasure coding when those paths share a physical disk. For local testing only, `RUSTFS_UNSAFE_BYPASS_DISK_CHECK=true` skips that check.",
        ],
        shell: "docker run -d --name rustfs \\\n  -p 9000:9000 -p 9001:9001 \\\n  -v rustfs-data:/data \\\n  -e RUSTFS_ACCESS_KEY=devaccess \\\n  -e RUSTFS_SECRET_KEY=devsecret123 \\\n  -e RUSTFS_CONSOLE_ENABLE=true \\\n  rustfs/rustfs:1.0.4",
      },
      {
        title: "Connect with the S3 client",
        explain: [
          "This is the standard AWS SDK. `endpoint` points it at your server, and moving to AWS S3 later means removing that line and changing the keys.",
          "`forcePathStyle` puts the bucket in the path (`/bucket/key`) rather than the hostname, so you do not need wildcard DNS.",
          "Credentials come from the environment. They should never be in your code, and never sent to a browser.",
        ],
        code: "rustfs/s3.ts#client",
        where: "Put this in `src/storage/s3.ts`.",
      },
      {
        title: "Create the bucket on startup",
        explain: ["`ensureBucket` is safe to run on every boot, so a new environment sets itself up."],
        code: "rustfs/s3.ts#bucket",
      },
      {
        title: "Store and read objects",
        explain: [
          "Use these for files your server creates, like generated reports. For user uploads, use signed URLs in the next step.",
          "`transformToString` reads the whole body into memory, which is fine for small text but not for large files.",
        ],
        code: "rustfs/s3.ts#put-get",
      },
      {
        title: "Create signed URLs",
        explain: [
          "The URL is signed for one key, method and content type. The browser must send that exact `Content-Type`, or the signature check fails.",
          "Keep lifetimes short. Five minutes is plenty for starting an upload.",
        ],
        code: "rustfs/s3.ts#presign",
      },
      {
        title: "Build the upload API",
        explain: [
          "Three routes make up the flow: ask for permission, report completion, and read back.",
          "`z.enum` refuses unwanted file types before any URL is issued. The key is generated, never taken from the user.",
          "A signed PUT does not limit size, so `/complete` checks the real size with `HEAD` and deletes anything too big. Do not trust the size the browser reports.",
        ],
        code: "rustfs/uploads.ts#routes",
        where: "Replace the `files` map with a table in your database, and add your authentication check to each route.",
      },
      {
        title: "Upload from the browser",
        explain: ["The browser needs no SDK and no credentials. It uses a plain `fetch` with the URL it was given. If the browser is on a different origin from RustFS, you also need a CORS rule on the bucket."],
        shellLang: "ts",
        shell: "// In your frontend\nconst { uploadUrl, id, key } = await api.post('/uploads', { fileName, contentType });\nawait fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'content-type': contentType } });\nawait api.post(`/uploads/${id}/complete`, { key, fileName });",
      },
      {
        title: "Handle large files and listing",
        explain: [
          "`Upload` splits a stream into parts and sends them in parallel. A failed part is retried on its own, and memory stays around part size × queue size. The test sends 20 MB through it.",
          "Keys are flat strings. Listing with a prefix is what makes them look like folders.",
        ],
        code: ["rustfs/s3.ts#multipart", "rustfs/s3.ts#list-delete"],
      },
    ],
    integrate: [
      "Add the S3 client beside your existing upload code, without changing it yet.",
      "Send new uploads to the new path, and keep reading old files from where they are.",
      "Copy existing files across with a background job, storing each key as you go.",
      "Remove file serving from your API once nothing reads from the old location.",
      "Back up the bucket somewhere separate. Erasure coding protects against dead drives, not against a bad delete.",
    ],
    mistakes: [
      { title: "Sending uploads through your API", text: "Each upload holds a connection and memory for its whole duration. Use signed URLs and keep your API out of the data path." },
      { title: "Trusting the client's file size or type", text: "Both come from the browser. Check the size with `HEAD`, and check the real type if it matters, such as before processing an image." },
      { title: "Public buckets", text: "One forgotten setting exposes every file. Keep buckets private and hand out signed links." },
      { title: "Using user-provided names as keys", text: "Users could overwrite each other's files. Generate a key, and keep the display name in your database." },
      { title: "Treating redundancy as a backup", text: "Erasure coding deletes all the shards when you delete an object. Backups and versioning protect against mistakes. Parity only protects against hardware." },
      { title: "Erasure coding on one disk", text: "Four folders on one disk gives no protection at all, since the disk is still a single failure. RustFS refuses this for good reason." },
    ],
  },
  simulate: {
    intro: "This models an upload path. Use the lab to see exactly how drive failures behave, then use the simulator to see what that does to users.",
    preset: "storage",
    lab: "erasure",
    labIntro: "Click drives to fail them. Try 2 of 4, then 3 of 4, and compare with the table above.",
    tries: [
      "Click RustFS and set Failed drives to 1. Uploads keep working.",
      "Set Failed drives to 2. Every upload now fails with 503, matching the measured behaviour.",
      "Lower Concurrent uploads to 5 and raise the client's traffic to see storage become the bottleneck.",
    ],
  },
  sources: [
    { label: "RustFS on GitHub", url: "https://github.com/rustfs/rustfs" },
    { label: "RustFS Docker installation", url: "https://docs.rustfs.com/installation/docker/" },
    { label: "AWS SDK for JavaScript: S3", url: "https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/" },
  ],
};
