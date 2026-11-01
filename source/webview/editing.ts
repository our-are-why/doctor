import { createContext } from "preact";
import type { _Id_Node_, _Text_Doctor_ } from "../shared/domain.next.ts";
import type { _Focus_Editor_, _Spot_Editor_ } from "./actions.ts";

// what an editable part of the document can ask of the editor
export interface _Editing_View_ {
  focus: _Focus_Editor_;
  retext: (spot: _Spot_Editor_, text: _Text_Doctor_) => void;
  split: (spot: _Spot_Editor_, text: _Text_Doctor_, offset: number) => void;
  backspace: (spot: _Spot_Editor_) => void;
  recode: (node: _Id_Node_, code: string) => void;
  leave: () => void;
}

const idle: _Editing_View_ = {
  focus: { kind: "keep" },
  retext: () => {},
  split: () => {},
  backspace: () => {},
  recode: () => {},
  leave: () => {},
};

export const EditingContext = createContext<_Editing_View_>(idle);
