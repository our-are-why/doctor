import type { _Block_Document_, _Document_Doctor_, _ListItem_Document_ } from "../shared/domain.next.ts";
import { EditableCode } from "./EditableCode.tsx";
import { EditableText, type _Tag_Editable_ } from "./EditableText.tsx";
import styles from "./styles/Document.module.css";

const headingTags: Array<_Tag_Editable_> = ["h2", "h3", "h4", "h5", "h6"];

function ItemView({ item, depth }: { item: _ListItem_Document_; depth: number }) {
  return (
    <li>
      <EditableText spot={{ kind: "node", node: item.id }} text={item} tag="div" className="" placeholder="" />
      <Blocks blocks={item.children} depth={depth} />
    </li>
  );
}

function BlockView({ block, depth }: { block: _Block_Document_; depth: number }) {
  switch (block.kind) {
    case "section":
      return (
        <section className={styles.section}>
          <EditableText
            spot={{ kind: "node", node: block.id }}
            text={block.heading}
            tag={headingTags[Math.min(depth, headingTags.length) - 1] ?? "h6"}
            className={styles.heading}
            placeholder="Heading"
          />
          <Blocks blocks={block.children} depth={depth + 1} />
        </section>
      );
    case "paragraph":
      return (
        <EditableText
          spot={{ kind: "node", node: block.id }}
          text={block}
          tag="p"
          className={styles.paragraph}
          placeholder=""
        />
      );
    case "list": {
      const items = block.children.map((item) => <ItemView key={item.id} item={item} depth={depth} />);
      return block.order === "ordered" ? (
        <ol className={styles.list}>{items}</ol>
      ) : (
        <ul className={styles.list}>{items}</ul>
      );
    }
    case "code":
      return (
        <figure className={styles.code}>
          {block.language.kind === "stated" ? (
            <figcaption className={styles.language}>{block.language.name}</figcaption>
          ) : null}
          <EditableCode block={block} />
        </figure>
      );
    case "quote":
      return (
        <blockquote className={styles.quote}>
          <Blocks blocks={block.children} depth={depth} />
        </blockquote>
      );
  }
}

function Blocks({ blocks, depth }: { blocks: Array<_Block_Document_>; depth: number }) {
  return (
    <>
      {blocks.map((block) => (
        <BlockView key={block.id} block={block} depth={depth} />
      ))}
    </>
  );
}

export function DocumentView({ document }: { document: _Document_Doctor_ }) {
  return (
    <article className={styles.document}>
      <EditableText
        spot={{ kind: "title" }}
        text={document.content.title}
        tag="h1"
        className={styles.title}
        placeholder="Untitled"
      />
      {document.content.children.length === 0 ? (
        <p className={styles.hint}>Press Enter in the title to start writing.</p>
      ) : null}
      <Blocks blocks={document.content.children} depth={1} />
    </article>
  );
}
