import type { Topic } from "../topic.ts";

export const nTier: Topic = {
  slug: "n-tier",
  title: "N-Tier Architecture",
  nav: "N-Tier",
  group: "Architecture",
  lede: "Split an application into stacked tiers, where each one talks only to the next. It is the oldest useful idea in backend design, and most systems still follow it.",
  learn: [
    {
      heading: "What it is",
      blocks: [
        { p: "Each tier has one responsibility and depends only on the tier below it. The classic version has three: presentation handles HTTP, business logic holds the rules, and data talks to the database." },
        {
          table: {
            head: ["Tier", "Responsible for", "Must not know about"],
            rows: [
              ["Presentation", "HTTP, input shape, status codes", "SQL, business rules"],
              ["Business", "Rules and workflows", "HTTP, table names"],
              ["Data", "Queries and transactions", "HTTP, business decisions"],
            ],
          },
        },
      ],
    },
    {
      heading: "What problem it solves",
      blocks: [
        { p: "Without structure, a route handler parses input, checks rules, runs SQL and formats output all in one place. Nothing can be tested without a server and a database, and changing the database means editing every route." },
        { p: "With tiers, a change has one obvious home. A new rule goes in the business tier, and a schema change stays in the data tier. The business tier can be tested with no database at all, which this guide's tests do." },
      ],
    },
    {
      heading: "Tier or layer?",
      blocks: [
        { p: "A layer is a logical separation in code. A tier is a physical one, running as a separate deployment. The code below shows three layers in one process. Run the web servers, application servers and database on separate machines, and they become tiers. Good layering is what makes that split possible." },
      ],
    },
    {
      heading: "When not to use it",
      blocks: [
        {
          list: [
            "For a small script or a thin CRUD service, three layers can be ceremony with nothing in the middle.",
            "If every feature changes all three tiers, consider grouping by feature instead. See Modular Monolith.",
          ],
        },
      ],
    },
  ],
  flow: {
    nodes: [
      { id: "client", kind: "client", label: "Client", x: 0, y: 0.4 },
      { id: "web", kind: "lb", label: "Presentation", sub: "routes", x: 0.32, y: 0.4 },
      { id: "app", kind: "api", label: "Business", sub: "AccountService", x: 0.64, y: 0.4 },
      { id: "data", kind: "service", label: "Data", sub: "repository", x: 0.92, y: 0.05 },
      { id: "db", kind: "db", label: "Postgres", sub: "accounts", x: 0.92, y: 0.85 },
    ],
    scenarios: [
      {
        id: "transfer",
        label: "A money transfer",
        summary: "Moving money between accounts crosses every tier, and each one does only its own job.",
        steps: [
          { phase: "Presentation", title: "The route checks the shape of the input", body: "It confirms the amount is a positive integer. It does not know whether the balance is enough, because that is a business rule.", hops: [["client", "web", "POST /transfers", "request"]], card: { at: "web", title: "Presentation", tag: "HTTP only", rows: ["parse JSON body", "cents is a positive integer", "call service.transfer()"] }, code: "n-tier/presentation.ts#presentation" },
          { phase: "Business", title: "The service applies the rules", body: "It has no idea HTTP exists. It locks accounts in a fixed order, so that two opposite transfers cannot deadlock, then checks the balance.", hops: [["web", "app", "transfer(a, b, 2500)", "request"]], card: { at: "app", title: "Business", tag: "the rules", rows: ["lock in sorted order", "source balance ≥ amount?", { t: "7500 + 12500 = same total", tone: "response" }] }, code: "n-tier/business.ts#business" },
          { phase: "Data", title: "The repository speaks SQL", body: "Only this tier knows tables exist. `FOR UPDATE` holds the rows until commit, so a concurrent transfer waits rather than reading a balance about to change.", hops: [["app", "data", "lockBalance(a)", "request"], ["data", "db", "SELECT … FOR UPDATE", "request"], ["db", "data", "cents: 10000", "response"], ["data", "db", "UPDATE, COMMIT", "request"]], set: { db: ["a: 7500", "b: 12500"] }, code: "n-tier/data.ts#data" },
          { phase: "Response", title: "Each tier translates on the way back", body: "If funds were short, the service throws a domain error and the route turns it into `409`. Status codes stay in the tier that speaks HTTP.", hops: [["app", "web", "ok", "response"], ["web", "client", "200 OK", "response"]] },
        ],
      },
    ],
  },
  build: {
    intro: "You will build a transfer endpoint across three layers. The tests prove that opposite concurrent transfers neither deadlock nor lose money, and that the business rules run with no database.",
    needs: ["Node.js 20 or newer", "Postgres (see the docker-compose file in Client-Server)"],
    install: "npm install fastify zod pg\nnpm install -D @types/pg",
    tree: "src/\n├─ presentation.ts   routes\n├─ business.ts       rules\n└─ data.ts           SQL",
    steps: [
      { title: "Write the business tier first", explain: ["Start in the middle. The interface says what the rules need from storage, without saying how, so nothing here depends on Postgres.", "`[from, to].sort()` locks accounts in a fixed order. Without it, a transfer from A to B and one from B to A can each hold one lock and wait forever for the other.", "`InsufficientFunds` is a domain error. It says what went wrong, and leaves the status code to someone else."], code: "n-tier/business.ts#business", where: "This is your service layer." },
      { title: "Implement the data tier", explain: ["This class implements the interface. It is the only file containing SQL.", "`FOR UPDATE` locks the row for the transaction, which stops two transfers overspending the same balance. The test fires 20 at once, and exactly 10 succeed.", "The `finally` returns the connection to the pool. Forget it and the pool slowly runs dry."], code: "n-tier/data.ts#data" },
      { title: "Add the presentation tier", explain: ["The route parses input and maps outcomes to status codes, and that is all. Every rule stays in the service."], code: "n-tier/presentation.ts#presentation" },
    ],
    integrate: [
      "Pick one fat route handler and move its SQL into a repository function.",
      "Move the remaining decisions into a service function, leaving the route to parse and respond.",
      "Pass the repository into the service, so tests can give it a fake.",
      "Repeat when you next touch a route. There is no need to rewrite everything at once.",
    ],
    mistakes: [
      { title: "Business rules in the route", text: "They cannot be reused by a worker or a script, and they can only be tested through HTTP." },
      { title: "Leaking HTTP into the service", text: "If a service takes a `req` or returns a status code, it can only ever be called from a route." },
      { title: "Inconsistent lock order", text: "Locking rows in request order causes deadlocks under load. Always lock in a sorted order." },
    ],
  },
  simulate: {
    intro: "Three tiers with two application servers. The tiers scale separately, which is the main operational benefit.",
    preset: "n-tier",
    tries: [
      "Take down App server 1. The web tier keeps serving through the other.",
      "Raise traffic until the Data tier saturates. Adding more app servers will not help, because the bottleneck moved.",
    ],
  },
};

export const monolith: Topic = {
  slug: "monolith",
  title: "Monolith",
  nav: "Monolith",
  group: "Architecture",
  lede: "One codebase, one deployment, one database. It is simpler than its reputation suggests, and the right starting point for most products.",
  learn: [
    {
      heading: "What it is",
      blocks: [
        { p: "All features live in one application, deployed as a unit. Modules call each other as plain functions, and everything shares one database." },
        { p: "Monolith is often used as an insult, but that confuses the deployment model with bad code. A monolith can be cleanly structured, and many very large products run on one." },
      ],
    },
    {
      heading: "What it gives you",
      blocks: [
        {
          table: {
            head: ["Advantage", "Why it matters"],
            rows: [
              ["Real transactions", "Stock, order and payment commit together, or not at all"],
              ["Simple operations", "One thing to deploy, monitor and debug"],
              ["Fast calls", "A function call, not a network round trip"],
              ["Easy refactoring", "Your compiler sees everything, so a rename is safe"],
            ],
          },
        },
      ],
    },
    {
      heading: "What eventually hurts",
      blocks: [
        {
          list: [
            "All code shares one deploy, so one team's bug blocks everyone's release.",
            "You scale everything together, even if only one feature is busy.",
            "One memory leak can take down all features at once.",
            "Without discipline, modules grow tangled until no one can safely change anything.",
          ],
        },
        { callout: "Those problems appear at a team and traffic scale most products never reach. Start here, keep it modular, and split only when you can name the pain you are solving.", title: "Default choice" },
      ],
    },
  ],
  flow: {
    nodes: [
      { id: "client", kind: "client", label: "Client", x: 0, y: 0.45 },
      { id: "app", kind: "api", label: "Monolith", sub: "one process", x: 0.45, y: 0.45 },
      { id: "db", kind: "db", label: "Shared Postgres", sub: "one transaction", x: 1, y: 0.45 },
    ],
    scenarios: [
      {
        id: "checkout",
        label: "Checkout in one transaction",
        summary: "This is the monolith's best feature. Three writes either all happen, or none do.",
        steps: [
          { phase: "Begin", title: "One transaction opens", body: "Everything lives in one database, so one `BEGIN` covers the whole business operation.", hops: [["client", "app", "POST /checkout", "request"], ["app", "db", "BEGIN", "request"]], code: "monolith/shop.ts#checkout" },
          { phase: "Work", title: "Stock, order, payment", body: "The stock update includes `stock >= quantity` in its WHERE clause. That single statement is atomic, so stock can never go below zero, even with 20 concurrent buyers and 5 items.", hops: [["app", "db", "UPDATE stock", "request"], ["app", "db", "INSERT order", "request"], ["app", "db", "INSERT payment", "request"]], card: { at: "db", title: "Transaction", tag: "not visible yet", rows: ["stock 5 → 4", "order 101 created", "payment recorded"] } },
          { phase: "Failure", title: "If anything fails, nothing happened", body: "If the payment insert fails, `ROLLBACK` undoes the stock and the order too. There is no half-finished state to clean up. Doing this across services takes far more work.", hops: [["db", "app", "error", "error"], ["app", "db", "ROLLBACK", "error"]], set: { db: ["stock back to 5", "no order"] } },
          { phase: "Commit", title: "On success, all of it appears at once", body: "`COMMIT` makes all three visible together. No other request ever saw a half-done checkout.", hops: [["app", "db", "COMMIT", "request"], ["app", "client", "200 order 101", "response"]], set: { db: ["stock 4", "order 101 paid"] } },
        ],
      },
    ],
  },
  build: {
    intro: "You will build a checkout whose three writes succeed or fail together. The tests force the last step to fail and confirm every earlier step is undone.",
    needs: ["Node.js 20 or newer", "Postgres"],
    install: "npm install fastify zod pg\nnpm install -D @types/pg",
    steps: [
      { title: "Write the transaction", explain: ["All three writes use the same `client`, which means the same transaction. Using `pool.query` here would give each statement its own connection and no transaction at all.", "The conditional `UPDATE` both checks and takes stock in one atomic statement. Reading stock first and updating later is a race.", "`ROLLBACK` is in `catch`, and `release` is in `finally`, so an error can never leak a connection."], code: "monolith/shop.ts#checkout", where: "Put this in your orders service." },
      { title: "Expose it", explain: ["`OutOfStock` becomes a `409`, so the customer gets a clear message and the logs show no false alarm."], code: "monolith/shop.ts#route" },
    ],
    integrate: [
      "Look for multi-step writes that use `pool.query` for each step. Those are not atomic today, and a crash between them leaves bad data.",
      "Wrap them in one transaction on one client.",
      "Replace read-then-write checks with conditional updates.",
    ],
    mistakes: [
      { title: "Using pool.query inside a transaction", text: "Each call may use a different connection, so `BEGIN` on one and `UPDATE` on another gives no transaction." },
      { title: "Calling external services inside a transaction", text: "A slow payment API holds your row locks the whole time. Do network calls outside, and use a queue for side effects." },
      { title: "Check-then-act", text: "`if (stock > 0)` followed by an update lets two buyers take the last item. Put the condition in the UPDATE." },
    ],
  },
  simulate: {
    intro: "Two copies of the same application behind a load balancer, sharing one database.",
    preset: "monolith",
    tries: [
      "Press Traffic spike. Both copies get busy together, and everything shares the fate of the database.",
      "Raise CPU time on Monolith 1 to imagine one slow feature. Every feature on that instance now suffers.",
    ],
  },
};

export const modularMonolith: Topic = {
  slug: "modular-monolith",
  title: "Modular Monolith",
  nav: "Modular Monolith",
  group: "Architecture",
  lede: "One deployment, with hard internal boundaries. You get a monolith's simplicity and a microservice's structure, and can still split later if you need to.",
  learn: [
    {
      heading: "What it is",
      blocks: [
        { p: "A monolith divided into modules by business capability, such as catalog, orders and billing. Each module owns its data and exposes a small public API. Other modules may use that API and nothing else." },
        { p: "The difference from an ordinary monolith is enforcement. A rule that only lives in a document decays within months. Here, a check in CI fails the build when a module reaches into another's private files." },
      ],
    },
    {
      heading: "What problem it solves",
      blocks: [
        { p: "Ordinary monoliths tangle, and every module ends up touching every table. Microservices fix that by adding a network between modules, which brings a heavy operational cost. A modular monolith gets the clean boundaries without paying for the network." },
        {
          table: {
            head: ["", "Monolith", "Modular monolith", "Microservices"],
            rows: [
              ["Deployments", "One", "One", "Many"],
              ["Boundaries", "By convention", "Enforced", "Enforced by network"],
              ["Calls", "Function", "Function", "Network"],
              ["Transactions", "Easy", "Easy, within reason", "Hard"],
              ["Operational cost", "Low", "Low", "High"],
            ],
          },
        },
      ],
    },
    {
      heading: "Two ways modules communicate",
      blocks: [
        { p: "Use a direct call when you need an answer now: orders asks catalog to reserve stock. Use an event when you are announcing a fact: orders says an order was placed, and notifications reacts. Orders does not even know notifications exists, so you can add listeners without changing it." },
      ],
    },
  ],
  flow: {
    nodes: [
      { id: "client", kind: "client", label: "Client", x: 0, y: 0.45 },
      { id: "orders", kind: "module", label: "orders", sub: "module", x: 0.34, y: 0.45 },
      { id: "catalog", kind: "module", label: "catalog", sub: "module", x: 0.72, y: 0.05 },
      { id: "bus", kind: "queue", label: "Event bus", sub: "in-process", x: 0.72, y: 0.85 },
      { id: "notify", kind: "module", label: "notifications", sub: "module", x: 1, y: 0.45 },
    ],
    scenarios: [
      {
        id: "order",
        label: "Placing an order",
        summary: "All of these boxes run inside one process. The arrows are function calls, but only along permitted paths.",
        steps: [
          { phase: "Call", title: "Orders asks catalog through its public API", body: "Orders imports from `catalog/index.ts` and nothing deeper. Catalog's tables and helpers stay private, so catalog can change them freely.", hops: [["client", "orders", "place order", "request"], ["orders", "catalog", "reserve(sku, 2)", "request"], ["catalog", "orders", "{ unitPrice }", "response"]], set: { catalog: ["stock 3 → 1"] }, code: "modular-monolith/orders/index.ts#orders" },
          { phase: "Event", title: "Orders announces a fact", body: "`order.placed` says what happened, not what should happen next. Orders has finished its job.", hops: [["orders", "bus", "order.placed", "job"]], code: "modular-monolith/events.ts#events" },
          { phase: "Event", title: "Any module can react", body: "Notifications listens and sends a message. Adding analytics tomorrow means one new listener, with no change to orders.", hops: [["bus", "notify", "order.placed", "job"]], set: { notify: ["sent: Order 1 confirmed"] }, code: "modular-monolith/notifications/index.ts#notifications" },
          { phase: "Blocked", title: "A forbidden import fails the build", body: "If someone imports `catalog/store.js` directly, the boundary check reports it and CI fails. This is what stops a modular monolith decaying into a tangled one.", hops: [["orders", "catalog", "import store.js", "error"]], card: { at: "orders", title: "Boundary check", tag: "in CI", tone: "error", rows: [{ t: "orders/index.ts → catalog/store.js", tone: "error" }, "only index.js may be imported", { t: "build failed", tone: "error", strong: true }] }, code: "modular-monolith/boundaries.ts#boundaries" },
        ],
      },
    ],
  },
  build: {
    intro: "You will structure an app into modules with one public door each, connect them with typed events, and enforce the boundaries with a script.",
    needs: ["Node.js 20 or newer"],
    tree: "src/\n├─ catalog/\n│  ├─ index.ts      public API\n│  └─ store.ts      private\n├─ orders/\n│  └─ index.ts\n├─ notifications/\n│  └─ index.ts\n├─ events.ts        event contract\n└─ app.ts           wires modules together",
    steps: [
      { title: "Give each module one public door", explain: ["`index.ts` is the module's contract. It exports what others may use, and everything else in the folder is private.", "Returning `null` for no stock keeps the API simple. Callers never need to know how stock is stored."], code: "modular-monolith/catalog/index.ts#catalog-public" },
      { title: "Define events in one typed place", explain: ["`DomainEvents` is a contract. TypeScript checks every publish and listener against it, so you cannot publish a malformed event.", "This bus runs in-process. To split a module out later, replace this one file with a real queue, and the modules do not change."], code: "modular-monolith/events.ts#events" },
      { title: "Depend on interfaces, not implementations", explain: ["Orders receives its dependencies as parameters. It imports only a type from catalog, so the coupling is visible and tests can pass fakes."], code: "modular-monolith/orders/index.ts#orders" },
      { title: "React to events", explain: ["This module exports nothing for others to call. It only listens."], code: "modular-monolith/notifications/index.ts#notifications" },
      { title: "Wire everything in one place", explain: ["This is the only file that knows every module. Reading it tells you exactly how the system fits together."], code: "modular-monolith/app.ts#compose" },
      { title: "Enforce boundaries in CI", explain: ["The script scans imports and reports any that reach past another module's `index`. The test confirms it catches a real violation and passes this project.", "Tools like dependency-cruiser do the same with more features. What matters is that a machine checks it."], code: "modular-monolith/boundaries.ts#boundaries", where: "Run it in a test or a CI step, and fail the build on any result." },
    ],
    integrate: [
      "List your business capabilities, and draw module borders around them.",
      "Move files into module folders, without changing behaviour.",
      "Add an `index.ts` for each and route all cross-module imports through it.",
      "Add the boundary check in warning mode, fix the violations, then make it fail the build.",
      "Give each module its own tables, or at least its own schema, so no module queries another's data.",
    ],
    mistakes: [
      { title: "Sharing tables between modules", text: "If two modules read the same table, they cannot change it independently, and the boundary is fiction." },
      { title: "Boundaries without enforcement", text: "One deadline-driven import starts the decay. Make the build fail." },
      { title: "A shared module that grows forever", text: "A `common` folder collects everything and couples everyone. Keep it small and generic." },
      { title: "Events for everything", text: "If you need an answer, make a call. Chains of events make a flow hard to follow." },
    ],
  },
  simulate: {
    intro: "From the outside a modular monolith looks exactly like a monolith: its modules are an internal matter, so it deploys and scales the same way. That is the point.",
    preset: "monolith",
    tries: [
      "Notice there is one kind of box here. Modules cost nothing at runtime, unlike the services on the Microservices page.",
      "Compare this with the Microservices simulator: same work, far more moving parts.",
    ],
  },
};

export const microservices: Topic = {
  slug: "microservices",
  title: "Microservices",
  nav: "Microservices",
  group: "Architecture",
  lede: "Independent services, each with its own database and deployment, talking over the network. They let large teams move independently, at a real cost in complexity.",
  learn: [
    {
      heading: "What it is",
      blocks: [
        { p: "Each business capability runs as its own deployable service, owns its data, and talks to others through APIs or events. No service may reach into another's database." },
      ],
    },
    {
      heading: "What problem it actually solves",
      blocks: [
        { p: "The main benefit is organisational. When hundreds of engineers share one deployment, they block each other. Separate services let teams release independently. Scaling hot parts separately and isolating failures are useful extras." },
        { callout: "Microservices do not make code cleaner or systems faster. A function call became a network call that can fail, time out and arrive twice. If you have one team, you probably want a modular monolith.", title: "Be honest about why" },
      ],
    },
    {
      heading: "What the network costs you",
      blocks: [
        {
          table: {
            head: ["In a monolith", "With microservices", "What you need"],
            rows: [
              ["A call always arrives", "It can fail or hang", "Timeouts, retries"],
              ["A failure is an exception", "A failure can cascade", "Circuit breakers"],
              ["One transaction", "No shared transaction", "Sagas, outbox"],
              ["One log file", "A request spans services", "Tracing, correlation ids"],
              ["A retry is harmless", "A retry can double a charge", "Idempotency keys"],
            ],
          },
        },
      ],
    },
    {
      heading: "The dual write problem",
      blocks: [
        { p: "Saving an order and then publishing an event are writes to two systems. Crash between them and the order exists but no one hears about it. Publish first and the event can describe an order that never saved." },
        { p: "The outbox pattern fixes this. Write the event into an `outbox` table inside the same transaction as the order, so both commit or neither does. A separate relay then publishes it." },
      ],
    },
  ],
  flow: {
    nodes: [
      { id: "client", kind: "client", label: "Client", x: 0, y: 0.4 },
      { id: "gw", kind: "lb", label: "API gateway", x: 0.2, y: 0.4 },
      { id: "orders", kind: "service", label: "Orders", sub: "service", x: 0.46, y: 0.4 },
      { id: "ordersdb", kind: "db", label: "Orders DB", sub: "+ outbox", x: 0.46, y: 1 },
      { id: "inv", kind: "service", label: "Inventory", sub: "service", x: 0.78, y: 0 },
      { id: "invdb", kind: "db", label: "Inventory DB", x: 1, y: 0.4 },
      { id: "relay", kind: "worker", label: "Outbox relay", x: 0.72, y: 1 },
      { id: "queue", kind: "queue", label: "BullMQ", sub: "order events", x: 1, y: 1 },
    ],
    scenarios: [
      {
        id: "call",
        label: "A safe call between services",
        summary: "A call across the network can fail in ways a function call never does. Each protection below handles one of those failures.",
        steps: [
          { phase: "Call", title: "Every call has a timeout", body: "Orders calls Inventory with `AbortSignal.timeout(500)`. A hung service then costs half a second, rather than a blocked request that lasts forever.", hops: [["client", "gw", "POST /orders", "request"], ["gw", "orders", "POST /orders", "request"], ["orders", "inv", "reserve, key: 7a1f", "request"]], code: "microservices/orders.ts#client" },
          { phase: "Lost reply", title: "The work succeeded, but the reply was lost", body: "This is the case that catches people out. Inventory reserved the stock, but the response timed out. Orders cannot tell whether it worked.", hops: [["inv", "invdb", "reserve 1", "request"], ["inv", "orders", "reply lost", "error"]], set: { invdb: ["stock 9"] } },
          { phase: "Retry", title: "The idempotency key makes a retry safe", body: "Orders retries with the same key. Inventory sees it has already processed that key and returns the saved result, so stock is reduced once only.", hops: [["orders", "inv", "retry, key: 7a1f", "request"], ["inv", "orders", "reserved: true", "response"]], card: { at: "inv", title: "Inventory", tag: "idempotent", rows: ["key 7a1f seen before", "return the saved result", { t: "stock still 9", tone: "response" }] }, code: "microservices/inventory.ts#inventory" },
        ],
      },
      {
        id: "breaker",
        label: "Stopping a cascade",
        summary: "When a service is down, callers that keep waiting on it use up their own capacity. Soon they fail too. A circuit breaker stops that spreading.",
        steps: [
          { phase: "Failing", title: "Inventory starts failing", body: "Each call fails, and retries add more load to a service that is already struggling.", down: ["inv"], hops: [["orders", "inv", "reserve", "request"], ["inv", "orders", "503", "error"]], card: { at: "orders", title: "Circuit breaker", tag: "closed", tone: "error", rows: ["failure 1 of 3", "failure 2 of 3", "failure 3 of 3"] }, code: "microservices/resilience.ts#breaker" },
          { phase: "Open", title: "The breaker opens", body: "After 3 failures, calls fail instantly with no network request. Orders stays responsive, and Inventory gets room to recover.", hops: [["gw", "orders", "POST /orders", "request"], ["orders", "gw", "503 fast", "error"]], set: { orders: ["breaker OPEN"] } },
          { phase: "Half-open", title: "One trial call", body: "After the cool-down, one request is let through as a test.", up: ["inv"], hops: [["orders", "inv", "trial", "request"], ["inv", "orders", "200", "response"]], set: { orders: ["breaker half-open"] } },
          { phase: "Closed", title: "Traffic returns", body: "The trial worked, so the breaker closes. Had it failed, the breaker would have opened again for another cool-down.", set: { orders: ["breaker closed"] } },
        ],
      },
      {
        id: "outbox",
        label: "The outbox pattern",
        summary: "How to save data and publish an event with no risk of doing only one of them.",
        steps: [
          { phase: "Commit", title: "The order and event commit together", body: "Both inserts are in one transaction, in the same database. Either both exist afterwards, or neither does.", hops: [["orders", "ordersdb", "BEGIN…COMMIT", "request"]], set: { ordersdb: ["order 101", "outbox: unpublished"] }, code: "microservices/orders.ts#outbox" },
          { phase: "Relay", title: "A relay finds unpublished events", body: "`FOR UPDATE SKIP LOCKED` lets several relays run together without taking the same rows. The test runs three at once, and each event is published once.", hops: [["relay", "ordersdb", "SELECT … SKIP LOCKED", "request"], ["ordersdb", "relay", "1 event", "response"]] },
          { phase: "Publish", title: "The event reaches the queue", body: "The job id comes from the outbox row, so if the relay crashes and repeats itself, BullMQ ignores the duplicate. The row is then marked as published.", hops: [["relay", "queue", "order.created", "job"], ["relay", "ordersdb", "published_at = now()", "request"]], set: { ordersdb: ["order 101", "outbox: published"], queue: ["waiting: 1"] } },
        ],
      },
    ],
  },
  build: {
    intro: "You will build the essential reliability patterns: idempotent endpoints, timeouts, retries with jitter, a circuit breaker and the outbox. All are tested against real Postgres and Redis.",
    needs: ["Node.js 20 or newer", "Postgres and Redis"],
    install: "npm install fastify zod pg bullmq\nnpm install -D @types/pg",
    tree: "services/\n├─ inventory/      owns stock\n└─ orders/         owns orders\n   ├─ client.ts\n   ├─ resilience.ts\n   └─ outbox.ts",
    steps: [
      { title: "Make the service idempotent", explain: ["The caller sends an `Idempotency-Key`. The first time, the work runs and the result is saved. Any repeat returns the saved result.", "In production, store these keys in a database with an expiry, and in the same transaction as the work. A map is enough to show the idea."], code: "microservices/inventory.ts#inventory" },
      { title: "Add a circuit breaker", explain: ["It counts failures. After the threshold it opens, and calls fail at once without touching the network.", "The `half-open` state is the clever part: after a cool-down, a real request tests whether the service has recovered."], code: "microservices/resilience.ts#breaker" },
      { title: "Retry with backoff and jitter", explain: ["Exponential delays stop retries from adding to an overload. The random jitter stops every client retrying at the same instant.", "It does not retry when the circuit is open, since that would defeat the breaker."], code: "microservices/resilience.ts#retry" },
      { title: "Combine them in a client", explain: ["The order matters. The retry wraps the breaker, which wraps one timed call. The key is created outside the retry loop, so every attempt shares it. Create it inside, and each retry looks like a new request."], code: "microservices/orders.ts#client", where: "Wrap each downstream service in a small client like this, so route code never builds URLs by hand." },
      { title: "Publish events reliably", explain: ["`createOrder` writes the order and the event in one transaction.", "`relayOutbox` runs on a timer. `FOR UPDATE SKIP LOCKED` lets several copies run safely. The `jobId` makes a repeated publish harmless."], code: "microservices/orders.ts#outbox" },
    ],
    integrate: [
      "Before splitting anything, write down the problem you expect it to solve.",
      "Start from a modular monolith. Modules with clean boundaries are what you extract.",
      "Extract one module at a time, starting with the least entangled.",
      "Put timeouts, tracing and correlation ids in place before the first split.",
      "Give the new service its own database, and never let the old code query it directly.",
    ],
    mistakes: [
      { title: "A distributed monolith", text: "Services that must deploy together, or that share a database, give you all the costs and none of the benefits." },
      { title: "No timeouts", text: "One hung dependency uses up all your connections, and the failure spreads upstream." },
      { title: "Retrying non-idempotent calls", text: "A timeout does not mean the work failed. Retrying without a key can charge a customer twice." },
      { title: "Long synchronous chains", text: "If each service is 99.9% available, a chain of five is about 99.5%. Prefer events for anything that does not need an immediate answer." },
      { title: "Splitting too early", text: "Boundaries are hard to guess at the start. Moving a function between modules is easy. Moving it between services is a project." },
    ],
  },
  simulate: {
    intro: "An order needs Inventory and Payments before it can finish, so the chain is only as healthy as its weakest link.",
    preset: "microservices",
    tries: [
      "Take down Payments. Every order now fails, though Orders itself is healthy.",
      "Raise Payments CPU time. Slowness spreads backwards, because Orders holds a slot while it waits.",
      "Add a BullMQ and Worker, and connect Orders to the queue: that is how you remove a synchronous dependency.",
    ],
  },
};

export const saas: Topic = {
  slug: "saas",
  title: "SaaS Architecture",
  nav: "SaaS",
  group: "Architecture",
  lede: "One application serving many customers. The hardest requirement is that no tenant can ever see another's data, and that one noisy customer cannot hurt the rest.",
  learn: [
    {
      heading: "What it is",
      blocks: [
        { p: "Software as a Service runs one system for many customers, called tenants. A tenant is usually a company, with many users inside it. Sharing infrastructure is what makes SaaS economical, and it is also what creates its central risks." },
      ],
    },
    {
      heading: "Three ways to separate tenants",
      blocks: [
        {
          table: {
            head: ["Model", "Isolation", "Cost per tenant", "Good for"],
            rows: [
              ["Shared tables, with tenant_id", "Logical", "Lowest", "Most SaaS, with many small tenants"],
              ["One schema per tenant", "Stronger", "Medium", "Hundreds of tenants"],
              ["One database per tenant", "Strongest", "Highest", "Enterprise and regulated customers"],
            ],
          },
        },
        { p: "Many products start with shared tables, and offer a dedicated database to the largest customers. This guide uses shared tables, because that is where isolation is hardest." },
      ],
    },
    {
      heading: "Row level security: the safety net",
      blocks: [
        { p: "With shared tables, a single forgotten `WHERE tenant_id = ?` leaks one customer's data to another. Code review will not catch this every time. Postgres row level security moves the check into the database, so a query with no filter returns only that tenant's rows." },
        { callout: "Superusers and table owners skip row level security. If your application connects as the database owner, your policies may silently do nothing. This guide's tests confirm the app role is restricted.", title: "The trap" },
      ],
    },
    {
      heading: "Noisy neighbours",
      blocks: [
        { p: "All tenants share the same servers, so one customer's runaway script slows everyone down. Limits must be per tenant. A single global limit is not enough: the noisy tenant uses it all up, and everyone else gets rejected too." },
      ],
    },
    {
      heading: "Plans and limits",
      blocks: [
        { p: "Pricing is part of the architecture. Keep plan limits as data, so a new tier does not require code changes at every call site. Enforce them on the server, and do so under concurrency, or two simultaneous requests can both slip past the limit." },
      ],
    },
  ],
  flow: {
    nodes: [
      { id: "a", kind: "tenant", label: "Acme", sub: "tenant, free plan", x: 0, y: 0.05 },
      { id: "b", kind: "tenant", label: "Globex", sub: "tenant, pro plan", x: 0, y: 0.85 },
      { id: "api", kind: "api", label: "API", sub: "one codebase", x: 0.42, y: 0.45 },
      { id: "limit", kind: "limiter", label: "Plan limits", sub: "per tenant", x: 0.42, y: 1 },
      { id: "db", kind: "db", label: "Postgres", sub: "row level security", x: 0.92, y: 0.45 },
    ],
    scenarios: [
      {
        id: "isolation",
        label: "How a tenant is isolated",
        summary: "Follow one query. The application never writes a tenant filter, and the database still refuses to return anyone else's rows.",
        steps: [
          { phase: "Identity", title: "The tenant comes from the token", body: "The tenant id is inside the signed access token. It is never taken from the URL or the body, because the client controls those.", hops: [["a", "api", "GET /projects + JWT", "request"]], card: { at: "api", title: "Verified token", tag: "signed", rows: ["sub: user 1", "tenant: acme", "role: member"] }, code: "saas/tenancy.ts#api" },
          { phase: "Context", title: "The tenant is set for this transaction only", body: "`set_config(…, true)` scopes it to the transaction. A plain `SET` would stay on the pooled connection and leak into the next customer's request.", hops: [["api", "db", "set_config(acme)", "request"]], set: { db: ["app.tenant_id = acme"] }, code: "saas/tenancy.ts#context" },
          { phase: "Query", title: "A query with no WHERE clause", body: "The application runs `SELECT * FROM projects`. Postgres adds the policy's filter itself, so Globex's rows do not exist as far as this query can tell.", hops: [["api", "db", "SELECT * FROM projects", "request"], ["db", "api", "acme rows only", "response"]], card: { at: "db", title: "Row level security", tag: "enforced by the database", rows: [{ t: "acme-1", tone: "response" }, { t: "globex-1  hidden", tone: "muted" }] }, code: "saas/schema.sql#rls" },
          { phase: "Attack", title: "Cross-tenant writes are refused too", body: "`WITH CHECK` guards writes. An insert with another tenant's id fails, and an `UPDATE` or `DELETE` matches zero rows.", hops: [["api", "db", "INSERT tenant=globex", "request"], ["db", "api", "violates RLS policy", "error"]] },
          { phase: "Clean up", title: "The commit clears the context", body: "When the transaction ends, the setting disappears. The next request on this connection starts with no tenant, and sees no rows rather than all rows.", hops: [["api", "db", "COMMIT", "request"], ["api", "a", "200 + acme rows", "response"]], set: { db: ["app.tenant_id = (none)"] } },
        ],
      },
      {
        id: "quota",
        label: "Enforcing a plan limit",
        summary: "A free plan allows 3 projects. Without care, two simultaneous requests could both see 2 and both create a third.",
        steps: [
          { phase: "Lock", title: "One tenant's writes wait in line", body: "An advisory lock keyed by tenant makes the count and insert happen one at a time. Other tenants are unaffected.", hops: [["a", "api", "POST /projects", "request"], ["api", "db", "advisory lock", "request"]], code: "saas/tenancy.ts#plans" },
          { phase: "Check", title: "Count against the plan", body: "With the lock held, the count cannot change underneath us. The test fires 10 concurrent creates on a limit of 3, and exactly 3 succeed.", hops: [["api", "limit", "free: max 3", "request"], ["api", "db", "SELECT count(*)", "request"], ["db", "api", "3", "response"]] },
          { phase: "Refuse", title: "Over the limit: a clear next step", body: "The API returns `402` with a message that tells the customer to upgrade. A limit is a product moment, so make it helpful.", hops: [["api", "a", "402 upgrade to add more", "error"]] },
        ],
      },
    ],
  },
  build: {
    intro: "You will build tenant isolation with Postgres row level security, tenant context that cannot leak between requests, and plan limits that hold under concurrency.",
    needs: ["Node.js 20 or newer", "Postgres", "The Authentication guide, for tokens carrying a tenant"],
    install: "npm install fastify zod pg\nnpm install -D @types/pg",
    steps: [
      { title: "Design the tables", explain: ["Every tenant-owned table has a `tenant_id`, and it comes first in indexes, because nearly every query filters by it."], code: "saas/schema.sql#schema" },
      { title: "Turn on row level security", explain: ["`app_user` is deliberately weak: not a superuser, not an owner, and without `BYPASSRLS`. Your application connects with this role.", "`FORCE` applies the policy to the owner too. `USING` filters reads, and `WITH CHECK` guards writes.", "`NULLIF` handles a real trap. After a transaction ends, the setting reads as an empty string, and casting that to `uuid` throws an error. Without it, the next query on that pooled connection fails."], code: "saas/schema.sql#rls", where: "Put this in a migration, run by a privileged role, separate from the role your app uses." },
      { title: "Set the tenant safely", explain: ["Every query for a tenant goes through `withTenant`. The `true` in `set_config` scopes the value to the transaction.", "The test uses a pool of one connection, so a leaked setting would show up on the very next query."], code: "saas/tenancy.ts#context" },
      { title: "Enforce plan limits", explain: ["`PLANS` is data, so changing a tier is a one-line edit.", "`pg_advisory_xact_lock` queues one tenant's creates. Without it, concurrent requests all count the same number and all pass.", "It is released automatically when the transaction ends."], code: "saas/tenancy.ts#plans" },
      { title: "Expose the API", explain: ["`authenticate` runs for every route, and the tenant comes from the verified token.", "Notice the query has no `WHERE`. If it had been forgotten, nothing would leak."], code: "saas/tenancy.ts#api" },
    ],
    integrate: [
      "Add `tenant_id` to tenant-owned tables, and backfill it.",
      "Create a restricted role, and confirm with `SELECT rolsuper, rolbypassrls FROM pg_roles`.",
      "Route all queries through `withTenant`. Do this before enabling policies, so nothing breaks.",
      "Enable RLS one table at a time, and test by trying to read across tenants.",
      "Add per-tenant rate limits, keyed by tenant id rather than by IP. See Rate Limiting.",
      "Cache keys, file paths and job data need the tenant in them too. Row level security only covers Postgres.",
    ],
    mistakes: [
      { title: "Connecting as a superuser or owner", text: "Row level security is skipped without any error, and everything appears to work. Check the role's flags in a test." },
      { title: "Using SET instead of SET LOCAL", text: "With a connection pool, the tenant stays on the connection and the next request inherits it. That is a cross-tenant leak." },
      { title: "Trusting a tenant id from the client", text: "Any value in a URL, a header or a body can be changed by the user. Take it from a verified token." },
      { title: "One global rate limit", text: "A noisy tenant uses up the limit and locks out everyone else. Scope limits per tenant." },
      { title: "Forgetting caches and files", text: "A Redis key of `project:42` has no tenant in it. Isolation must cover every data store." },
    ],
  },
  simulate: {
    intro: "Two tenants share one API and database. Tenant B sends over 20 times more traffic. Compare what happens to Tenant A with each limiter setting.",
    preset: "saas",
    tries: [
      "Press Run and read the per-tenant numbers. With one shared limit, Tenant B uses it up and Tenant A is mostly rejected.",
      "Click Per-tenant limit and tick Separate limit per client. Tenant A recovers, and only the noisy tenant is limited.",
      "Remove the limit and connect both tenants directly to the API, to see the database overwhelmed.",
    ],
  },
  sources: [{ label: "PostgreSQL: row security policies", url: "https://www.postgresql.org/docs/current/ddl-rowsecurity.html" }],
};
