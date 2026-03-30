# 🦁 Zookeeper + Kafka — The Ultimate HLD Guide

> **Last Updated:** March 2026
> **Author:** System Design Study Notes (Scaler Academy — HLD Module)
> **Topics:** Zookeeper, Master Election, Ephemeral Nodes, Two-Phase Commit, CAP Theorem, Kafka, Topics, Partitions, Consumer Groups, Persistent Queues, Pub-Sub, Fault Tolerance

---

![Zookeeper Master Election Animation](./images/zk_master_election.gif)

---

## 📋 Table of Contents

### Part 1: The Problem — Maintaining State Consistently
1. [Master-Slave Architecture Recap](#-master-slave-architecture-recap)
2. [Why Master Tracking is Hard](#-why-master-tracking-is-hard)
3. [Naive Approach — Dedicated Tracker Machine](#-naive-approach--dedicated-tracker-machine)
4. [Problems with the Naive Approach](#-problems-with-the-naive-approach)
5. [Multi-Tracker Cluster — Same Problem, Smaller Scale](#-multi-tracker-cluster--same-problem-smaller-scale)

### Part 2: Zookeeper — Architecture & Data Model
6. [What is Zookeeper?](#-what-is-zookeeper)
7. [Zookeeper's File System Model](#-zookeepers-file-system-model)
8. [Types of ZK Nodes — Persistent vs Ephemeral](#-types-of-zk-nodes--persistent-vs-ephemeral)
9. [Ephemeral Nodes — Deep Dive](#-ephemeral-nodes--deep-dive)
10. [Heartbeat Mechanism](#-heartbeat-mechanism)

### Part 3: Master Election with Zookeeper
11. [Cold Start — Initial Master Assignment](#-cold-start--initial-master-assignment)
12. [Master Election Flow — Step by Step](#-master-election-flow--step-by-step)
13. [Solving the Extra Hop — Watch / Subscribe Mechanism](#-solving-the-extra-hop--watch--subscribe-mechanism)
14. [The Two-Way Connection — Why It's Critical](#-the-two-way-connection--why-its-critical)
15. [What Happens During Master Transition](#-what-happens-during-master-transition)
16. [Network Partition Scenarios — All Cases](#-network-partition-scenarios--all-cases)

### Part 4: Zookeeper Internal Architecture
17. [Zookeeper as a Distributed System — Not a Single Machine](#-zookeeper-as-a-distributed-system--not-a-single-machine)
18. [Leader-Follower Architecture Inside Zookeeper](#-leader-follower-architecture-inside-zookeeper)
19. [Strong Consistency — How Writes Work](#-strong-consistency--how-writes-work)
20. [Two-Phase Commit in Zookeeper](#-two-phase-commit-in-zookeeper)
21. [Odd Number of Machines & Quorum — Why 2n+1](#-odd-number-of-machines--quorum--why-2n1)
22. [Split-Brain Problem](#-split-brain-problem)
23. [CAP Theorem — Zookeeper is CP](#-cap-theorem--zookeeper-is-cp)
24. [Zookeeper Leader Failure — What Really Happens](#-zookeeper-leader-failure--what-really-happens)
25. [Concurrent Failure — ZK Leader + DB Master Both Down](#-concurrent-failure--zk-leader--db-master-both-down)

### Part 5: Zookeeper Use Cases & Comparisons
26. [Why Not Build an Internal Solution?](#-why-not-build-an-internal-solution)
27. [Zookeeper vs Multi-Master with Consistent Hashing](#-zookeeper-vs-multi-master-with-consistent-hashing)
28. [Persistent vs Ephemeral Node Use Cases](#-persistent-vs-ephemeral-node-use-cases)

### Part 6: The Problem — Async Tasks & Latency
29. [Synchronous vs Asynchronous Tasks](#-synchronous-vs-asynchronous-tasks)
30. [The Failure Scenario — Why Async Tasks Can Be Lost](#-the-failure-scenario--why-async-tasks-can-be-lost)
31. [Persistent Queues — The Solution](#-persistent-queues--the-solution)
32. [Persistent Queues as Shock Absorbers](#-persistent-queues-as-shock-absorbers)

### Part 7: Kafka — Architecture & Core Concepts
33. [What is Kafka?](#-what-is-kafka)
34. [Pub-Sub Model — Publishers & Subscribers](#-pub-sub-model--publishers--subscribers)
35. [Topics — Categorizing Events](#-topics--categorizing-events)
36. [Partitions — Scaling Within a Topic](#-partitions--scaling-within-a-topic)
37. [Message Structure in Kafka](#-message-structure-in-kafka)
38. [Event Retention Period](#-event-retention-period)
39. [Partition Assignment — Round-Robin vs Key-Based](#-partition-assignment--round-robin-vs-key-based)
40. [Ordered Processing — The Uber Driver Example](#-ordered-processing--the-uber-driver-example)

### Part 8: Kafka — Consumer Groups & Fault Tolerance
41. [Consumer Groups — Parallel Processing](#-consumer-groups--parallel-processing)
42. [How Consumer Groups Prevent Duplicate Consumption](#-how-consumer-groups-prevent-duplicate-consumption)
43. [Consumer Offset — FIFO Guarantee](#-consumer-offset--fifo-guarantee)
44. [Sizing Partitions & Consumers](#-sizing-partitions--consumers)
45. [Kafka Brokers & Replication](#-kafka-brokers--replication)
46. [Talking to Any Kafka Broker — Smart Routing](#-talking-to-any-kafka-broker--smart-routing)
47. [Kafka + Zookeeper — Internal Relationship](#-kafka--zookeeper--internal-relationship)

### Part 9: Summary & Interview Prep
48. [Zookeeper vs Kafka — When to Use What](#-zookeeper-vs-kafka--when-to-use-what)
49. [Complete Architecture Diagram](#-complete-architecture-diagram)
50. [Quick Reference Cheatsheet](#-quick-reference-cheatsheet)
51. [Practice Questions](#-practice-questions)
52. [References & Resources](#-references--resources)

---

# PART 1: THE PROBLEM — MAINTAINING STATE CONSISTENTLY

---

## 🏗️ Master-Slave Architecture Recap

Before Zookeeper makes sense, you need to understand *why* we use master-slave architecture.

```
MASTER-SLAVE DATABASE SETUP:
─────────────────────────────────────────────────────────────
  WHY WE USE IT:
  → Data SURVIVAL: If the master dies, slaves hold the data
  → Read SPEED: Read requests go to slaves (scale horizontally)
  → Single TRUTH: Only master accepts writes → no conflicts

  STRUCTURE:
  ┌─────────────┐     replication     ┌─────────────┐
  │  MASTER DB  │ ──────────────────► │   SLAVE 1   │
  │  (writes ✅)│                     │  (reads ✅) │
  └─────────────┘                     └─────────────┘
         │           replication      ┌─────────────┐
         └──────────────────────────► │   SLAVE 2   │
                                      │  (reads ✅) │
                                      └─────────────┘

  RULE: ALL writes → MASTER only. Never to a slave.
─────────────────────────────────────────────────────────────
```

> ⚠️ **Note:** Master-slave only makes sense for stateful systems (databases). App servers are stateless — so there is NO master-slave for app servers. Replication only matters when data (state) exists.

---

## 🤔 Why Master Tracking is Hard

Since all writes go to the master, **every app server must always know who the current master is**.

```
THE WRITE FLOW:
─────────────────────────────────────────────────────────────
  App Server receives a WRITE request from user
        │
        ▼
  App Server must talk to MASTER DB ← must know who this is!
        │
        ▼
  Write succeeds → returns success to user ✅

  ❌ If App Server writes to SLAVE by mistake:
     → Write is rejected OR silently accepted but data lost
     → CHAOS

  ❌ If two App Servers disagree on who master is:
     → App Server A writes to DB1 (thinks it's master)
     → App Server B writes to DB2 (thinks IT is master)
     → DATA CORRUPTION — two sources of truth
─────────────────────────────────────────────────────────────
```

The tricky part: **the master is not static forever**. The master can die. When it dies, one of the slaves must be elected as the new master. And from that moment forward, every app server must agree: **"the new master is this slave."**

---

## 🏗️ Naive Approach — Dedicated Tracker Machine

The simplest idea: a **dedicated single machine** whose only job is to track who the current master is.

```
NAIVE SOLUTION — SINGLE DEDICATED TRACKER:
─────────────────────────────────────────────────────────────

  App Server A ──┐
  App Server B ──┤──► DEDICATED        ──► MASTER DB (writes)
  App Server C ──┘    TRACKER MACHINE
                       │
                       └── stores: "current master IP = X.X.X.X"

  Flow per write request:
    1. App Server asks Tracker → "Who is the master?"
    2. Tracker replies → "Master is IP = 10.0.0.5"
    3. App Server writes directly to 10.0.0.5 (master)
─────────────────────────────────────────────────────────────
```

Simple in concept. But it has two major problems.

---

## ❌ Problems with the Naive Approach

| Problem | Description | Impact |
|---------|-------------|--------|
| **Extra Hop** | Every write needs an extra round-trip to the tracker before it can reach the master | Doubles latency for every write |
| **Single Point of Failure (SPOF)** | If the tracker machine dies, no app server can find the master | Entire system's write capability is down |

---

## 🔄 Multi-Tracker Cluster — Same Problem, Smaller Scale

The obvious fix for SPOF: **use a cluster of tracker machines** instead of one.

```
MULTI-TRACKER ATTEMPT:
─────────────────────────────────────────────────────────────

  App Server ──► TRACKER CLUSTER ──► MASTER DB
                  [T1] [T2] [T3]
                    ↑
                    └── NEW PROBLEM: How do T1, T2, T3 agree
                        on who the master is?

  Scenario: Master dies. New master elected.
    T1 updates: "new master = slave2"
    T2 updates: "new master = slave2"
    T3 (partitioned): still thinks "master = slave1" ❌

  → We've recreated the SAME problem at a smaller scale!
─────────────────────────────────────────────────────────────
```

> 💡 **Key Insight from Lecture:** This smaller-scale version of the problem is *easier* to solve than the original because:
> - Master changes happen **very rarely** (maybe once a month)
> - The cluster has **far fewer machines** than the app server fleet
> - This is exactly the problem **Zookeeper was designed to solve**

---

# PART 2: ZOOKEEPER — ARCHITECTURE & DATA MODEL

---

## 🦁 What is Zookeeper?

Apache Zookeeper (from its own website):

> *"Zookeeper is a centralized service for maintaining configuration information, naming, providing distributed synchronization, and providing group services."*

In plain English: **Zookeeper tracks configuration data in a strongly consistent manner, ensuring all machines in a distributed system agree on that configuration.**

```
ZOOKEEPER USE CASES:
─────────────────────────────────────────────────────────────
  ✅ Who is the master database node right now?
  ✅ Which services/machines are currently online?
  ✅ Environment variables shared across machines
  ✅ DB connection pool sizes (global config)
  ✅ Distributed locks (only one machine runs a task at a time)
  ✅ Leader election in any distributed system
  ✅ Service discovery (which payment/auth servers are live?)
─────────────────────────────────────────────────────────────
```

---

## 🌳 Zookeeper's File System Model

Zookeeper stores data **exactly like a file system** — with directories (folders) and files.

```
ZOOKEEPER FILE SYSTEM:

  /  (root)
  ├── /master                         ← EPHEMERAL: current master IP
  ├── /config/
  │   ├── /config/aws-key             ← PERSISTENT: AWS credentials
  │   ├── /config/db-ip               ← PERSISTENT: DB connection string
  │   ├── /config/pool-size           ← PERSISTENT: connection pool count
  │   └── /config/env                 ← PERSISTENT: production/staging flag
  └── /services/
      ├── /services/payment-svc       ← EPHEMERAL: which payment servers live
      └── /services/auth-svc          ← EPHEMERAL: which auth servers live
```

> ⚠️ **Terminology Alert:** In Zookeeper, files are called **nodes** or **ZNodes** (Zookeeper Nodes).
> Do NOT confuse with "server nodes" — here a **ZNode = a file** in Zookeeper's filesystem.
> This is purely a naming convention difference.

---

## 📁 Types of ZK Nodes — Persistent vs Ephemeral

Zookeeper has two fundamental types of nodes:

```
┌──────────────────────────────────────────────────────────────────┐
│                    ZOOKEEPER NODE TYPES                           │
├───────────────────────────┬──────────────────────────────────────┤
│      PERSISTENT NODES     │         EPHEMERAL NODES              │
├───────────────────────────┼──────────────────────────────────────┤
│ Data stays until          │ Data exists ONLY while the OWNER     │
│ explicitly deleted        │ machine is alive                     │
│                           │                                      │
│ Like a normal file on     │ Owner = the machine that wrote it    │
│ your disk                 │                                      │
│                           │ Automatically deleted when           │
│ USE CASES:                │ heartbeat from owner stops           │
│ • AWS access keys         │                                      │
│ • DB connection strings   │ USE CASES:                           │
│ • Environment variables   │ • /master  (who is current master?)  │
│ • Feature flags           │ • Service health / liveness check    │
│ • Pool sizes              │ • Distributed lock ownership         │
│ • Any stable config       │ • Any volatile, machine-tied data    │
└───────────────────────────┴──────────────────────────────────────┘
```

> 💡 **Rule of thumb:** If the data should disappear when a machine dies → use **ephemeral**. If it should survive machine restarts → use **persistent**.

---

## ⚡ Ephemeral Nodes — Deep Dive

The ephemeral node concept is the foundation of everything Zookeeper does for master election.

```
EPHEMERAL NODE LIFECYCLE:
─────────────────────────────────────────────────────────────

  Step 1: Machine M writes its IP to /master (ephemeral node)
          /master = "10.0.0.5"

  Step 2: Machine M OWNS this data now
          Machine M sends heartbeat every 5 seconds → Zookeeper
          Zookeeper sees heartbeat → data stays alive

  Step 3: Machine M goes down (crash, network failure, etc.)
          Heartbeats stop arriving at Zookeeper

  Step 4: Zookeeper waits for configured timeout (e.g., 5 seconds)
          No heartbeat received → timeout exceeded

  Step 5: Zookeeper DELETES /master node → sets value to null
          Zookeeper NOTIFIES all subscribers instantly:
          "Master is now null"

─────────────────────────────────────────────────────────────
```

> ⚠️ **Critical distinction — Heartbeat ≠ Data rewrite:**
> - The machine writes data to the ZNode **ONCE**
> - Then it sends **heartbeats** (small lightweight pings) every N seconds
> - Heartbeats say: "I'm still alive, please keep my data"
> - Heartbeats do **NOT** rewrite the data in the ZNode

---

## 💓 Heartbeat Mechanism

```
HEARTBEAT DETAILS:
─────────────────────────────────────────────────────────────
  • Heartbeat interval: configurable (e.g., every 5 seconds)
  • Data in /master: written once, kept as long as heartbeats arrive
  • If no heartbeat within timeout window → data deleted

  Machine M alive:
    t=0s  : [HEARTBEAT] ─────────────────► Zookeeper ✅
    t=5s  : [HEARTBEAT] ─────────────────► Zookeeper ✅
    t=10s : [HEARTBEAT] ─────────────────► Zookeeper ✅
    /master = "10.0.0.5" (stays intact)

  Machine M crashes at t=12s:
    t=15s : ... silence ... ─────────────► Zookeeper ⏳
    t=17s : TIMEOUT EXCEEDED
    Zookeeper: /master = null → notify all subscribers
─────────────────────────────────────────────────────────────
```

---

# PART 3: MASTER ELECTION WITH ZOOKEEPER

---

## 🥶 Cold Start — Initial Master Assignment

When the system boots for the very first time:

```
COLD START FLOW:
─────────────────────────────────────────────────────────────
  1. All DB machines come up (no master yet)
  2. One machine is designated master by any election algorithm
  3. That machine writes its IP to /master (ephemeral node)
     /master = "10.0.0.1"
  4. That machine starts sending heartbeats to Zookeeper
  5. App servers and slave DBs read /master → get "10.0.0.1"
  6. App servers and slaves SUBSCRIBE to /master for future changes
  7. System is now operational ✅
─────────────────────────────────────────────────────────────
```

---

## 🗳️ Master Election Flow — Step by Step

![Zookeeper Master Election Animation](./images/zk_master_election.gif)

```
SCENARIO: Current master (M1) dies

STEP 1: M1 crashes
───────────────────
  M1's heartbeats stop arriving at Zookeeper
  Zookeeper waits for timeout (e.g., 5 seconds)
  Timeout exceeded → Zookeeper sets /master = null

STEP 2: Zookeeper notifies all subscribers
────────────────────────────────────────────
  /master changed to null
  Notification pushed to ALL subscribers IMMEDIATELY:
    → App Server receives: "Master is null"
    → Slave M2 receives:   "Master is null"
    → Slave M3 receives:   "Master is null"
    → Slave M4 receives:   "Master is null"

STEP 3: App servers stop all write requests
─────────────────────────────────────────────
  App Server logic: "Master = null → deny all writes"
  Users get: "Service temporarily unavailable, please retry"

STEP 4: Slaves race to become master (Fastest Finger First)
────────────────────────────────────────────────────────────
  All slaves try to write their IP to /master simultaneously:
    M2 tries to write "10.0.0.2" ──┐
    M3 tries to write "10.0.0.3" ──┤── Zookeeper acquires LOCK
    M4 tries to write "10.0.0.4" ──┘   Only ONE write succeeds
  Winner: M4 → /master = "10.0.0.4"
  M2 and M3 write attempts FAIL

STEP 5: Zookeeper notifies all subscribers of new master
─────────────────────────────────────────────────────────
  /master changed to "10.0.0.4"
  Notification pushed to ALL subscribers:
    → App Server: "Master is now 10.0.0.4" → resumes writes ✅
    → Slave M2:   "Master is now 10.0.0.4" → starts replicating from M4
    → Slave M3:   "Master is now 10.0.0.4" → starts replicating from M4

STEP 6: M4 starts sending heartbeats
──────────────────────────────────────
  M4 is now master, starts heartbeating Zookeeper
  /master data persists as long as M4 sends heartbeats ✅
```

> 💡 **Selection is first-come-first-served** — not based on which slave has the most up-to-date data. The lock inside Zookeeper ensures exactly one slave wins.

> ⏱️ **Total re-election time:** Less than 1 second in practice (not 5 seconds — the 5s timeout only applies to detecting the failure, the election itself is near-instant).

---

## 👁️ Solving the Extra Hop — Watch / Subscribe Mechanism

The naive approach had an extra hop: every write request needed to ask the tracker "who is master?" Zookeeper solves this with **subscriptions (watches)**.

```
SUBSCRIPTION / WATCH MECHANISM — OBSERVER PATTERN:
─────────────────────────────────────────────────────────────

  ON STARTUP (one-time only):
  ───────────────────────────
  App Server reads /master → gets "10.0.0.1"
  App Server stores "10.0.0.1" in local memory
  App Server SUBSCRIBES to /master node

  Slave DBs also read /master → get "10.0.0.1"
  Slave DBs SUBSCRIBE to /master node

  NORMAL OPERATION (no extra hop!):
  ───────────────────────────────────
  User write request arrives at App Server
  App Server checks LOCAL MEMORY → "master = 10.0.0.1"
  App Server writes DIRECTLY to 10.0.0.1
  NO trip to Zookeeper needed ✅

  ON MASTER CHANGE (push-based, event-driven):
  ──────────────────────────────────────────────
  Zookeeper detects master change → /master = null
  Zookeeper PUSHES notification to all watchers IMMEDIATELY
  No polling. No delay. Instant push. ✅

  App Server receives push → updates local memory → stops writes
  After new master elected → receives push → resumes writes
─────────────────────────────────────────────────────────────
```

> 💡 **This IS the Observer Pattern.** Zookeeper = Observable. App servers + Slaves = Observers.

> ⏱️ **Load concern:** How frequently does master election happen? Maybe once a month! So these subscriptions generate essentially **zero load**. They are notifications about rare events, not continuous polling.

---

## 🔌 The Two-Way Connection — Why It's Critical

Zookeeper maintains a **persistent, bidirectional (two-way) connection** with every registered server.

```
TWO-WAY CONNECTION:
─────────────────────────────────────────────────────────────

  App Server ◄──────────────────────────────► Zookeeper
              ←── Zookeeper pushes notifications
              ──► App Server sends heartbeats

  If App Server → Zookeeper direction breaks:
    Zookeeper detects lost connection
    Zookeeper knows this server is unreachable

  If Zookeeper → App Server direction breaks:
    App Server detects lost connection (OS-level event)
    App Server IMMEDIATELY stops all write requests
    Reason: "I cannot verify who the master is right now"
─────────────────────────────────────────────────────────────
```

**WHY the two-way connection prevents catastrophe:**

```
WITHOUT TWO-WAY CONNECTION (hypothetical — dangerous!):
─────────────────────────────────────────────────────────────
  1. Old Master M1 dies
  2. Zookeeper tries to send "master = null" to App Server
  3. Network partition between App Server ↔ Zookeeper
     → Notification NEVER reaches App Server
  4. App Server still thinks M1 is master
  5. A new master M4 gets elected
  6. App Server KEEPS WRITING TO M1 (dead machine) ❌
  → Or worse: M1 comes back but is a slave now
  → App Server writes to M1 (now slave) → DATA SPLIT & CORRUPTION

WITH TWO-WAY CONNECTION (actual Zookeeper behavior):
─────────────────────────────────────────────────────────────
  1. Network partition between App Server ↔ Zookeeper
  2. App Server DETECTS the connection is broken
  3. App Server IMMEDIATELY stops all write requests ✅
  4. No writes happen until Zookeeper connection is restored
  5. Once restored, App Server reads current master from /master
  6. Resumes writes to the correct, current master ✅
─────────────────────────────────────────────────────────────
```

> ⚠️ **The rule:** The moment an app server either:
> (a) Loses its Zookeeper connection, OR
> (b) Receives "master = null" notification
> → It MUST immediately stop serving all write requests.
> Brief downtime (1-5 seconds) is acceptable. Writing to the wrong master is catastrophic.

---

## ⏱️ What Happens During Master Transition

```
MASTER TRANSITION TIMELINE:
─────────────────────────────────────────────────────────────
  t=0s    : Master M1 crashes
  t=0-5s  : Zookeeper waiting for heartbeat timeout
  t=5s    : Zookeeper declares /master = null
  t=5s    : All subscribers notified → App servers stop writes
  t=5-6s  : Slaves race to write their IP to /master
  t=6s    : One slave wins [election complete]
  t=6s    : Zookeeper notifies all → new master known
  t=6s    : App servers resume writes to new master ✅

  TOTAL DOWNTIME FOR WRITES: ~1-6 seconds
  READ OPERATIONS: unaffected throughout (go to slaves)
─────────────────────────────────────────────────────────────
```

> 💡 The re-election itself (slaves racing to write) happens in under 1 second. Most of the downtime is the heartbeat timeout period.

---

## 🌐 Network Partition Scenarios — All Cases

The lecture covers many network partition scenarios. Let's walk through all of them.

**Scenario A: Master dies, partition affects some slaves**

```
SCENARIO A:
─────────────────────────────────────────────────────────────
  Zookeeper sends "master = null" notification to all slaves:

    Slave M2 ──────── RECEIVES ✅ → participates in election
    Slave M3 ──────── RECEIVES ✅ → participates in election
    Slave M5 ──[PARTITION]── LOST ❌ → does NOT participate
    Slave M6 ──[PARTITION]── LOST ❌ → does NOT participate

  Election happens among M2, M3. Say M3 wins.
  /master = M3

  Zookeeper sends "master = M3" to all:
    M2 ──── RECEIVES ✅ → starts replicating from M3
    M5 ──[PARTITION]── LOST ❌ → still thinks M1 is master
    M6 ──[PARTITION]── LOST ❌ → still thinks M1 is master

  RESULT: M5 and M6 are temporarily isolated.
  Is this a problem? NOT CRITICAL.
  When M5/M6 reconnect to Zookeeper:
    → Read /master = M3
    → Start replicating from M3
    → Their stale data is not "wrong", just outdated
─────────────────────────────────────────────────────────────
```

**Scenario B: The App Server gets partitioned from Zookeeper**

```
SCENARIO B:
─────────────────────────────────────────────────────────────
  Network partition between App Server and Zookeeper

  App Server ──[PARTITION]──► Zookeeper

  1. Zookeeper delivers "master = null" to most subscribers
  2. BUT notification to THIS App Server is lost
  3. App Server still thinks M1 is master

  HOWEVER: The two-way connection detects this!
  App Server detects: "My connection to Zookeeper is broken"
  App Server rule: "If I can't reach Zookeeper → stop all writes"
  App Server STOPS all write requests immediately ✅

  Once partition heals:
  App Server reconnects to Zookeeper
  Reads /master → gets current master
  Resumes writes ✅
─────────────────────────────────────────────────────────────
```

**Scenario C: Master gets partitioned (thinks it's still master)**

```
SCENARIO C — THE "GHOST MASTER" SCENARIO:
─────────────────────────────────────────────────────────────
  The old master M1 is NOT crashed — it's just partitioned.
  M1 ──[PARTITION]──► Zookeeper

  From Zookeeper's view: "M1 heartbeats stopped → M1 is dead"
  Zookeeper elects M4 as new master.

  From M1's view: "I'm still the master! Nothing wrong with me."
  M1 is alive and might accept write requests.

  WHO IS ACTUALLY MASTER? The system's agreed answer: M4.

  What happens when M1 gets write requests?
  → If M1 knows it's no longer registered master, it rejects them
  → Once M1 reconnects to Zookeeper, it learns M4 is master
  → M1 accepts its role as slave and starts replicating from M4
  → Any data M1 wrote during partition is stale/rolled back

  KEY POINT: The two-way connection prevents the WORST case.
  The moment M1-Zookeeper partition heals:
  M1 gets the update → stops accepting writes → syncs from M4 ✅
─────────────────────────────────────────────────────────────
```

---

# PART 4: ZOOKEEPER INTERNAL ARCHITECTURE

---

## 🏭 Zookeeper as a Distributed System — Not a Single Machine

So far we've treated Zookeeper as a single machine for simplicity. But **a single Zookeeper machine is itself a SPOF**. Zookeeper runs as a **cluster of machines** internally.

```
ZOOKEEPER CLUSTER (Internal View):
─────────────────────────────────────────────────────────────

       ┌────────────────────┐
       │    ZK LEADER       │  ← ALL writes go here
       │  (elected machine) │
       └─────────┬──────────┘
                 │ replicates writes to followers
    ┌────────────┼────────────────────┐
    │            │                   │
┌───▼────┐  ┌───▼────┐          ┌───▼────┐
│ZK Fol. │  │ZK Fol. │    ...   │ZK Fol. │
│   F1   │  │   F2   │          │   Fn   │
└────────┘  └────────┘          └────────┘

  Total machines: 2n+1 (always ODD — explained below)
  Example configuration: 7 machines (1 leader + 6 followers)
─────────────────────────────────────────────────────────────
```

---

## 👑 Leader-Follower Architecture Inside Zookeeper

| Operation | Route | Condition for Success |
|-----------|-------|----------------------|
| **Write** (to any ZNode) | Goes to **ZK Leader only** | Must be acknowledged by majority of followers |
| **Read** (from any ZNode) | Can go to **any follower** | No quorum needed — followers serve reads |
| **Write during leader down** | **Forbidden** | Leader must be present for writes |
| **Read during leader down** | **Allowed** | Followers still serve reads |

```
WRITE FLOW IN ZOOKEEPER:
─────────────────────────────────────────────────────────────
  External write: Slave DB writes its IP to /master

  1. Request reaches ZK Leader
  2. ZK Leader writes to its own disk (NON-COMMITTED)
  3. ZK Leader replicates to followers in parallel:
       → Follower F1 writes, acknowledges ✅
       → Follower F2 writes, acknowledges ✅
       → Follower F3 (partitioned) — no acknowledgement ❌
       → Follower F4 writes, acknowledges ✅
       → Follower F5 writes, acknowledges ✅
       → Follower F6 (slow) — no acknowledgement ❌

  4. Leader counts: got 5 acks (self + F1 + F2 + F4 + F5)
     Majority of 7 = 4 → 5 ≥ 4 → WRITE SUCCEEDS ✅

  5. Leader commits, tells all followers to commit
  6. Returns success to the slave DB ✅
─────────────────────────────────────────────────────────────
```

---

## 💪 Strong Consistency — How Writes Work

Zookeeper achieves **strong consistency** by requiring a majority quorum for every write.

```
WHY MAJORITY (n+1 of 2n+1)?
─────────────────────────────────────────────────────────────
  If write succeeds on majority → data is safe even if
  minority machines all fail simultaneously.

  Example (7 machines, majority = 4):
  Write succeeds on: Leader, F1, F2, F3 (4 machines) ✅
  F4, F5, F6 all fail simultaneously after write:
  → Data is still on 4 machines ✅
  → System can still serve reads from any of the 4 ✅

  For READ to be consistent:
  Read from multiple nodes → take answer that majority agrees on
  Any data that passed the write quorum check will be found
  by the read quorum check → STRONG CONSISTENCY guaranteed
─────────────────────────────────────────────────────────────
```

---

## 🔄 Two-Phase Commit in Zookeeper

![Zookeeper Two-Phase Commit](./images/zk_consistency.png)

Zookeeper uses **two-phase commit (2PC)** to ensure writes are either fully committed or fully rolled back.

```
PHASE 1 — PREPARE:
───────────────────
  ZK Leader receives write request
  Leader writes data to its own disk → status: NON-COMMITTED
  Leader sends PREPARE message to all followers with the data
  Each follower:
    → Writes data to its own disk → status: NON-COMMITTED
    → Sends ACK back to leader: "Written. Ready to commit."

  The ACK is a PROMISE: "I have this data on disk.
  At any future point you ask me to commit → I WILL commit."

PHASE 2 — COMMIT (or ROLLBACK):
─────────────────────────────────
  IF majority ACKs received:
    Leader changes its own status: COMMITTED
    Leader sends COMMIT message to all followers
    Followers commit their data ✅
    Leader returns SUCCESS to client

  IF majority ACKs NOT received:
    Leader sends ROLLBACK to all followers
    Followers discard the non-committed data
    Leader returns FAILURE to client
    → Next write attempt from another slave gets a chance
```

> 💡 **Why non-committed state?** Data is on disk but marked "in-progress". If the leader crashes after writing to followers but before committing, when it comes back up it knows which transactions to roll back or commit based on the state flags.

---

## 🎲 Odd Number of Machines & Quorum — Why 2n+1

```
THE SPLIT-BRAIN PROBLEM (even number of machines):
─────────────────────────────────────────────────────────────
  4 machines, network partition splits them 2-2:
    Group A (machines 1, 2): "Master is 10.0.0.1"
    Group B (machines 3, 4): "Master is 10.0.0.2"
    → Both groups have equal weight. Which do you trust? ❌
    → IMPOSSIBLE to decide. System is paralyzed.
    → This is called SPLIT-BRAIN.

ODD NUMBER SOLUTION (2n+1 machines):
─────────────────────────────────────────────────────────────
  7 machines, any partition must result in:
    One group ≥ 4 machines (MAJORITY)
    Other group ≤ 3 machines (MINORITY)
    → Always trust the MAJORITY group ✅
    → Split-brain is mathematically impossible with odd numbers

QUORUM TABLE:
  2n+1 Total   │  n+1 Majority  │  Can tolerate failure of
  ─────────────┼────────────────┼──────────────────────────
  3 machines   │   2 required   │  1 machine
  5 machines   │   3 required   │  2 machines
  7 machines   │   4 required   │  3 machines
  9 machines   │   5 required   │  4 machines
─────────────────────────────────────────────────────────────
```

> ⚠️ **Important:** If 4 out of 7 Zookeeper machines go down → ZK cannot form a quorum → writes forbidden. But this is **extremely unlikely** in practice. 4 simultaneous machine failures means you have much bigger problems (data center fire, etc.).

---

## 🧩 Split-Brain Problem

```
SPLIT-BRAIN — VISUALIZED:
─────────────────────────────────────────────────────────────

  Normal (7 machines):                  After partition:
  ┌───┬───┬───┬───┬───┬───┬───┐        Group A     Group B
  │ L │F1 │F2 │F3 │F4 │F5 │F6 │  →→→   [L][F1][F2]  [F3][F4][F5][F6]
  └───┴───┴───┴───┴───┴───┴───┘         3 machines    4 machines
                                         MINORITY      MAJORITY → trusted ✅

  With EVEN (6 machines):
  ┌───┬───┬───┬───┬───┬───┐             [L][F1][F2]  [F3][F4][F5]
  │ L │F1 │F2 │F3 │F4 │F5 │  →→→        3 machines    3 machines
  └───┴───┴───┴───┴───┴───┘             EQUAL SPLIT → ❌ DEADLOCK
─────────────────────────────────────────────────────────────
```

---

## ⚖️ CAP Theorem — Zookeeper is CP

```
CAP THEOREM RECAP:
  You can only guarantee 2 of 3:
    C = Consistency  (all nodes see same data at same time)
    A = Availability (every request gets a response)
    P = Partition Tolerance (system works despite network splits)

  Zookeeper's choice: C + P → "CP System"
  ─────────────────────────────────────────────────────────────
  ✅ CONSISTENCY:         All reads return the latest committed write
  ✅ PARTITION TOLERANCE: System doesn't crash on network partitions
  ❌ AVAILABILITY:        If majority nodes down → system halts writes

  PRACTICAL IMPLICATION:
  If 4 of 7 ZK machines fail:
    → ZK cannot write (no quorum)
    → DB master re-election is blocked
    → But DB reads and existing master writes STILL WORK
    → Reads from ZK followers STILL WORK
    → Only NEW master election is blocked
─────────────────────────────────────────────────────────────
```

> 💡 **Important distinction:** Zookeeper being CP does NOT mean your entire application is CP. Your application layer can choose to be AP. Zookeeper is just the *coordination layer*.

---

## 💔 Zookeeper Leader Failure — What Really Happens

```
WHEN ZK LEADER GOES DOWN:
─────────────────────────────────────────────────────────────
  ❌ Writes to Zookeeper are forbidden (can't reach leader)
  ✅ Reads from Zookeeper still work (followers serve reads)
  ✅ DB reads continue normally (slaves still serve reads)
  ✅ DB writes to THE CURRENT MASTER continue uninterrupted!
     (App servers have cached the master IP in memory)
     (They don't need ZK for routine writes to known master)
  ❌ DB master RE-ELECTION becomes impossible
     (Slaves need to write to ZK leader → leader is down)
  ✅ ZK followers communicate → elect a new ZK leader
  ✅ Once new ZK leader elected → DB re-election capability restores

  KEY INSIGHT:
  ZK going down for ~20 seconds is NOT a disaster.
  ZK only manages master DISCOVERY. Actual data processing
  (DB reads/writes to the known master) continues uninterrupted.
─────────────────────────────────────────────────────────────
```

---

## ⚡ Concurrent Failure — ZK Leader + DB Master Both Down

```
WORST CASE: ZK Leader fails AT THE SAME TIME as DB Master fails
─────────────────────────────────────────────────────────────
  t=0 : DB Master crashes + ZK Leader crashes simultaneously
  t=0-5 : ZK followers elect new ZK leader (~5-10 seconds)
  t=5 : New ZK Leader is elected
  t=5+ : DB Slaves start racing to write to /master
  t=6 : One DB Slave wins → new DB master elected

  TOTAL downtime for writes: ~10-15 seconds instead of ~5 seconds
  → Delays add up but the system still recovers ✅

  The probability of BOTH failing simultaneously:
  → Extremely low (independent failure events)
  → Not worth designing around at the cost of complexity
─────────────────────────────────────────────────────────────
```

---

# PART 5: ZOOKEEPER USE CASES & COMPARISONS

---

## 🔧 Why Not Build an Internal Solution?

Someone might ask: "Why use Zookeeper? Can't we build an internal tracker?"

```
INTERNAL SOLUTION ATTEMPT:
─────────────────────────────────────────────────────────────
  Build a cluster of "tracker" machines internally
  Need to handle:
    ✗ How do tracker machines agree on who master is?
    ✗ What if a tracker machine is slow (false timeout)?
    ✗ What if the network is partitioned between trackers?
    ✗ How do we handle split-brain among trackers?
    ✗ What if the master changes WHILE we're doing re-election?
    ✗ How do we ensure notifications reach ALL subscribers?
    ✗ What if an app server is mid-write during transition?
    ✗ Two-phase commit for consistency across tracker machines?
    ✗ Quorum calculation? Odd number requirement?

  Each of these edge cases requires another sub-system.
  Each sub-system has its own edge cases.
  → Infinite recursive complexity ❌

ZOOKEEPER SOLUTION:
─────────────────────────────────────────────────────────────
  All of the above, handled, battle-tested, open-source.
  10 years of production use at Yahoo, LinkedIn, Facebook.
  Zero edge cases for you to handle.
  One dependency. ✅
─────────────────────────────────────────────────────────────
```

> 💡 **Lecture quote:** *"Zookeeper helps slaves discover the master node, simplifying the process by handling edge cases that would make an internal solution more complicated and error-prone."*

---

## 🔄 Zookeeper vs Multi-Master with Consistent Hashing

```
COMPARISON: ZOOKEEPER TRACKING vs MULTI-MASTER
─────────────────────────────────────────────────────────────

  ZOOKEEPER + MASTER-SLAVE:
  ─────────────────────────
  • All writes → one master (tracked by Zookeeper)
  • Reads → any slave
  • Strong consistency: easy (master is authoritative)
  • Read load: distributed across slaves ✅
  • Write load: bottlenecked at single master ❌
  • Master election: handled by Zookeeper ✅

  MULTI-MASTER (Consistent Hashing, no Zookeeper):
  ─────────────────────────────────────────────────
  • ALL nodes are masters — writes distributed by hash ring
  • No single write bottleneck ✅
  • Read load distributed: limited (reads go to same node as write)
  • Read load NOT distributed across all nodes ❌
  • Strong consistency: HARD (writes go to different nodes)
  • Master election: not needed (all are masters)
  • Failure handling: consistent hashing redistributes ✅

  CHOOSE ZOOKEEPER + MASTER-SLAVE WHEN:
  → You need strong consistency
  → Read load >> Write load (slaves handle reads)
  → Example: banking, inventory, config management

  CHOOSE MULTI-MASTER WHEN:
  → You can tolerate eventual consistency
  → Right load >> you need to distribute writes
  → Example: shopping cart, social feed, analytics
─────────────────────────────────────────────────────────────
```

---

## 📌 Persistent vs Ephemeral Node Use Cases

```
REAL-WORLD MAPPING:
─────────────────────────────────────────────────────────────

  PERSISTENT NODES (survive across restarts):
  ┌────────────────────────────┬───────────────────────────┐
  │ ZNode Path                 │ Content                   │
  ├────────────────────────────┼───────────────────────────┤
  │ /config/db-pool-size       │ "100"                     │
  │ /config/aws-region         │ "us-east-1"               │
  │ /config/feature-flags/beta │ "true"                    │
  │ /config/rate-limit-per-sec │ "1000"                    │
  └────────────────────────────┴───────────────────────────┘

  EPHEMERAL NODES (disappear when owner dies):
  ┌────────────────────────────┬───────────────────────────┐
  │ ZNode Path                 │ Content / Owner           │
  ├────────────────────────────┼───────────────────────────┤
  │ /master                    │ "10.0.0.5" (DB master)    │
  │ /services/payment/server1  │ "up" (payment-svc node 1) │
  │ /services/auth/server3     │ "up" (auth-svc node 3)    │
  │ /locks/job-scheduler       │ "machine-7" (lock owner)  │
  └────────────────────────────┴───────────────────────────┘

  SERVICE DISCOVERY EXAMPLE:
  When payment-server-1 starts:
    Writes ephemeral ZNode: /services/payment/server1 = "alive"
  When it crashes:
    ZNode auto-deleted → service discovery knows it's gone ✅
─────────────────────────────────────────────────────────────
```

# PART 6: THE PROBLEM — ASYNC TASKS & LATENCY

---

## ⚡ Synchronous vs Asynchronous Tasks

Consider a real-world messaging app. When a message arrives, many things need to happen:

```
ALL TASKS TRIGGERED BY ONE INCOMING MESSAGE:
─────────────────────────────────────────────────────────────
  Task                       Time     User cares?   Type
  ─────────────────────────────────────────────────────────
  Store message in DB        ~50ms    YES ✅        SYNC
  Return "sent" to user       ---     YES ✅        SYNC (after DB)

  Send push notification     ~2s      NO ❌         ASYNC
  Update analytics counter   ~200ms   NO ❌         ASYNC
  Run safety / AI scan       ~200ms   NO ❌         ASYNC
  Notify vendor (Flipkart)   ~500ms   NO ❌         ASYNC
  Generate invoice PDF        ~500ms   NO ❌         ASYNC
  ─────────────────────────────────────────────────────────
  Total (if ALL synchronous): ~3.5 seconds per message ❌
  Total (async-optimized):    ~50ms for user response  ✅
─────────────────────────────────────────────────────────────
```

**Core Principle:**

> 🎯 **Return success as soon as synchronous tasks complete. But ensure async tasks ALWAYS happen — without failure.**

The user only cares about: "Did the system receive my message?" Everything else — analytics, notifications, safety checks — is internal. The user should not wait for those.

---

## 🚨 The Failure Scenario — Why Async Tasks Can Be Lost

```
THE PROBLEM WITHOUT PERSISTENT QUEUES:
─────────────────────────────────────────────────────────────
  1. Message arrives at App Server
  2. App Server stores message in DB ✅
  3. App Server returns "success" to user ✅
  4. App Server is about to trigger async tasks...
  5. ❌ App Server CRASHES at this moment
  6. Async tasks (analytics, notifications, safety) NEVER triggered
  7. System has no record that these tasks need to happen

  → Analytics data is WRONG (event not counted)
  → User never received push notification
  → Safety check never ran (potentially dangerous content)
─────────────────────────────────────────────────────────────
```

These async tasks are NOT important to the user right now, but they ARE important to the business. How do we guarantee they always run?

**Solution: Persistent Queues.**

---

## 🛡️ Persistent Queues — The Solution

```
WITH PERSISTENT QUEUES:
─────────────────────────────────────────────────────────────
  1. Message arrives at App Server
  2. App Server stores message in DB ✅
  3. App Server pushes event to Persistent Queue ✅
     (Queue is on DISK, replicated — data is SAFE)
  4. App Server returns "success" to user ✅

  Even if App Server crashes after step 4:
  → Event is safely stored in the Queue ✅
  → Consumers will pick it up and process it ✅

  Async consumers (running separately) pick up events:
  → Analytics consumer: increments counter ✅
  → Notification consumer: sends push notification ✅
  → Safety consumer: runs AI content check ✅
  → Each consumer works at its own pace, independently ✅
─────────────────────────────────────────────────────────────
```

**Properties of a Persistent Queue:**

```
PERSISTENT QUEUE GUARANTEES:
─────────────────────────────────────────────────────────────
  ✅ Durable:      Data stored on DISK, not just in memory
  ✅ Replicated:   Copied across multiple machines → no data loss
  ✅ Ordered:      Events consumed in the order they were produced
  ✅ Reliable:     Event not lost even if consumer crashes mid-process
  ✅ Decoupled:    Producer and consumer operate independently
  ✅ Asynchronous: Producers produce at their rate; consumers at theirs
─────────────────────────────────────────────────────────────
```

> 💡 **Real-world analogy:** Converting a PDF online — you upload, they say "We'll email you in 5 minutes." You get instant confirmation. The actual conversion happens asynchronously in a queue. Same principle.

---

## 🌊 Persistent Queues as Shock Absorbers

Persistent queues have a second major use case: **absorbing traffic spikes**.

```
TRAFFIC SPIKE SCENARIO (without queue):
─────────────────────────────────────────────────────────────
  Normal: App Servers → DB (100 req/sec) ✅ DB can handle
  Spike:  App Servers → DB (10,000 req/sec) ❌ DB overwhelmed
  Result: DB crashes OR requests dropped / lost

TRAFFIC SPIKE SCENARIO (with queue):
─────────────────────────────────────────────────────────────
  Normal:
  App Servers → Queue → DB (100 req/sec) ✅

  Spike:
  App Servers → Queue (pile up, queue absorbs spike)
              ↓ slowly
              DB processes at own pace (100 req/sec sustained)

  After spike:
  Queue drains → system returns to normal ✅
  NO requests lost! Queue acts as a buffer / shock absorber.
─────────────────────────────────────────────────────────────
```

> ⚠️ **Trade-off:** Using a queue as a shock absorber introduces **latency** for those queued requests. This is acceptable for async tasks (analytics, invoices) but NOT acceptable for user-facing real-time operations.

---

# PART 7: KAFKA — ARCHITECTURE & CORE CONCEPTS

---

## 🎯 What is Kafka?

![Kafka Full Architecture Diagram](./images/kafka_architecture.png)

**Apache Kafka** is the most widely used persistent message queue / message broker / event streaming platform.

```
KAFKA KEY PROPERTIES:
─────────────────────────────────────────────────────────────
  ✅ Persistent Storage:   Data stored on disk (survives restarts)
  ✅ Replicated:           Partitions replicated across brokers
  ✅ High Throughput:      Handles millions of events/second
  ✅ Durable:              Events not lost even if consumers are down
  ✅ Multi-Consumer:       Same event consumed by multiple consumers
  ✅ Scalable:             Add brokers → add partitions → add consumers
  ✅ Zookeeper-backed:     Uses ZK internally to track partition leaders
  ✅ Configurable:         Retention period, compression, replication
─────────────────────────────────────────────────────────────
```

> 💡 Kafka uses Zookeeper internally to manage which broker is the partition leader. This is **transparent** to you as a developer — you don't configure this manually.

---

## 📡 Pub-Sub Model — Publishers & Subscribers

Kafka is built on the **Publisher-Subscriber (Pub-Sub)** model:

```
PUB-SUB MODEL:
─────────────────────────────────────────────────────────────

  PUBLISHERS (Producers):               QUEUE (Kafka)
  ──────────────────────               ──────────────
  Purchase Service     ──►             ┌────────────┐
  Messaging Service    ──►     ──────► │  Topic A   │ ──► Consumer 1
  Auth Service         ──►             │  Topic B   │ ──► Consumer 2
  Payment Service      ──►             │  Topic C   │ ──► Consumer 3
                                       └────────────┘
  SUBSCRIBERS (Consumers):
  ─────────────────────────
  Warehouse Consumer   ◄── reads only from notify-warehouse topic
  Invoice Consumer     ◄── reads only from generate-invoice topic
  Analytics Consumer   ◄── reads only from analytics topic
  Email Consumer       ◄── reads only from send-email topic

─────────────────────────────────────────────────────────────
  Producers generate at their own rate  ✅
  Consumers consume at their own rate   ✅
  They are completely decoupled         ✅
  Asynchronously connected via queue    ✅
─────────────────────────────────────────────────────────────
```

---

## 📬 Topics — Categorizing Events

If all events went into one giant queue, every consumer would have to read ALL events and discard the irrelevant ones — wasteful and noisy. **Topics** solve this by categorizing events.

```
WITHOUT TOPICS (noisy — everyone sees everything):
─────────────────────────────────────────────────────────────
  All events → ONE BIG QUEUE:
  [invoice][email][warehouse][analytics][vendorCall][invoice]...

  Warehouse Consumer reads: invoice→skip, email→skip,
                            warehouse→process, analytics→skip...
  → Reads hundreds of irrelevant events per useful one ❌

WITH TOPICS (clean — each consumer sees only what it needs):
─────────────────────────────────────────────────────────────
  Topic: "notify-warehouse"  → [warehouse][warehouse][warehouse]
  Topic: "send-email"        → [email][email][email]
  Topic: "analytics"         → [analytics][analytics][analytics]
  Topic: "generate-invoice"  → [invoice][invoice][invoice]

  Warehouse Consumer subscribes to "notify-warehouse" only ✅
  Zero noise. Zero wasted reads. ✅
─────────────────────────────────────────────────────────────
```

**Flipkart Example — Full Topic Mapping:**

```
FLIPKART KAFKA TOPICS:
─────────────────────────────────────────────────────────────
  USER ACTION: BUY PRODUCT
  → Producer (Purchase Service) sends events to:
    ├── topic: "notify-warehouse"  → Warehouse updates inventory
    ├── topic: "generate-invoice" → Invoice service creates PDF
    ├── topic: "send-email"       → Email service sends receipt
    └── topic: "analytics"        → Analytics logs purchase

  USER ACTION: MESSAGE SUPPLIER
  → Producer (Messaging Service) sends events to:
    ├── topic: "vendor-email"     → Email sent to vendor instantly
    ├── topic: "vendor-followup"  → Follow-up call if no reply in 2 days
    └── topic: "reputation"       → Update supplier reputation score
─────────────────────────────────────────────────────────────
```

> ⚠️ Topic naming is entirely up to you. Kafka doesn't care about naming conventions — use names that make sense to your team.

---

## 🔢 Partitions — Scaling Within a Topic

A single topic can receive **billions of events per day**. One consumer cannot handle this. **Partitions** split a topic so multiple consumers can work in parallel.

```
TOPIC: "send-email" — 1 BILLION events/day
─────────────────────────────────────────────────────────────

  Without partitions:
    [Producer] → [Topic] → [Consumer A] ← TOO SLOW, one consumer
    Consumer A can handle 10M events/day → needs 100x more ❌

  With partitions (4 partitions):
                                   KAFKA TOPIC: "send-email"
                              ┌──────────────────────────────┐
  App Server 1 ──────────────►│ Partition 0: [E1][E5][E9]...  │──► Consumer A
  App Server 2 ──────────────►│ Partition 1: [E2][E6][E10]... │──► Consumer B
  App Server 3 ──────────────►│ Partition 2: [E3][E7][E11]... │──► Consumer C
  App Server 4 ──────────────►│ Partition 3: [E4][E8][E12]... │──► Consumer D
                              └──────────────────────────────┘
  4 consumers, each handling 250M events/day → 1B total ✅
─────────────────────────────────────────────────────────────
```

**Partition Rules:**
```
PARTITION-CONSUMER RULES:
  ✅ One consumer can consume from exactly ONE partition
  ✅ One partition can be consumed by consumers in DIFFERENT groups
  ✅ Maximum parallel consumers = number of partitions
  ⚠️ Number of partitions ≥ number of consumers
  ⚠️ Increasing partitions AFTER creation is painful → plan ahead
  ⚠️ Partition assignment per consumer managed by Kafka internally
```

---

## 📦 Message Structure in Kafka

Every Kafka message (event) has a well-defined structure:

```
KAFKA MESSAGE FIELDS:
─────────────────────────────────────────────────────────────
  Field              Type         Notes
  ─────────────────────────────────────────────────────────
  key                binary       Optional. Determines which partition.
  value              binary       The actual event data (JSON/Avro/Protobuf)
  compression_type   enum         none / gzip / snappy / lz4 / zstd
  partition          int          Which partition this message belongs to
  offset             long         Monotonically increasing within partition
  timestamp          long         Unix timestamp when message was produced
  headers            key-value[]  Optional metadata pairs (e.g., trace IDs)
  ─────────────────────────────────────────────────────────
```

> 💡 **Value compression:** The value field (your actual event data) can be compressed. A purchase event in JSON (~2KB) might compress to ~400 bytes — significant at billion-event scale.

> 💡 **Headers:** Optional KV pairs for metadata — useful for distributed tracing (trace ID, span ID), schema version, or source service identifier.

---

## ⏰ Event Retention Period

Data in Kafka is **NOT deleted when consumed**. It is deleted only after the **retention period expires**.

```
RETENTION PERIOD EXAMPLE:
─────────────────────────────────────────────────────────────
  Default retention: 1 WEEK (configurable per topic)

  Monday 10:00am  : Event E1 produced → stored in Kafka
  Monday 2:00pm   : Consumer A reads E1 → processes it ✅
                    E1 still exists in Kafka!
  Wednesday       : Consumer B reads E1 → processes it ✅
                    E1 still exists in Kafka!
  Next Monday     : Retention period (1 week) expires
                    Kafka deletes E1 ✅

  KEY INSIGHT: Consumption ≠ Deletion
  Only time (retention period) causes deletion.
─────────────────────────────────────────────────────────────
```

**Why this design?**

```
BENEFITS OF TIME-BASED DELETION:
  ✅ Same event consumed by MULTIPLE consumer groups independently
  ✅ Consumer can replay events (re-read from earlier offset)
  ✅ Catch-up: consumer that was down can process missed events
  ✅ Multiple services can subscribe to same topic independently
```

---

## 🔀 Partition Assignment — Round-Robin vs Key-Based

**Default: Round-Robin**

```
ROUND-ROBIN (Default):
─────────────────────────────────────────────────────────────
  4 partitions in topic "send-email":

  Event 1 (email to user A) → Partition 0
  Event 2 (email to user B) → Partition 1
  Event 3 (email to user C) → Partition 2
  Event 4 (email to user D) → Partition 3
  Event 5 (email to user E) → Partition 0 (wraps around)

  ✅ Even distribution across partitions
  ✅ Good for: emails, notifications (order between entities unimportant)
  ❌ Bad  for: ordered processing per entity (e.g., driver locations)
─────────────────────────────────────────────────────────────
```

**Key-Based Assignment:**

```
KEY-BASED (Specify a key per message):
─────────────────────────────────────────────────────────────
  Formula: partition = hash(key) % num_partitions

  Example: Kafka topic "driver-location", 4 partitions

  Driver ID 10:  hash(10) % 4 = 2 → ALWAYS Partition 2
  Driver ID 25:  hash(25) % 4 = 1 → ALWAYS Partition 1
  Driver ID 10 sends update again: hash(10) % 4 = 2 ✅ SAME partition

  ALL location updates for Driver 10 → Partition 2 → Consumer C
  ALL location updates for Driver 25 → Partition 1 → Consumer B

  Consumer C sees ALL of Driver 10's locations in order ✅
  Consumer B sees ALL of Driver 25's locations in order ✅
─────────────────────────────────────────────────────────────
```

> ⚠️ **Key-based vs Consistent Hashing:** Key-based is much simpler. Consistent hashing handles server failures and rebalancing. Key-based partition assignment is just for message routing — partition failures are handled by Kafka's replication separately.

---

## 🚗 Ordered Processing — The Uber Driver Example

This use case shows exactly *when* to use key-based partitioning:

```
UBER DRIVER LOCATION — FULL EXAMPLE:
─────────────────────────────────────────────────────────────
  PROBLEM: Uber has 100,000 active drivers sending location
  updates every 5 seconds. A consumer builds their path history.

  WITHOUT KEY:
    Driver 10 update 1 → Partition 0 → Consumer A
    Driver 10 update 2 → Partition 1 → Consumer B
    Driver 10 update 3 → Partition 0 → Consumer A
    Consumer A has: [update 1, update 3] — incomplete path ❌
    Consumer B has: [update 2] — incomplete path ❌
    Nobody can build a coherent path for Driver 10! ❌

  WITH KEY (key = driver_id):
    hash("driver_10") % 4 = 2
    Driver 10 update 1 → Partition 2 → Consumer C
    Driver 10 update 2 → Partition 2 → Consumer C
    Driver 10 update 3 → Partition 2 → Consumer C
    Consumer C has: [update 1, update 2, update 3] ✅
    Complete, ordered path for Driver 10! ✅

  SETUP: Many partitions, NO consumer groups (1 consumer per partition)
  Kafka assigns ONE partition to ONE consumer ensuring order ✅
─────────────────────────────────────────────────────────────
```

---

# PART 8: KAFKA — CONSUMER GROUPS & FAULT TOLERANCE

---

## 👥 Consumer Groups — Parallel Processing

A **consumer group** is a set of consumers that collectively consume a topic, where each message is consumed **exactly once within the group**.

```
CONSUMER GROUP CONCEPT:
─────────────────────────────────────────────────────────────

  TOPIC: "analytics" — 4 partitions

  ┌────────────────────────────────────────────────┐
  │          CONSUMER GROUP A: "analytics-grp"     │
  │  Partition 0 ──────────────► Consumer A1       │
  │  Partition 1 ──────────────► Consumer A2       │
  │  Partition 2 ──────────────► Consumer A3       │
  │  Partition 3 ──────────────► Consumer A4       │
  │                                                │
  │  Every event consumed EXACTLY ONCE in Group A  │
  └────────────────────────────────────────────────┘

  ┌────────────────────────────────────────────────┐
  │        CONSUMER GROUP B: "notification-grp"    │
  │  Partition 0 ──────────────► Consumer B1       │
  │  Partition 1 ──────────────► Consumer B1       │  ← B1 handles 2 partitions
  │  Partition 2 ──────────────► Consumer B2       │
  │  Partition 3 ──────────────► Consumer B2       │  ← B2 handles 2 partitions
  │                                                │
  │  Every event consumed EXACTLY ONCE in Group B  │
  └────────────────────────────────────────────────┘

  SAME event processed ONCE by Group A AND once by Group B ✅
─────────────────────────────────────────────────────────────
```

**How consumers register:**

```python
# Consumer registers with Kafka (pseudocode):
consumer = KafkaConsumer(
    topic="analytics",          # which topic to consume from
    group_id="analytics-grp"    # which consumer group I belong to
)
# Kafka internally:
# → assigns partitions to this consumer
# → tracks which offsets this group has consumed
# → ensures no two consumers in same group get same message
```

---

## ✅ How Consumer Groups Prevent Duplicate Consumption

```
KAFKA OFFSET TRACKING PER GROUP:
─────────────────────────────────────────────────────────────
  Topic "analytics" — Partition 0:
    [E1 offset=0][E2 offset=1][E3 offset=2][E4 offset=3]...

  Group A consumed up to offset 2:
    Kafka records: Group A, Partition 0 → last_offset = 2
    Next event for Group A = offset 3 (E4)

  Group B consumed up to offset 0:
    Kafka records: Group B, Partition 0 → last_offset = 0
    Next event for Group B = offset 1 (E2)

  Groups track INDEPENDENTLY.
  Group A being ahead does NOT affect Group B's offset. ✅
─────────────────────────────────────────────────────────────
```

> 💡 Kafka maintains a separate offset pointer per (consumer group, partition) pair. This is how the same event can be consumed independently by multiple groups.

---

## 📖 Consumer Offset — FIFO Guarantee

Kafka guarantees **FIFO (First In, First Out)** order within a partition using monotonically increasing offsets.

```
OFFSET MECHANICS:
─────────────────────────────────────────────────────────────
  Every message gets an INCREMENTING OFFSET when written:
    Message 1 → offset 0
    Message 2 → offset 1
    Message 3 → offset 2
    ...
    Message N → offset N-1

  OFFSETS NEVER REPEAT — monotonically increasing forever
  Even after old messages are DELETED (after retention period),
  those offset values are never reused.

  Consumer tracks its position:
    Consumer says: "I've consumed up to offset 47"
    Consumer asks: "Give me next event after offset 47"
    Kafka returns: Event at offset 48 → FIFO guaranteed ✅

  Multiple consumers of same group:
    Consumer A processed offset 47 (Partition 0)
    Consumer B processed offset 52 (Partition 1)
    These are INDEPENDENT — different partitions have
    their own offset sequences ✅
─────────────────────────────────────────────────────────────
```

---

## 📐 Sizing Partitions & Consumers

A practical calculation from the lecture:

```
HOW MANY CONSUMERS AND PARTITIONS DO I NEED?
─────────────────────────────────────────────────────────────
  Given:
    Events arriving per second = 1,000
    Each consumer processes 1 event in 100ms
    → Consumer throughput = 10 events/second

  Calculation:
    Minimum consumers = 1,000 / 10 = 100 consumers
    Add 25% headroom → ~125 consumers

  Rule: partitions ≥ consumers → need ≥ 125 partitions

  EXAMPLE (safety margin calculation):
    Events/sec = 5,000
    Consumer throughput = 50 events/sec
    Min consumers = 5,000 / 50 = 100
    With buffer (25%) = 125 consumers
    → Create 125 partitions ✅
─────────────────────────────────────────────────────────────
```

> ⚠️ **Over-partitioning is better than under-partitioning.** You can always add consumers up to the partition count. You cannot easily reduce partitions after creation.

---

## 🛡️ Kafka Brokers & Replication

Each Kafka machine is called a **broker**. Kafka replicates partitions across brokers for fault tolerance.

```
KAFKA CLUSTER — REPLICATION LAYOUT:
─────────────────────────────────────────────────────────────
  Setup: 4 topics × 2 partitions × replication factor 2
  Total items = 4 × 2 × 2 = 16 partitions across 3 brokers

  BROKER 1               BROKER 2               BROKER 3
  ────────────────       ────────────────       ────────────────
  Topic A, Part 0  (L)   Topic A, Part 0  (R)   Topic A, Part 1  (L)
  Topic A, Part 1  (R)   Topic B, Part 0  (L)   Topic B, Part 0  (R)
  Topic B, Part 1  (L)   Topic B, Part 1  (R)   Topic C, Part 0  (L)
  Topic C, Part 0  (R)   Topic C, Part 1  (L)   Topic C, Part 1  (R)
  Topic D, Part 0  (L)   Topic D, Part 0  (R)   Topic D, Part 1  (L)
  Topic D, Part 1  (R)   ...                    ...

  (L) = Leader partition   (R) = Replica partition

  If Broker 2 fails completely:
    Topic A Part 0 Replica → Broker 1 has Leader ✅
    Topic B Part 0 Leader → Broker 3 Replica promoted ✅
    NO DATA LOST ✅
─────────────────────────────────────────────────────────────
```

> 💡 Kafka uses Zookeeper internally to track which broker hosts which partition leader, and to trigger leader re-election when a broker fails.

---

## 🔀 Talking to Any Kafka Broker — Smart Routing

Kafka makes life simple for producers and consumers:

```
SMART ROUTING — TALK TO ANY BROKER:
─────────────────────────────────────────────────────────────
  Producer wants to write to topic "analytics", Partition 2

  Step 1: Producer connects to ANY broker (e.g., Broker 1)
  Step 2: Broker 1 checks metadata:
          "analytics, Partition 2 leader is on Broker 3"
  Step 3: Broker 1 redirects request to Broker 3

  OR alternatively:
  Step 3: Broker 1 returns metadata to Producer
  Step 4: Producer connects DIRECTLY to Broker 3

  KEY BENEFIT:
  App servers don't need to know which broker holds
  which partition. They just talk to ANY broker.
  Kafka handles all internal routing. ✅
─────────────────────────────────────────────────────────────
```

---

## 🔗 Kafka + Zookeeper — Internal Relationship

```
HOW KAFKA USES ZOOKEEPER INTERNALLY:
─────────────────────────────────────────────────────────────
  Kafka Zookeeper ZNodes:
    /brokers/ids/1           → Broker 1 is alive (ephemeral)
    /brokers/ids/2           → Broker 2 is alive (ephemeral)
    /brokers/topics/analytics/partitions/0/state
                             → "leader": 2 (Broker 2 is leader)
    /controller              → "brokerid": 1 (Broker 1 is controller)

  When Broker 2 fails:
    ZK detects heartbeat loss → deletes /brokers/ids/2
    ZK notifies Kafka controller (Broker 1)
    Kafka controller promotes replica on Broker 3 as new leader
    ZK updates /brokers/topics/analytics/partitions/0/state
    Producers now route to Broker 3 for Partition 0 ✅

  This is completely transparent to you as a developer.
  You just use the Kafka client library. ✅
─────────────────────────────────────────────────────────────
```

---

# PART 9: SUMMARY & INTERVIEW PREP

---

## ⚔️ Zookeeper vs Kafka — When to Use What

```
┌─────────────────────────────────────────────────────────────────────┐
│                ZOOKEEPER vs KAFKA — AT A GLANCE                      │
├────────────────────────────┬────────────────────────────────────────┤
│         ZOOKEEPER          │               KAFKA                    │
├────────────────────────────┼────────────────────────────────────────┤
│ Who is the master DB?      │ Async task processing (email, analytics)│
│ Which services are online? │ Decouple producers from consumers      │
│ Distributed locking        │ Event streaming at massive scale       │
│ Global config management   │ Traffic spike absorption (shock buffer) │
│ Leader election            │ Multiple consumers for same event      │
│ Group membership tracking  │ Ordered processing per entity (w/ keys)│
│ Service discovery          │ Replay capability (re-read old events) │
├────────────────────────────┼────────────────────────────────────────┤
│ CAP: CP                    │ CAP: AP (high availability preferred)  │
│ Data: tiny config values   │ Data: event payloads (can be large)   │
│ Write freq: very rare      │ Write freq: millions per second        │
│ Storage: tiny (config)     │ Storage: weeks of events               │
│ Reads: serve from follower │ Reads: consumers pull from partitions  │
└────────────────────────────┴────────────────────────────────────────┘
```

---

## 🏗️ Complete Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│              FULL SYSTEM — ZOOKEEPER + KAFKA COMBINED                 │
└──────────────────────────────────────────────────────────────────────┘

  CLIENT (Mobile / Browser)
       │ HTTP / REST Request
       ▼
  LOAD BALANCER
       │
       ▼
  APP SERVER CLUSTER (stateless)
   ├── On startup: reads /master from Zookeeper → caches master IP
   ├── Subscribes to /master for push notifications
   ├── On write request: writes DIRECTLY to cached master IP
   └── On "master = null" or ZK disconnect: stops all writes
       │
       ├──────────────────────────────────────────────────────────►
       │  Reads /master                                ZOOKEEPER
       │  Subscribes to /master                       CLUSTER
       │                                          [ZK Leader + Followers]
       │                                          [Maintains /master node]
       │
       │ Writes (to current master)
       ▼
  MASTER DB ──────────────────────────────────► SLAVE DBs
  (writes) ← ZK tracks who this is             (replication, reads)
       │
       │ App Server also pushes async events
       ▼
  KAFKA CLUSTER (Brokers 1..N)
  ← Zookeeper tracks partition leaders internally →
       │
       ├── Topic: "notify-warehouse"
       │     Partitions 0..N ──► Warehouse Consumers
       │
       ├── Topic: "send-email"
       │     Partitions 0..N ──► Email Consumers
       │
       ├── Topic: "analytics"
       │     Partitions 0..N ──► Analytics Consumers
       │
       └── Topic: "generate-invoice"
             Partitions 0..N ──► Invoice Consumers
```

---

## 📊 Quick Reference Cheatsheet

### Zookeeper

| Concept | Key Detail |
|---------|------------|
| **Purpose** | Centralized config management + distributed synchronization |
| **CAP** | CP — Consistency + Partition Tolerance |
| **Node types** | Persistent (until deleted) vs Ephemeral (tied to machine heartbeat) |
| **Heartbeat timeout** | Configurable — e.g., 5 seconds |
| **Write quorum** | Must write to majority: n+1 of 2n+1 machines |
| **Machine count** | Always ODD (2n+1) to prevent split-brain |
| **Watch/Subscribe** | Push-based notification when ZNode data changes |
| **Connection type** | Bidirectional — both sides detect disconnection |
| **Leader failure** | Writes forbidden; reads continue; ZK elects new leader via followers |
| **Use cases** | Master election, service discovery, distributed locks, config store |
| **Two-phase commit** | Writes: PREPARE → ACK from majority → COMMIT (or ROLLBACK) |

### Kafka

| Concept | Key Detail |
|---------|------------|
| **Purpose** | Persistent message queue / event streaming |
| **Topic** | Category/named sub-queue for events (e.g., "send-email") |
| **Partition** | Sub-division of a topic for parallel processing |
| **Consumer Group** | A set of consumers; each partition consumed by exactly one consumer per group |
| **Consumer offset** | Monotonically increasing position in a partition; enables FIFO; never reused |
| **Retention period** | Default 1 week; deletion by time, NOT by consumption |
| **Default routing** | Round-robin across partitions |
| **Key-based routing** | hash(key) % num_partitions → same key always → same partition |
| **Broker** | A single Kafka machine |
| **Replication** | Partitions replicated across brokers; ZK manages partition leader |
| **Zookeeper role** | Kafka uses ZK internally to track broker liveness + partition leaders |
| **Message fields** | key, value, compression, partition, offset, timestamp, headers |

---

## 🧠 Mental Models — Quick Memory Aid

```
MENTAL MODEL — ZOOKEEPER:
─────────────────────────────────────────────────────────────
  Zookeeper = a BULLETIN BOARD that all machines can see
  - Persistent nodes = sticky notes that stay forever
  - Ephemeral nodes = sticky notes that fall when the poster leaves
  - Subscriptions = machines standing by the board, ready to act on changes
  - Leader = the person managing the board in a consistent manner
─────────────────────────────────────────────────────────────

MENTAL MODEL — KAFKA:
─────────────────────────────────────────────────────────────
  Kafka = a POST OFFICE with named sorting trays
  - Topic = a named tray (e.g., "invoices")
  - Partition = sections within the tray (numbered slots)
  - Producer = mail carrier dropping letters into trays
  - Consumer = recipient collecting their letters
  - Consumer Group = a team sharing delivery duties for one tray
  - Offset = page number — consumer keeps bookmark, reads sequentially
  - Retention = letters kept for 1 week, then auto-shredded
─────────────────────────────────────────────────────────────
```

---

## ❓ Practice Questions

### Zookeeper Questions

1. Why does Zookeeper use an **odd number** of machines? What problem does even numbers cause?
2. What is the difference between a **persistent node** and an **ephemeral node**? Give a real-world use case for each.
3. Walk me through the complete **master re-election flow** using Zookeeper from the moment the master crashes.
4. Why is the **two-way connection** between Zookeeper and app servers critical? What catastrophe does it prevent?
5. What happens to DB reads, DB writes, and master re-election when **Zookeeper's leader goes down**?
6. A slave DB loses its connection to Zookeeper. What happens? Is this a critical problem?
7. Explain **Two-Phase Commit** in Zookeeper. What happens if fewer than half the followers acknowledge?
8. Zookeeper is **CP** in CAP theorem. What does this mean in practical terms?
9. The master machine gets network-partitioned from Zookeeper but is still running. What happens? How is it resolved?
10. Why is it better to use Zookeeper than to build an internal master-tracking solution?

### Kafka Questions

1. What is a **topic** in Kafka? Why are topics necessary?
2. What is the difference between a **topic** and a **partition**?
3. Consumer A in Group A consumes an event. Will Consumer B in **Group B** also see that event? Why?
4. How does Kafka guarantee **FIFO ordering** within a partition?
5. You're building an Uber-like system. How do you ensure all **location updates from driver D** always go to the same consumer?
6. How many **partitions and consumers** do you need for a topic receiving 5,000 events/second, where each consumer handles 50 events/second?
7. What happens to events in Kafka **after they are consumed**?
8. What is the **default event retention period** in Kafka and how does time-based deletion work?
9. How does Kafka handle a **broker going down** — what prevents data loss?
10. Explain the **Pub-Sub model** and how Kafka implements it with topics, partitions, and consumer groups.
11. Why would you choose **key-based** partition assignment over round-robin? Give a concrete example.
12. How does Kafka internally use **Zookeeper**?

### Design Scenario Questions

1. You have a system that sends emails, notifies warehouses, and runs fraud checks whenever a purchase is made. Design the **Kafka topic and consumer architecture**.
2. A system has **1 million events/second** going into a single Kafka topic. Each consumer handles 10K events/second. How many partitions and consumers do you need?
3. Your Kafka broker cluster has 3 brokers with replication factor 2. **Broker 2 fails.** What happens? Is data lost?
4. Design a system where **driver location updates** must be processed in order per driver. How do you configure Kafka?
5. When would you use **Zookeeper** vs **Kafka** in a system design? Give a concrete scenario where you use both.

---

## 📚 References & Resources

- [Apache Zookeeper Official Documentation](https://zookeeper.apache.org/)
- [Apache Kafka Official Documentation](https://kafka.apache.org/documentation/)
- [Kafka Consumer Groups Deep Dive](https://kafka.apache.org/documentation/#intro_consumers)
- [Kafka Message Format Specification](https://kafka.apache.org/documentation/#messageformat)
- [Two-Phase Commit Protocol (Wikipedia)](https://en.wikipedia.org/wiki/Two-phase_commit_protocol)
- [CAP Theorem Explained](https://en.wikipedia.org/wiki/CAP_theorem)
- [ZooKeeper Recipes and Solutions](https://zookeeper.apache.org/doc/r3.9.1/recipes.html)

---

> 💡 **Quick Memory Aid:**
> - **Zookeeper** = *Bulletin board that all distributed machines check + a consistent manager ensuring everyone sees the same thing*
> - **Kafka** = *Post office with named sorting trays (topics), numbered slots (partitions), and teams of delivery staff (consumer groups)*

