# UHRP Overlay Service

An overlay network implementation of the **Universal Hash Resolution Protocol (UHRP)** — a topic manager and lookup service that lets anyone discover where a file identified by its hash is currently being hosted on the public internet.

## What is UHRP?

UHRP ([BRC-26](https://github.com/bitcoin-sv/BRCs/blob/master/overlays/0026.md)) is a standard for advertising content availability on BSV. A host who is willing to serve a file creates an on-chain advertisement — a PushDrop token containing the file's SHA-256 hash, an HTTPS URL where the file can be fetched, the file size, and an expiry time. Spending that token revokes the advertisement.

Because multiple hosts can advertise the same hash, UHRP turns file hosting into something that looks closer to a CDN than a single point of failure: publishers can pay any number of hosts to keep a copy online, and clients can resolve a hash to a live list of mirrors at lookup time.

## What does this overlay enable?

This repo runs the two overlay components that make UHRP queryable:

- **Topic Manager (`tm_uhrp`)** — a [BRC-22](https://github.com/bitcoin-sv/BRCs/blob/master/overlays/0022.md) node that accepts transactions containing UHRP advertisement tokens, validates them (PushDrop structure, signature linkage, HTTPS URL, valid expiry/size, correct hash length), and admits the valid outputs into the overlay.
- **Lookup Service (`ls_uhrp`)** — a [BRC-24](https://github.com/bitcoin-sv/BRCs/blob/master/overlays/0024.md) service backed by MongoDB that indexes admitted advertisements and answers queries by `outpoint`, `uhrpUrl`, `expiryTime`, `fileSize`, or `hostIdentityKey`.

Together, running this overlay means clients on your network can ask *"who is currently hosting the file with this hash?"* and get back a tamper-evident, on-chain-anchored answer.

## Why run one?

- **Provide a resolution endpoint** for apps (wallets, storage clients, publishing tools) that need to turn a UHRP URL into a live download location.
- **Increase availability** of the UHRP network — the more independent overlay nodes indexing advertisements, the more robust content resolution becomes.
- **Serve a specific community or region** with a lookup service tuned to hosts you care about, without depending on a third party.
- **Integrate with a hosting business** — if you operate a UHRP host, running the overlay alongside it keeps your advertisements directly queryable.

## Getting Started

- Clone this repository
- Run `npm i` to install dependencies
- Run `npm run lars` to configure the local environment
- Run `npm run start` to spin up the overlay locally via [LARS](https://github.com/bitcoin-sv/lars)

## Deployment

- Run `npm run cars` to configure one or more hosting providers via the [CARS CLI](https://github.com/bitcoin-sv/cars-cli)
- Run `npm run build` to create CARS artifacts
- Run `npm run deploy` to publish

You can also [run your own CARS node](https://github.com/bitcoin-sv/cars-node) to self-host the deployment infrastructure.

## Project Structure

```
deployment-info.json        # BRC-0102 app manifest (topics + lookup services)
backend/
  src/
    topic-managers/         # tm_uhrp — validates and admits UHRP advertisements
    lookup-services/        # ls_uhrp — indexes and answers availability queries
    types.ts
```

## Further Reading

- [BRC-26 — Universal Hash Resolution Protocol](https://github.com/bitcoin-sv/BRCs/blob/master/overlays/0026.md)
- [BRC-22 — Overlay Network Data Synchronization](https://github.com/bitcoin-sv/BRCs/blob/master/overlays/0022.md)
- [BRC-24 — Overlay Network Lookup Services](https://github.com/bitcoin-sv/BRCs/blob/master/overlays/0024.md)
- [BRC-0102 — `deployment-info.json` specification](https://github.com/bitcoin-sv/BRCs/blob/master/apps/0102.md)

## License

[Open BSV License](./LICENSE.txt)

## Lookup compatibility and verification

The lookup service accepts SDK pagination controls (`limit` up to 200, `offset` up to 1,000,000) separately from advertisement selectors. Results remain active-only and sort by outpoint for stable paging. Selectors are `uhrpUrl`, `hostIdentityKey`, `expiryTime`, or `outpoint`; database operators and unsupported fields are rejected. Legacy queries without pagination remain supported with a bounded default page.

Run `npm ci --ignore-scripts` at the root and in `backend`, then `npm --prefix backend test`, `npm --prefix backend run lint`, and both dependency audits. Node 22/24 CI verifies real SDK signed-token admission, expiry rejection, paginated/legacy lookup compatibility, and malformed query rejection. Backend SDK/Overlay/MongoDB versions are pinned to a compatible published set; CARS builds the production Linux image on the cluster.

The backend pins the published Overlay 2.6.2 patch so unconfirmed SQL output
heights are represented as absent metadata without changing stored state or
strict transaction validation. No database migration is required. CARS generates
the surrounding server runtime independently; release acceptance must record
its installed versions and verify live paginated discovery and fresh unconfirmed
advertisements. Source tests alone do not establish a deployed CARS runtime.
