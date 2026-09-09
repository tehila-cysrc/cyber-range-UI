# System Flows

Cross-system data flows. Read when a task touches more than one service.

## Topology

```
<ASCII diagram of services, who calls whom, where data lives>
```

## Connection matrix

| From | To | Protocol | Port | Auth | Notes |
|------|----|----------|------|------|-------|
| ...  | ...| ...      | ...  | ...  | ...   |

## Flow 1: <name, e.g. user login>

1. Client → <service> `<endpoint>`
2. <service> validates against <store>
3. <service> issues <token type>
4. ...

## Flow 2: <name>

1. ...
