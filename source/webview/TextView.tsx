import type { _Contrast_Mark_, _LINK_Mark__Text_, _Target_Link_, _Text_Doctor_ } from "../shared/domain.next.ts";
import { segmentsOf } from "../shared/text.ts";
import styles from "./styles/Text.module.css";

export interface _Segment_Render_ {
  text: string;
  contrast: Array<_Contrast_Mark_>;
}

export type _Group_Render_ = _PLAIN_Group__Render_ | _LINKED_Group__Render_;

interface __BASE_Group__Render_<__GroupKind__ extends string> {
  kind: __GroupKind__;
  segments: Array<_Segment_Render_>;
}

export interface _PLAIN_Group__Render_ extends __BASE_Group__Render_<"plain"> {}

export interface _LINKED_Group__Render_ extends __BASE_Group__Render_<"linked"> {
  target: _Target_Link_;
}

export const linkClass = styles.link;

export function contrastClass(segment: _Segment_Render_): string {
  return segment.contrast.map((contrast) => styles[contrast]).join(" ");
}

export function describeTarget(target: _Target_Link_): string {
  switch (target.kind) {
    case "external":
      return target.url;
    case "document":
      return `document ${target.document}`;
    case "node":
      return `node ${target.node} in document ${target.document}`;
  }
}

// the text's segments, with the ones under one link kept together
export function groupsOf(text: _Text_Doctor_): Array<_Group_Render_> {
  const characters = Array.from(text.text);
  const groups: Array<_Group_Render_> = [];
  let under: Array<_LINK_Mark__Text_> = [];
  for (const segment of segmentsOf(text)) {
    const piece: _Segment_Render_ = { text: characters.slice(segment.from, segment.to).join(""), contrast: segment.contrast };
    const [link] = segment.links;
    const last = groups.at(-1);
    if (last !== undefined && link === under[0]) {
      last.segments.push(piece);
      continue;
    }
    groups.push(
      link === undefined ? { kind: "plain", segments: [piece] } : { kind: "linked", target: link.target, segments: [piece] },
    );
    under = segment.links.slice(0, 1);
  }
  return groups;
}

function Segments({ segments }: { segments: Array<_Segment_Render_> }) {
  return (
    <>
      {segments.map((segment, index) => (
        <span key={index} className={contrastClass(segment)}>
          {segment.text}
        </span>
      ))}
    </>
  );
}

export function TextView({ text }: { text: _Text_Doctor_ }) {
  return (
    <>
      {groupsOf(text).map((group, index) =>
        group.kind === "plain" ? (
          <Segments key={index} segments={group.segments} />
        ) : (
          <span key={index} className={linkClass} title={describeTarget(group.target)}>
            <Segments segments={group.segments} />
          </span>
        ),
      )}
    </>
  );
}
