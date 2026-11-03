import type { _Id_Proposal_, _Request_Task_, _Task_Doctor_, _Version_Brief_ } from "./domain.next.ts";

export const latestBrief = (task: _Task_Doctor_): _Version_Brief_ =>
  task.brief.versions[task.brief.versions.length - 1] ?? task.brief.versions[0];

// a task is named by its first request
export const nameOf = (task: _Task_Doctor_): string => latestBrief(task).requests[0].text.text;

// Where a request is, once its task's started: in progress till the agent
// hands the task over having seen it, then addressed, for good; a request
// isn't changed once it's made, only followed by others, or its proposals
// amended. A draft's are neither, as nothing's been asked yet.
export type _Progress_Request_ = "in progress" | "addressed";

export function progressOf(task: _Task_Doctor_, request: _Request_Task_): _Progress_Request_ {
  if (task.state === "draft") return "in progress";
  const [last] = task.submissions.slice(-1);
  const covered = last === undefined ? [] : task.brief.versions.filter((version) => version.number === last.answering);
  return covered.some((version) => version.requests.some((each) => each.id === request.id)) ? "addressed" : "in progress";
}

// the proposals made for a request, as each says what it answers, all but
// those withdrawn
export function proposalsFor(task: _Task_Doctor_, request: _Request_Task_): Array<_Id_Proposal_> {
  if (task.state === "draft") return [];
  return task.proposals.flatMap((proposal) => {
    const last = proposal.rounds[proposal.rounds.length - 1] ?? proposal.rounds[0];
    return proposal.state !== "withdrawn" && last.version.answers.includes(request.id) ? [proposal.id] : [];
  });
}
