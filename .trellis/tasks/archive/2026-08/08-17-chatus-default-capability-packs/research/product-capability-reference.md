# Product Capability Reference Research

## Question

Which public OpenAI and DeepSeek patterns are useful when designing default
Chatus member capabilities, and which claims are not supported by public docs?

## Sources Read

1. OpenAI Docs, "MCP and Connectors":
   https://developers.openai.com/api/docs/guides/tools-connectors-mcp
2. OpenAI Docs, "Skill controls":
   https://learn.chatgpt.com/docs/enterprise/skills
3. DeepSeek API Docs, "Your First API Call":
   https://api-docs.deepseek.com/

OpenAI pages were located and fetched through the official OpenAI documentation
search. The DeepSeek page was fetched directly with:

```powershell
smart-search fetch "https://api-docs.deepseek.com/" --format markdown
```

The normal `smart-search doctor` and generative search route were deliberately
not used because this task forbids model-generating probes and live model calls.

## Supported Conclusions

- OpenAI describes Skills as reusable workflows made from instructions and
  supporting resources. It treats Skill distribution, plugin installation,
  connector authorization, and MCP-server control as separate lifecycle and
  permission boundaries.
- OpenAI describes connectors as maintained MCP wrappers and remote MCP servers
  as externally hosted tools. The public guidance recommends approval before
  data sharing, explicit allowed-tool filtering, trusted/official servers, and
  review of data sent to and returned from third parties.
- OpenAI warns that remote MCP tools can expose sensitive context, return URLs,
  change behavior, or introduce prompt injection. This supports Chatus keeping
  external capabilities opt-in, reviewed, bounded, and visibly disclosed.
- DeepSeek's public API page states that its API is compatible with OpenAI and
  Anthropic formats and can be integrated as a backend for agent tools. This
  supports reusing Chatus protocol adapters and capability governance rather
  than adding DeepSeek-specific UI assumptions.

## Unsupported Conclusions

- The reviewed DeepSeek public API page does not document a signed-in web UI
  Skill catalog, plugin system, connector permissions, or internal orchestration.
- Public OpenAI product documentation does not imply that Chatus should ship the
  same connector set, approval defaults, storage policy, or private product UI.
- Neither source establishes that a text-only model becomes natively multimodal
  when an external tool or auxiliary model inspects an image.

## Design Impact

- Chatus should keep instruction Skills separate from executable tools and
  auxiliary Provider work.
- No remote MCP server or connector is installed by default.
- External requests require explicit assignment, disclosure, review, and
  bounded approval behavior.
- Product references inform terminology and risk controls only. Local Chatus
  contracts remain authoritative for runtime, privacy, tests, and rollback.
