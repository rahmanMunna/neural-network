import type { FlowSpec } from "../flow.ts";
import type { Topic } from "../topic.ts";

const flow: FlowSpec = {
  nodes: [
    { id: "client", kind: "client", label: "Client", x: 0, y: 0.45 },
    { id: "api", kind: "api", label: "API server", sub: "producer", x: 0.26, y: 0.45 },
    { id: "queue", kind: "queue", label: "BullMQ", sub: "jobs in Redis", x: 0.56, y: 0.45 },
    { id: "w1", kind: "worker", label: "Worker 1", sub: "process A", x: 0.9, y: 0.05 },
    { id: "w2", kind: "worker", label: "Worker 2", sub: "process B", x: 0.9, y: 0.45 },
    { id: "email", kind: "service", label: "Email provider", sub: "external", x: 0.9, y: 0.92 },
    { id: "failed", kind: "db", label: "Failed set", sub: "dead letters", x: 0.56, y: 0.98 },
  ],
  scenarios: [
    {
      id: "basic",
      label: "A job's life",
      summary: "A user signs up and should get a welcome email. Sending takes seconds and can fail, so the API hands it off and answers at once.",
      steps: [
        {
          phase: "Add",
          title: "The API adds a job and answers immediately",
          body: "`queue.add` writes the job to Redis, which takes about a millisecond. The user is not left waiting on a mail server, and the email survives even if this API process crashes next.",
          hops: [["client", "api", "POST /signup", "request"], ["api", "queue", "add welcome", "job"], ["api", "client", "201 Created", "response"]],
          set: { queue: ["waiting: 1"] },
          code: "bullmq/queue.ts#produce",
        },
        {
          phase: "Process",
          title: "A worker pulls the job",
          body: "Workers ask for work when they have capacity. Nothing is pushed at them, so a slow worker simply takes less. BullMQ moves the job to active and takes a lock on it.",
          hops: [["queue", "w1", "job welcome-1", "job"]],
          set: { queue: ["active: 1"], w1: ["running welcome-1"] },
          code: "bullmq/worker.ts#worker",
        },
        {
          phase: "Process",
          title: "The work happens, far from any user",
          body: "The worker calls the email provider. It can take as long as it needs. If the process dies here, the lock expires, BullMQ notices the stalled job, and another worker picks it up.",
          hops: [["w1", "email", "send email", "job"], ["email", "w1", "messageId", "response"]],
        },
        {
          phase: "Done",
          title: "The job completes",
          body: "The return value is stored on the job, and it moves to completed. `removeOnComplete` keeps Redis from slowly filling up with finished jobs.",
          hops: [["w1", "queue", "completed", "job"]],
          set: { queue: ["completed: 1"], w1: null },
        },
      ],
    },
    {
      id: "retry",
      label: "Failure and retries",
      summary: "External services fail all the time. A queue turns a temporary failure into a short delay, rather than a lost email.",
      steps: [
        {
          phase: "Attempt 1",
          title: "The first attempt fails",
          body: "The email provider times out, so the handler throws. Nothing is lost. BullMQ records the error and works out when to try again.",
          hops: [["queue", "w1", "attempt 1 of 5", "job"], ["w1", "email", "send", "job"], ["email", "w1", "503", "error"]],
          card: { at: "queue", title: "BullMQ", tag: "exponential backoff", tone: "job", rows: ["attempts made: 1 of 5", "delay = 1s × 2^(attempt − 1)", { t: "move to delayed for 1s", tone: "job" }] },
          set: { queue: ["delayed: 1"] },
        },
        {
          phase: "Backoff",
          title: "Waiting longer each time",
          body: "Delays of 1s, 2s, 4s and 8s give a struggling service room to recover. Retrying instantly would only add to the overload.",
          hops: [["queue", "w2", "attempt 2 of 5", "job"], ["w2", "email", "send", "job"], ["email", "w2", "503", "error"]],
          set: { queue: ["delayed: 1, wait 2s"] },
          code: "bullmq/queue.ts#queue",
        },
        {
          phase: "Success",
          title: "The third attempt works",
          body: "The provider has recovered, so the job completes. The user gets their email a few seconds late, and nobody had to do anything.",
          hops: [["queue", "w1", "attempt 3 of 5", "job"], ["w1", "email", "send", "job"], ["email", "w1", "messageId", "response"], ["w1", "queue", "completed", "job"]],
          set: { queue: ["completed: 1"] },
        },
        {
          phase: "Dead letter",
          title: "Some jobs can never succeed",
          body: "Retrying a malformed address only wastes attempts. Throwing `UnrecoverableError` moves it straight to failed. There it waits for a person, with its error and its data intact.",
          hops: [["queue", "w2", "to: not-an-address", "job"], ["w2", "failed", "UnrecoverableError", "error"]],
          set: { failed: ["1 job to inspect"] },
          code: "bullmq/worker.ts#dead-letter",
        },
      ],
    },
    {
      id: "scale",
      label: "Scaling with workers",
      summary: "The queue absorbs bursts, and workers drain it at their own pace. This separates how fast work arrives from how fast it gets done.",
      steps: [
        {
          phase: "Burst",
          title: "A burst arrives",
          body: "1,000 jobs land in a few seconds. Calling the mail server directly would overload it. Instead, they wait safely in Redis.",
          hops: [["api", "queue", "add × 1000", "job"]],
          set: { queue: ["waiting: 1000"] },
        },
        {
          phase: "Concurrency",
          title: "Each worker handles several jobs at once",
          body: "`concurrency: 10` lets one process run 10 jobs at the same time. That suits work that waits on the network. CPU-heavy work blocks Node's event loop, so it needs more processes instead.",
          fan: [["queue", "w1", "10 jobs", "job"], ["queue", "w2", "10 jobs", "job"]],
          set: { queue: ["waiting: 980", "active: 20"], w1: ["10 active"], w2: ["10 active"] },
        },
        {
          phase: "Limit",
          title: "The limiter protects the provider",
          body: "`limiter: { max: 100, duration: 60000 }` applies across all workers on the queue, so adding workers cannot break your provider's rate limit. Spare jobs simply wait.",
          fan: [["w1", "email", "100 per minute", "job"], ["w2", "email", "shared limit", "job"]],
          card: { at: "email", title: "Email provider", tag: "limit respected", tone: "response", rows: ["limit: 100 per minute", "sent: 100, then workers pause", "no 429 responses"] },
        },
      ],
    },
  ],
};

export const bullmq: Topic = {
  slug: "bullmq",
  title: "BullMQ",
  nav: "BullMQ",
  group: "Building blocks",
  lede: "A job queue for Node.js, backed by Redis. It moves slow or unreliable work out of the request, then runs it in the background with retries, delays and rate limits.",
  learn: [
    {
      heading: "What it is",
      blocks: [
        { p: "A message queue separates asking for work from doing it. A producer adds a job and moves on. A worker, usually a separate process, takes jobs and does them. Between the two sits a broker that holds the jobs safely." },
        { p: "BullMQ is that system for Node.js, using Redis as the broker. Jobs are stored in Redis, and it provides the parts you would otherwise build yourself: retries, delays, priorities, scheduling and parent-child workflows." },
      ],
    },
    {
      heading: "What problem it solves",
      blocks: [
        { p: "An HTTP request should take milliseconds. But real features call slow things: email, payments, video processing, reports. Doing that work inside the request causes four problems at once." },
        {
          table: {
            head: ["Problem without a queue", "With a queue"],
            rows: [
              ["The user waits for the slow work", "The API answers right away"],
              ["If the email server is down, the signup fails", "The job retries until it works"],
              ["A traffic burst overloads the downstream service", "Jobs wait, and workers drain them at a safe rate"],
              ["A crash loses work in progress", "The job is in Redis, and another worker takes over"],
            ],
          },
        },
      ],
    },
    {
      heading: "The words you will see",
      blocks: [
        {
          table: {
            head: ["Term", "Meaning"],
            rows: [
              ["Queue", "A named list of jobs of one kind, like email"],
              ["Job", "One unit of work: a name, data and options"],
              ["Producer", "The code that adds jobs, usually your API"],
              ["Worker", "The code that processes jobs, in its own process"],
              ["Broker", "The system holding the jobs. Here, Redis"],
              ["Concurrency", "How many jobs one worker runs at the same time"],
              ["Backoff", "How long to wait before a retry"],
            ],
          },
        },
      ],
    },
    {
      heading: "The states a job moves through",
      blocks: [
        {
          steps: [
            "`waiting`: ready to run, or `prioritized` if it has a priority.",
            "`delayed`: holding until a time, either from a `delay` option or a retry backoff.",
            "`active`: a worker holds it, and a lock is renewed while it runs.",
            "`completed` or `failed`: finished. `failed` means every attempt ran out.",
            "`waiting-children`: a parent in a flow, waiting for its children.",
          ],
        },
      ],
    },
    {
      heading: "Jobs can run twice, so make them safe to repeat",
      blocks: [
        { p: "BullMQ delivers a job at least once, not exactly once. If a worker dies after sending an email but before reporting success, the job runs again. So handlers must be idempotent: running one twice must do no extra harm. Check whether the work is already done, or pass an idempotency key to the service you are calling." },
        { callout: "BullMQ 6 removed repeatable jobs in favour of Job Schedulers, and removed the `debounce` option in favour of deduplication. Older tutorials showing `repeat` will not work.", title: "Using a current version" },
      ],
    },
    {
      heading: "When not to use it",
      blocks: [
        {
          list: [
            "If the user needs the answer in the same response, a queue only hides the wait.",
            "If work is tiny and reliable, a plain function call is simpler.",
            "For streaming events to many independent consumers with replay, look at Kafka or Redis Streams. A job queue hands each job to one worker.",
            "If you are not on Node.js, use your language's equivalent. BullMQ also offers Python, Elixir and PHP packages.",
          ],
        },
      ],
    },
  ],
  flow,
  build: {
    intro: "You will build a reliable email queue with retries, a dead-letter path, scheduling and graceful shutdown. This code passes against a real Redis using BullMQ 6, including a test proving a surprising rule about priorities.",
    needs: ["Node.js 20 or newer", "Redis, with `maxmemory-policy noeviction`"],
    install: "npm install bullmq\ndocker run -d --name queue-redis -p 6379:6379 redis:8-alpine \\\n  redis-server --maxmemory-policy noeviction",
    tree: "src/\n├─ queues/\n│  ├─ connection.ts   Redis settings\n│  └─ email.ts        queue and producers\n└─ workers/\n   └─ email.ts        runs as its own process",
    steps: [
      {
        title: "Define the connection",
        explain: [
          "Pass connection options, not a shared client. BullMQ opens what it needs, including a blocking connection for workers.",
          "If you do pass your own ioredis instance to a Worker, it must have `maxRetriesPerRequest: null`. Passing options, as here, sets that for you.",
        ],
        code: "bullmq/connection.ts#connection",
        where: "Put this in `src/queues/connection.ts`.",
      },
      {
        title: "Create the queue",
        explain: [
          "The type parameter makes `add` check your job data at compile time, so a producer and worker cannot disagree on the shape.",
          "`attempts: 5` means five tries in total. Exponential backoff waits 1, 2, 4, then 8 seconds.",
          "`removeOnComplete` and `removeOnFail` are essential. By default, finished jobs stay in Redis forever, and memory grows until something breaks. Keep failures for longer, since those are what you debug.",
        ],
        code: "bullmq/queue.ts#queue",
        where: "Put this in `src/queues/email.ts`. Your API imports it, and the worker imports only its types.",
      },
      {
        title: "Add jobs from your API",
        explain: [
          "`await emailQueue.add` returns once the job is safely in Redis, so your route can respond right away.",
          "A custom `jobId` makes the add idempotent. A double-clicked signup still produces one email, because a second job with the same id is ignored while the first still exists.",
        ],
        code: "bullmq/queue.ts#produce",
        where: "Call this from your route handler, after the database write commits.",
      },
      {
        title: "Write the worker",
        explain: [
          "A Worker is a loop that pulls jobs and runs your function. Returning succeeds the job, and throwing fails the attempt.",
          "`UnrecoverableError` means retrying is pointless. It goes straight to failed.",
          "`concurrency` is per process and suits work that waits on the network. CPU-heavy work blocks the event loop, so start more processes instead.",
          "`limiter` is shared by every worker on the queue, so scaling up cannot exceed your provider's limit.",
        ],
        code: "bullmq/worker.ts#worker",
        where: "Run this as a separate process, so `node dist/workers/email.js` is its own deployment. Then a bad job cannot slow your API, and each scales independently.",
      },
      {
        title: "Catch jobs that finally fail",
        explain: [
          "The `failed` event also fires for attempts that will be retried. Checking `job.isFailed()` tells you this was the final failure, and it also catches `UnrecoverableError`, where the attempts were not used up.",
          "Alert a person here. A failed job holds its data and error, so it can be fixed and retried.",
        ],
        code: "bullmq/worker.ts#dead-letter",
      },
      {
        title: "Delays and priorities",
        explain: [
          "A `delay` holds a job and then releases it by itself.",
          "Priorities have a trap, proved by this guide's tests: a job with no priority runs ahead of every prioritised job. So `priority: 1` alone actually makes a job slower than normal ones. Once you use priorities, give every job one.",
        ],
        code: "bullmq/queue.ts#delayed",
      },
      {
        title: "Schedule recurring work",
        explain: [
          "`upsertJobScheduler` is the BullMQ 6 way. Because it upserts by id, calling it at every boot leaves exactly one schedule, with no duplicates.",
          "The pattern has six fields, with seconds first. This one runs at 08:00:00 UTC.",
        ],
        code: "bullmq/queue.ts#schedule",
      },
      {
        title: "Run steps in order with flows",
        explain: ["A flow is a tree. The parent waits in `waiting-children` until all its children finish, then reads their results with `getChildrenValues`. That lets you fan out work and then combine it."],
        code: "bullmq/flow.ts#flow",
      },
      {
        title: "React to jobs from anywhere",
        explain: ["`QueueEvents` works from any process, so your API can notify a user when a worker elsewhere finishes. Unlike worker events, it hears about every worker on the queue."],
        code: "bullmq/events.ts#events",
      },
      {
        title: "Shut down gracefully",
        explain: ["Every deploy stops your workers. `worker.close()` stops taking new jobs and waits for running ones to finish, so a deploy does not leave work half done for the stalled-job check to recover."],
        code: "bullmq/worker.ts#shutdown",
      },
    ],
    integrate: [
      "Find one slow step inside a request, such as sending an email.",
      "Move that step's code into a worker function, keeping the same logic.",
      "Replace the original call with `queue.add`, passing only ids and small data, not whole records.",
      "Make the handler safe to run twice before going live.",
      "Add a dashboard or a metric for waiting and failed counts. A growing backlog is the first sign of trouble.",
    ],
    mistakes: [
      { title: "No removeOnComplete", text: "Every finished job stays in Redis until memory runs out. It is the most common BullMQ production incident." },
      { title: "Redis eviction enabled", text: "With a policy like `allkeys-lru`, Redis may delete job keys under memory pressure, and work silently vanishes. Use `noeviction`, in a separate instance from your cache." },
      { title: "Assuming exactly-once", text: "Jobs can run twice after a crash. A non-idempotent payment handler will charge a customer twice." },
      { title: "Adding the job before the database commits", text: "The worker can run before the row exists, or the commit can fail after the job was queued. Add jobs after the commit, or use the outbox pattern from the Microservices guide." },
      { title: "Using priority on only some jobs", text: "Jobs with no priority overtake all prioritised jobs. The urgent job ends up behind everything else." },
      { title: "Huge job payloads", text: "Job data lives in Redis memory. Pass an id or an object key, and load the rest in the worker." },
    ],
  },
  simulate: {
    intro: "Each request adds a job, and the worker processes it in the background. Notice that latency stays low even when workers are overwhelmed: that is the whole point.",
    preset: "queue",
    tries: [
      "Press Run. Jobs arrive at 60 per second, but one worker handles about 25, so the backlog grows without limit.",
      "Click Worker and raise Concurrency to 20. The backlog drains. Find the point where it stops growing.",
      "Raise Failure rate to 50%. Retries add load, and the delayed count climbs.",
      "Take the Worker down. The API keeps answering, jobs wait safely, and they resume when you bring it back.",
    ],
  },
  sources: [
    { label: "BullMQ documentation", url: "https://docs.bullmq.io/" },
    { label: "Migrating from BullMQ v5 to v6", url: "https://docs.bullmq.io/guide/migrations/migrate-from-v5-to-v6" },
  ],
};
