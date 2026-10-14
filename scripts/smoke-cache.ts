import { loadEnvFile } from 'node:process';
import type { ScoringRubric } from '../src/lib/types';

async function main(): Promise<void> {
try {
  loadEnvFile('.env.local');
} catch {
  throw new Error('scripts/smoke-cache.ts requires a readable .env.local file');
}

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY is missing from .env.local');
}

const { scoreCandidate } = await import('../src/lib/anthropic');

const rubric: ScoringRubric = {
  criteria: [
    {
      id: 'agent-evaluation-design',
      name: 'Agent Evaluation Design and Failure Analysis',
      weight: 30,
      description:
        'Measures whether the candidate has designed rigorous evaluations for production AI agents, especially multi-step systems whose failures cannot be captured by a single accuracy metric. Strong evidence connects evaluation sets to real user tasks, defines observable failure taxonomies, separates model, retrieval, tool, and orchestration errors, and shows how offline findings changed a shipped system. The signal is ownership of the evaluation methodology and judgment about representative data, not simply running an existing benchmark or reporting aggregate pass rates.',
      scoringGuide: {
        high:
          'The resume shows repeated ownership of end-to-end agent evaluation programs in production. The candidate created representative task suites from traces or expert workflows, defined granular failure categories, built reproducible graders with human calibration, and measured both task success and harmful side effects. Evidence includes concrete scale, such as thousands of versioned scenarios, multiple tool environments, inter-rater agreement, or a quantified reduction in escaped failures. They diagnosed interactions among prompts, model behavior, retrieval quality, tool contracts, and orchestration rather than treating the model as a black box. The work informed launch gates, model or prompt selection, regression policy, and engineering priorities. Exceptional evidence also demonstrates counterfactual or adversarial testing, contamination controls, longitudinal monitoring, and a clear account of where automated judging was unreliable and required expert review.',
        mid:
          'The candidate built or materially extended evaluation pipelines for LLM applications and can point to useful datasets, graders, dashboards, or release checks. They understand that aggregate quality scores hide distinct failure modes and have performed some qualitative error analysis. Their work may include curated test cases, rubric-based judging, human review, or comparisons across prompts and models, but the resume does not establish full ownership of sampling strategy, failure taxonomy, or production decision-making. Metrics are credible but modest in scale or weakly tied to user outcomes. They may have evaluated chat or retrieval systems without the multi-step tool-use complexity central to this role. This is solid applied experience, but it lacks several top-band signals such as evaluator calibration, adversarial coverage, trace-derived datasets, explicit launch gates, or demonstrated reductions in real-world failure rates.',
        low:
          'The resume mentions benchmarks, unit tests, prompt experimentation, model accuracy, or generic quality assurance without showing a designed evaluation methodology. Evidence is limited to running public benchmarks, reporting one aggregate metric, manually inspecting a few examples, or relying on vendor-provided scores. There is no clear failure taxonomy, no representative dataset construction, no connection between offline tests and production behavior, and no account of grader reliability. Candidates who only trained models, built dashboards, or wrote ordinary software tests score in this band unless they explicitly applied those skills to agent behavior. A complete absence of agent evaluation evidence should score near the bottom even if the candidate has strong general machine-learning credentials, because this criterion measures specialized evaluation judgment rather than adjacent engineering competence.',
      },
    },
    {
      id: 'tool-use-runtime',
      name: 'Reliable Tool-Using Agent Runtime Engineering',
      weight: 28,
      description:
        'Measures hands-on ownership of the runtime that lets an AI agent plan, call tools, observe results, recover from errors, and complete useful work safely. The discriminative signal is experience with the failure-prone boundary between probabilistic model output and deterministic services: typed tool contracts, state transitions, idempotency, timeouts, retries, partial completion, context management, and traceability. Generic backend systems work is relevant only when the resume ties it directly to deployed model-driven workflows and documents how agent-specific failure modes were controlled.',
      scoringGuide: {
        high:
          'The candidate designed and shipped a production runtime for multi-step, tool-using agents with explicit state, durable or replayable execution, and strong observability. Their resume gives concrete examples of typed tool schemas, validation of model-generated arguments, retry and timeout semantics, idempotent side effects, permission boundaries, context compaction, or recovery after partial failure. They handled real integrations rather than toy calculators and explain measurable reliability, latency, throughput, or completion-rate improvements. Strong evidence distinguishes model retries from infrastructure retries and prevents duplicated external actions. The candidate has debugged traces across model calls, retrieval, tool services, and workflow state, then changed the architecture based on those findings. Exceptional profiles also show principled human approval points, sandboxing for risky tools, deterministic replay, versioned prompts and tool definitions, or migration across models without destabilizing production workflows.',
        mid:
          'The resume shows meaningful implementation of agents that invoke APIs, databases, browsers, or internal services and complete more than one reasoning step. The candidate used structured tool calling, maintained conversation or workflow state, and addressed some operational concerns such as retries, validation, tracing, or rate limits. However, the system may have remained a limited pilot, used a framework without substantial runtime ownership, or lacked durable recovery and careful side-effect handling. Reliability claims are plausible but not quantified, and the candidate may describe the happy path more clearly than failure behavior. This band also covers strong backend engineers who recently shipped a real agent integration but have not yet demonstrated broad experience across model errors, context limits, tool evolution, and production incident diagnosis. Several role-specific signals are present, but not the complete runtime judgment expected of the highest band.',
        low:
          'Evidence consists of chatbots, prompt chains, demonstrations, notebooks, or framework tutorials with no production tool-runtime depth. The candidate may say they built an agent with LangChain or a similar library but does not identify tools, state, failure recovery, observability, or external side effects. Ordinary microservice, workflow, or distributed-systems experience does not by itself satisfy this criterion when the resume never connects it to model-directed execution. Systems that make a single retrieval call and generate an answer are weak evidence. Missing discussion of argument validation, retries, permissions, idempotency, or trace debugging indicates that the candidate has not yet confronted the core reliability problems. Score near the bottom when agent terminology appears only in a skills list or hackathon project without concrete architecture, users, operational scale, or outcomes.',
      },
    },
    {
      id: 'production-learning-loop',
      name: 'Production Feedback and Agent Improvement Loops',
      weight: 24,
      description:
        'Measures whether the candidate can turn production behavior into a disciplined learning loop rather than relying on anecdotal prompt tweaks. Strong candidates connect user outcomes and traces to dataset curation, diagnosis, experiment design, rollout, and regression protection. They understand selection bias, delayed or noisy feedback, privacy constraints, and the difference between optimizing a proxy and improving the actual task. The criterion rewards a demonstrated cycle of observing failures, prioritizing them, changing the system, and verifying durable gains across versions.',
      scoringGuide: {
        high:
          'The resume documents one or more closed-loop improvement systems for deployed AI products. The candidate instrumented traces and outcomes, joined them with explicit or implicit feedback, sampled failures systematically, and converted findings into versioned evaluation cases or training data. They ran controlled experiments or staged rollouts, guarded against regressions, and reported user-centered improvements such as successful task completion, lower escalation, reduced correction effort, or higher retained usage. They can show how feedback quality was audited, how privacy or sensitive data was handled, and how noisy signals were separated from actionable labels. Top evidence includes active-learning strategies, expert adjudication, causal experiment design, drift detection, or prioritization based on impact and frequency. The key distinction is a repeatable operational mechanism that kept improving the agent, not a one-time analysis or an unsupported claim that prompts were iterated based on feedback.',
        mid:
          'The candidate used production logs, support reports, user ratings, or qualitative research to improve an LLM feature over multiple releases. They created new test cases from observed failures and can cite at least one measured quality gain. Some pieces of the loop may be informal: sampling is manual, labels are lightly calibrated, experiments lack clean controls, or regression coverage is incomplete. The resume demonstrates good product and engineering instincts but not a mature system for continuously converting behavior into reliable evidence. This band also fits candidates who built strong experimentation or analytics infrastructure for AI products but did not own the full path from trace diagnosis through remediation and guarded rollout. The work is clearly more than ad hoc prompt tweaking, yet lacks the scale, methodological rigor, repeatability, or user-outcome linkage required for the highest scores.',
        low:
          'The resume says the candidate monitored metrics, collected feedback, improved prompts, or performed A/B tests without explaining how those activities formed an agent-specific learning loop. Generic analytics, experimentation platforms, recommendation-system feedback, and model-training pipelines are adjacent but insufficient unless tied to production agent traces and behavioral failures. There is no evidence that failures became durable evaluation cases, that changes were verified against regressions, or that proxy metrics reflected successful user tasks. One-time prompt tuning on a handpicked set belongs in this band. Score very low when improvement claims have no baseline, sample definition, measured outcome, or versioning discipline, or when feedback is treated as automatically correct despite obvious noise and selection effects. Strong general product sense cannot substitute for explicit evidence of operating and improving a deployed AI agent.',
      },
    },
    {
      id: 'safety-trust-boundaries',
      name: 'Agent Safety and Trust-Boundary Engineering',
      weight: 18,
      description:
        'Measures practical experience preventing model-driven workflows from causing unauthorized, irreversible, privacy-sensitive, or misleading actions. This is not a generic security criterion: evidence must involve AI agents, tool calls, retrieved or user-supplied content, and the special problem that model text cannot be trusted as an authorization decision. Strong work maps threats to concrete controls at deterministic boundaries while preserving product usefulness, then validates those controls with adversarial tests and production evidence.',
      scoringGuide: {
        high:
          'The candidate owned safety architecture for a deployed agent with consequential tools or sensitive data. Their resume describes concrete trust boundaries and controls such as scoped credentials, server-side authorization independent of model output, confirmation before irreversible actions, allowlisted tool capabilities, tenant isolation, prompt-injection defenses, output validation, data minimization, sandboxing, or tamper-resistant audit records. They built adversarial test suites and red-team scenarios covering indirect prompt injection, malicious documents, tool-result manipulation, exfiltration, confused-deputy behavior, and unsafe retries. Evidence includes blocked incidents, quantified attack coverage, reduced false positives, successful reviews, or safe enablement of a previously restricted workflow. Exceptional candidates articulate tradeoffs: where deterministic policy replaced prompting, where human approval remained necessary, and how controls evolved after observed failures without turning the system into unusable security theater.',
        mid:
          'The candidate implemented meaningful safeguards for an LLM application or agent, such as input and output validation, access checks around tools, content filtering, approval flows, secret handling, tenant separation, or prompt-injection testing. The work went beyond a policy document and affected shipped code, but coverage may be narrow or reactive. They may have secured read-only assistants rather than agents with consequential actions, relied partly on prompt instructions, or lacked systematic adversarial evaluation. General application-security experience receives credit only where the resume clearly applies it to model behavior and tool use. This band represents credible awareness and some production implementation, while missing several top signals such as explicit threat modeling, deterministic authorization, indirect-injection defenses, measurable red-team results, incident-driven iteration, or careful handling of irreversible side effects.',
        low:
          'The resume lists responsible AI, guardrails, privacy, security, moderation, or compliance without concrete agent-specific controls. Prompt instructions telling the model not to reveal secrets or take unsafe actions are weak evidence because the model is not a trustworthy enforcement point. Generic IAM, encryption, secure coding, or governance work does not satisfy the criterion unless it protects model-directed tools or untrusted retrieved content. There is no threat model, no adversarial testing, and no example of a deterministic boundary that constrained an agent. Toy content filters or a single moderation API call also remain low. Score near zero if the candidate built agents with external actions but never mentions authorization, confirmation, isolation, validation, injection attacks, data exposure, or failure containment, since that omission suggests limited experience operating across these trust boundaries.',
      },
    },
  ],
  tableStakes: [
    'TypeScript or Python',
    'production API development',
    'cloud deployment',
    'Git and automated testing',
    'clear technical communication',
  ],
};

const first = await scoreCandidate({
  rubric,
  idealPatterns: null,
  candidateId: 'smoke-1',
  candidateName: 'Avery Chen',
  resumeBase64: null,
  resumeText:
    'Staff AI Engineer at Northstar. Built a tool-using support agent with typed schemas, trace replay, and 1,800 evaluation cases. Reduced failed actions 31% through idempotent retries and approval gates.',
  resumeMimeType: 'text/plain',
  useFileInput: false,
});

const second = await scoreCandidate({
  rubric,
  idealPatterns: null,
  candidateId: 'smoke-2',
  candidateName: 'Jordan Silva',
  resumeBase64: null,
  resumeText:
    'Senior ML Engineer at Meridian. Created trace-derived agent evaluations, calibrated human graders, and a feedback loop that cut customer corrections 24% across three releases.',
  resumeMimeType: 'text/plain',
  useFileInput: false,
});

if ((second.usage.cache_read_input_tokens ?? 0) === 0) {
  throw new Error(
    `Second call did not read the prompt cache (first creation=${first.usage.cache_creation_input_tokens ?? 0}, second input=${second.usage.input_tokens})`
  );
}
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
