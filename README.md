# XChange Backend

A **microservice-based cryptocurrency exchange backend** built with TypeScript. The system consists of three independent services — **API**, **Engine**, and **WebSocket** — that communicate via Redis pub/sub and queue messaging.

---

## Architecture

```
┌─────────────┐    Redis lPush     ┌──────────────┐    Redis publish    ┌──────────────┐
│   API       │ ─────────────────► │   ENGINE     │ ──────────────────► │   WebSocket  │
│  (Express)  │  "messages" queue  │  (Matching)  │   (channels)        │   (ws lib)   │
│  HTTP REST  │ ◄───────────────── │   In-Memory  │                     │   Port 3003  │
└─────────────┘  Redis subscribe   └──────────────┘                     └──────────────┘
       ▲                                  │
       │                                  ▼
   Client HTTP                     snapshot.json
    Requests                     (periodic state dump)
```

### Data Flow

1. **Client** sends HTTP request (create order, cancel order, get depth, etc.) to the **API** service.
2. **API** generates a unique `clientId`, pushes the message onto the Redis `"messages"` list, and subscribes to the `clientId` channel to await a response.
3. **Engine** continuously polls the Redis list with `rPop`, processes each message through the matching engine, and publishes the result back on the `clientId` channel.
4. **API** receives the response via its Redis subscription, resolves the pending HTTP request, and returns data to the client.
5. **WebSocket** server (port 3003) is scaffolded for real-time streaming to clients.

---

## Tech Stack

| Technology  | Purpose                                    |
|-------------|--------------------------------------------|
| **TypeScript** | Primary language across all services     |
| **Express.js** | HTTP REST API framework (API service)    |
| **Redis**      | Inter-service messaging (pub/sub + list queue) |
| **ws**         | WebSocket server library (WS service)    |
| **Node.js**    | Runtime environment                      |
| **CORS**       | Cross-origin request handling            |

---

## Project Structure

```
xchange-backend/
├── package.json              # Root shared dependencies (@types/node, dotenv)
│
├── api/                      # HTTP REST API service
│   ├── package.json          # express, cors, redis
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts          # Express app setup, routes
│       ├── redisManager.ts   # Redis singleton (publish + subscribe)
│       ├── routes/
│       │   ├── depth.ts      # GET /api/v1/depth
│       │   └── order.ts      # POST/DELETE/GET /api/v1/order
│       └── types/
│           ├── index.ts      # Response message types
│           └── to.ts         # Request message types
│
├── engine/                   # Matching engine service
│   ├── package.json          # redis
│   ├── tsconfig.json
│   ├── snapshot.json         # Periodic state snapshot (auto-generated)
│   └── src/
│       ├── index.ts          # Entry point — Redis polling loop
│       ├── redisManager.ts   # Redis singleton (publish to API)
│       ├── trade/
│       │   ├── engine.ts     # Core Engine class — order processing, balances
│       │   └── orderbook.ts  # Orderbook class — matching, depth, orders
│       └── types/
│           ├── engine.ts     # Engine message types, UserBalance
│           └── orderbook.ts  # Order, Fill, Depth interfaces
│
└── ws/                       # WebSocket service (scaffolded)
    ├── package.json          # ws
    ├── tsconfig.json
    └── src/
        ├── index.ts          # WebSocket server on port 3003
        ├── user.ts           # User class (id + ws connection)
        └── userManagers.ts   # UserManager singleton
```

---

## Services

### 1. API Service

REST API gateway built with **Express.js**. Accepts client requests and relays them to the Engine via Redis.

#### Endpoints

| Method   | Endpoint                          | Description                     | Body / Query                                      |
|----------|-----------------------------------|---------------------------------|---------------------------------------------------|
| `GET`    | `/api/v1/depth?symbol=SOL_USDC`  | Get order book depth            | `symbol` (query)                                  |
| `POST`   | `/api/v1/order`                  | Place a new order               | `{ market, price, quantity, side, userId }`       |
| `DELETE`  | `/api/v1/order`                 | Cancel an existing order        | `{ orderId, market }`                             |
| `GET`    | `/api/v1/order/open?market=...&userId=...` | Get user's open orders | `market`, `userId` (query)                       |

#### Redis Manager (Singleton)

- Maintains two Redis client connections: one for publishing, one for subscribing.
- `sendAndAwait(message)` — pushes a message to the engine queue and returns a Promise that resolves when the engine publishes a response on the unique client channel.

---

### 2. Engine Service

The **core matching engine**. Processes orders in-memory with a continuous Redis polling loop.

#### Features

- **Order Matching** — Price-time priority matching for buy and sell orders.
- **Multiple Markets** — Supports `SOL_USDC`, `BTC_USDC`, `ETH_USDC`, `SHIB_USDC`, `HNT_USDC` orderbooks.
- **Balance Management** — Tracks user balances with `available` and `locked` funds per asset.
- **Fund Locking** — Validates and locks funds before order placement; releases on cancel.
- **Trade Settlement** — Transfers funds between maker and taker on fills.
- **State Snapshots** — Saves full engine state (orderbooks + balances) to `snapshot.json` every 3 seconds.
- **Snapshot Recovery** — Restores from `snapshot.json` on startup when `WITH_SNAPSHOT` env var is set.
- **Depth Queries** — Returns aggregated bid/ask depth for any market.
- **Open Orders** — Returns all open orders for a given user on a market.
- **On-Ramp** — Adds USDC to user balances (simulating fiat deposit).

#### Message Types Handled

| Type              | Action                                        |
|-------------------|-----------------------------------------------|
| `CREATE_ORDER`    | Validate funds, lock balance, match & place   |
| `CANCEL_ORDER`    | Remove order, unlock funds                    |
| `ON_RAMP`         | Add USDC to user balance                      |
| `GET_DEPTH`       | Return current orderbook depth                |
| `GET_OPEN_ORDERS` | Return user's open orders for a market        |

#### Orderbook

- Maintains sorted `bids[]` and `asks[]` arrays.
- `matchBid()` — Matches incoming buy orders against asks (ascending price).
- `matchAsk()` — Matches incoming sell orders against bids (descending price).
- Tracks cumulative `depth` (price-level aggregation) for real-time depth display.
- Generates `Fill` objects with `tradeId`, quantities, and counterparty info.

---

### 3. WebSocket Service

Scaffolded WebSocket server on **port 3003** using the `ws` library. Currently includes:

- `WebSocketServer` initialization and connection handler.
- `User` class — wraps a WebSocket connection with a unique ID.
- `UserManager` singleton — manages connected users.

> **Status:** Skeleton only. No message routing, Redis subscription for trade/depth updates, or client broadcasting is implemented yet.

---

## Getting Started

### Prerequisites

- **Node.js** >= 18
- **Redis** server running locally (default `localhost:6379`)
- **TypeScript** (`npm install -g typescript`)

### Installation

```bash
# Clone the repository
cd xchange-backend

# Install root dependencies
npm install

# Install service dependencies
cd api && npm install && cd ..
cd engine && npm install && cd ..
cd ws && npm install && cd ..
```

### Build

```bash
# Build each service
cd api && npx tsc && cd ..
cd engine && npx tsc && cd ..
cd ws && npx tsc && cd ..
```

### Run

Start Redis first, then each service in separate terminals:

```bash
# Terminal 1 — Start Redis
redis-server

# Terminal 2 — Start the Engine
cd engine && node dist/index.js

# Terminal 3 — Start the API
cd api && node dist/index.js

# Terminal 4 — Start the WebSocket server
cd ws && node dist/index.js
```

### Environment Variables

| Variable         | Description                              | Default |
|------------------|------------------------------------------|---------|
| `WITH_SNAPSHOT`  | Set to load engine state from `snapshot.json` on startup | unset |

---

## Default Test Data

On fresh startup (without snapshot), the engine initializes:

- **5 Orderbooks:** SOL_USDC, BTC_USDC, ETH_USDC, SHIB_USDC, HNT_USDC
- **5 Test Users** (IDs `"1"` through `"5"`), each with **10,000 USDC** available balance

---

## Key Design Decisions

- **In-Memory Engine** — All orderbooks and balances live in memory for maximum throughput. Periodic JSON snapshots provide crash recovery.
- **Redis as Message Bus** — Decouples API from Engine. The API is stateless; the Engine is the single source of truth.
- **Singleton Patterns** — Both `RedisManager` classes use the singleton pattern to ensure a single Redis connection pool per service.
- **No Database** — State is purely in-memory with optional file-based snapshots. No SQL/NoSQL database is used.

---

## License

This project is for educational purposes.
