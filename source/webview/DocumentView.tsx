import type { ComponentChildren } from "preact";
import type { _Block_Document_, _Document_Doctor_, _ListItem_Document_ } from "../shared/domain.ts";
import styles from "./styles/Document.module.css";
import { TextView } from "./TextView.tsx";

function Heading({ depth, children }: { depth: number; children: ComponentChildren }) {
  switch (Math.min(depth, 5)) {
    case 1:
      return <h2 className={styles.heading}>{children}</h2>;
    case 2:
      return <h3 className={styles.heading}>{children}</h3>;
    case 3:
      return <h4 className={styles.heading}>{children}</h4>;
    case 4:
      return <h5 className={styles.heading}>{children}</h5>;
    default:
      return <h6 className={styles.heading}>{children}</h6>;
  }
}

function ItemView({ item, depth }: { item: _ListItem_Document_; depth: number }) {
  return (
    <li>
      <TextView text={item.text} />
      <Blocks blocks={item.children} depth={depth} />
    </li>
  );
}

function BlockView({ block, depth }: { block: _Block_Document_; depth: number }) {
  switch (block.kind) {
    case "section":
      return (
        <section className={styles.section}>
          <Heading depth={depth}>
            <TextView text={block.heading} />
          </Heading>
          <Blocks blocks={block.children} depth={depth + 1} />
        </section>
      );
    case "paragraph":
      return (
        <p className={styles.paragraph}>
          <TextView text={block.text} />
        </p>
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
          <pre>
            <code>{block.code}</code>
          </pre>
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
      <h1 className={styles.title}>
        <TextView text={document.content.title} />
      </h1>
      <Blocks blocks={document.content.children} depth={1} />
    </article>
  );
}
