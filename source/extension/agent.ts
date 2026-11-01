import type {
  _Author_Doctor_,
  _Id_Document_,
  _Id_Node_,
  _Node_Document_,
  _Proposal_Task_,
  _Task_Doctor_,
} from "../shared/domain.next.ts";
import { parse } from "../shared/parse.ts";
import { proposalPayloadSchema } from "../shared/protocol.ts";
import { documentIdSchema } from "../shared/schema.ts";
import { indexNodes } from "../shared/tree.ts";
import type { _Answer_Endpoint_, _Request_Endpoint_ } from "./endpoint.ts";
import { activeTask, propose, show, submit, type _Place_Tasks_ } from "./tasks.ts";

const answer = (status: number, body: unknown): _Answer_Endpoint_ => ({ status, body });
const issues = (status: number, list: Array<string>) => answer(status, { issues: list });

// what the agent needs of a proposal: where it stands, and what was asked of
// it if it's being revised
function proposalSummary(proposal: _Proposal_Task_) {
  const last = proposal.rounds[proposal.rounds.length - 1] ?? proposal.rounds[0];
  return {
    proposal: proposal.id,
    document: proposal.document,
    state: proposal.state,
    ...(last.kind === "requested" ? { feedback: last.request.feedback.text } : {}),
  };
}

function scopeOf(task: _Task_Doctor_): Map<_Id_Document_, Array<_Id_Node_>> {
  const latest = task.brief.versions[task.brief.versions.length - 1] ?? task.brief.versions[0];
  const documents = new Map<_Id_Document_, Array<_Id_Node_>>();
  for (const ref of latest.scope) documents.set(ref.document, [...(documents.get(ref.document) ?? []), ref.node]);
  return documents;
}

// The agent's side of the endpoint: the active task, its documents as they
// are now, proposals for them, and handing the task back.
export async function serveAgent(
  place: _Place_Tasks_,
  caller: _Author_Doctor_,
  request: _Request_Endpoint_,
): Promise<_Answer_Endpoint_> {
  const route = `${request.method} ${request.path}`;
  const [task] = await activeTask(place);
  if (route === "GET /task") {
    if (task === undefined) return issues(404, ["there's no active task"]);
    const latest = task.brief.versions[task.brief.versions.length - 1] ?? task.brief.versions[0];
    const documents = await Promise.all(
      [...scopeOf(task)].map(async ([id, nodes]) => {
        const shown = await show(place, id);
        if (shown.kind === "refused") return { document: id, issues: shown.issues };
        const index = indexNodes(shown.value.document.content);
        const scope = nodes.flatMap((node): Array<_Node_Document_> => {
          const entry = index.get(node);
          return entry === undefined ? [] : [entry.node];
        });
        return { document: id, title: shown.value.document.content.title.text, base: shown.value.base, scope };
      }),
    );
    return answer(200, {
      task: task.id,
      state: task.state,
      instruction: latest.instruction.text,
      documents,
      proposals: task.proposals.map(proposalSummary),
    });
  }
  if (request.method === "GET" && request.path.startsWith("/document")) {
    const named = request.path.slice("/document/".length);
    const [fallback] = task === undefined ? [] : [...scopeOf(task).keys()];
    const id = parse(documentIdSchema, named === "" ? fallback : named);
    if (id.kind === "rejected") return issues(400, ["name a document, or have an active task with one in its scope"]);
    const shown = await show(place, id.value);
    if (shown.kind === "refused") return issues(404, shown.issues);
    return answer(200, { base: shown.value.base, document: shown.value.document });
  }
  if (route === "POST /propose") {
    if (task === undefined) return issues(404, ["there's no active task to propose for"]);
    const payload = parse(proposalPayloadSchema, request.body);
    if (payload.kind === "rejected") return issues(400, payload.issues);
    const outcome = await propose(place, task.id, payload.value, caller);
    if (outcome.kind === "refused") return issues(409, outcome.issues);
    return answer(200, { task: task.id, proposal: outcome.value, state: "proposed" });
  }
  if (route === "POST /submit") {
    if (task === undefined) return issues(404, ["there's no active task to submit"]);
    const outcome = await submit(place, task.id);
    if (outcome.kind === "refused") return issues(409, outcome.issues);
    return answer(200, { task: task.id, state: "reviewing" });
  }
  return issues(404, [`there's no route ${route}`]);
}
