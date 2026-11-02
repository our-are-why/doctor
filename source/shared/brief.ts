import type { _Task_Doctor_, _Version_Brief_ } from "./domain.next.ts";

export const latestBrief = (task: _Task_Doctor_): _Version_Brief_ =>
  task.brief.versions[task.brief.versions.length - 1] ?? task.brief.versions[0];

// a task is named by its first request
export const nameOf = (task: _Task_Doctor_): string => latestBrief(task).requests[0].text.text;
