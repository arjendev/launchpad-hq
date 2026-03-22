---
name: "jaeger"
description: "Ability to fetch traces and spawn Jaeger UI for trace visualization"
---

## Context

This skill enables agents to interact with Jaeger, a popular open-source distributed tracing system. With this skill, agents can fetch trace data from Jaeger and spawn the Jaeger UI for visualizing traces.

## Capabilities

- **Fetch Traces:** Retrieve trace data from Jaeger based on specified criteria (e.g., trace ID, service name, time range).
- **Fetch Spans:** Retrieve span data associated with specific traces for detailed analysis.

## Usage

### Traces API
Call the following api to get traces:

```http://localhost:16686/api/traces/:traceId?service=launchpad-hq```

This will return the trace data in JSON format, which can then be used to visualize the trace in the Jaeger UI or for further analysis.

### Spans API

Call the following api to get spans for a specific trace:

```http://localhost:16686/api/spans/:spanId?service=launchpad-hq```
