"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../../lib/api/client";

type CollectionRecord = {
  id: string;
  name: string;
  description?: string | null;
  paper_count?: number;
  count?: number;
};

type CollectionTreeNode = CollectionRecord & {
  parentId: string | null;
  children: CollectionTreeNode[];
};

function parseParentId(description: string | null | undefined): string | null {
  if (!description) {
    return null;
  }
  try {
    const parsed = JSON.parse(description) as { parentId?: string };
    return typeof parsed.parentId === "string" ? parsed.parentId : null;
  } catch {
    return description.startsWith("parent:") ? description.slice("parent:".length) : null;
  }
}

function buildTree(items: CollectionRecord[]): CollectionTreeNode[] {
  const nodes = items.map((item) => ({
    ...item,
    parentId: parseParentId(item.description),
    children: [] as CollectionTreeNode[]
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots: CollectionTreeNode[] = [];

  for (const node of nodes) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

type CollectionTreeProps = {
  onError?: (message: string | null) => void;
};

export function CollectionTree(props: CollectionTreeProps) {
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [newName, setNewName] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const [paperInputs, setPaperInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const response = await apiGet<{ collections?: CollectionRecord[]; items?: CollectionRecord[] }>(
      "/api/collections"
    );
    setCollections(response.collections ?? response.items ?? []);
  }, []);

  useEffect(() => {
    reload().catch((cause) => {
      props.onError?.(cause instanceof Error ? cause.message : "Collections request failed");
    });
  }, [props, reload]);

  const tree = useMemo(() => buildTree(collections), [collections]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) {
      return;
    }
    setBusy("create");
    props.onError?.(null);
    try {
      const description = parentId ? JSON.stringify({ parentId }) : undefined;
      await apiPost("/api/collections", { name, description });
      setNewName("");
      setParentId("");
      await reload();
    } catch (cause) {
      props.onError?.(cause instanceof Error ? cause.message : "Collection create failed");
    } finally {
      setBusy(null);
    }
  };

  const handleAddPaper = async (collectionId: string) => {
    const doi = (paperInputs[collectionId] ?? "").trim();
    if (!doi) {
      return;
    }
    setBusy(`add-${collectionId}`);
    props.onError?.(null);
    try {
      await apiPost(`/api/collections/${encodeURIComponent(collectionId)}/papers`, { doi });
      setPaperInputs((prev) => ({ ...prev, [collectionId]: "" }));
      await reload();
    } catch (cause) {
      props.onError?.(cause instanceof Error ? cause.message : "Add paper failed");
    } finally {
      setBusy(null);
    }
  };

  const handleRemovePaper = async (collectionId: string) => {
    const doi = (paperInputs[collectionId] ?? "").trim();
    if (!doi) {
      return;
    }
    setBusy(`remove-${collectionId}`);
    props.onError?.(null);
    try {
      await apiDelete(`/api/collections/${encodeURIComponent(collectionId)}/papers/${encodeURIComponent(doi)}`);
      setPaperInputs((prev) => ({ ...prev, [collectionId]: "" }));
      await reload();
    } catch (cause) {
      props.onError?.(cause instanceof Error ? cause.message : "Remove paper failed");
    } finally {
      setBusy(null);
    }
  };

  const renderNode = (node: CollectionTreeNode, depth = 0) => {
    const count = node.paper_count ?? node.count ?? 0;
    const isExpanded = expanded[node.id] ?? depth === 0;
    const hasChildren = node.children.length > 0;

    return (
      <li key={node.id} className="collection-tree-node">
        <div className="collection-tree-row" style={{ paddingLeft: depth * 14 }}>
          {hasChildren ? (
            <button
              type="button"
              className="collection-tree-toggle"
              aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
              onClick={() => setExpanded((prev) => ({ ...prev, [node.id]: !isExpanded }))}
            >
              {isExpanded ? "▾" : "▸"}
            </button>
          ) : (
            <span className="collection-tree-spacer" />
          )}
          <strong>{node.name}</strong>
          <span className="muted-small">{count} papers</span>
        </div>
        {isExpanded ? (
          <div className="collection-tree-body" style={{ paddingLeft: depth * 14 + 18 }}>
            <div className="row">
              <input
                value={paperInputs[node.id] ?? ""}
                onChange={(event) =>
                  setPaperInputs((prev) => ({ ...prev, [node.id]: event.target.value }))
                }
                placeholder="DOI to add/remove"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                disabled={busy === `add-${node.id}`}
                onClick={() => handleAddPaper(node.id)}
              >
                Add
              </button>
              <button
                type="button"
                disabled={busy === `remove-${node.id}`}
                onClick={() => handleRemovePaper(node.id)}
              >
                Remove
              </button>
            </div>
            {hasChildren ? (
              <ul className="collection-tree-list">
                {node.children.map((child) => renderNode(child, depth + 1))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <div className="collection-tree column">
      <form onSubmit={handleCreate} className="row">
        <input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          placeholder="New collection name"
          style={{ flex: 1 }}
        />
        <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
          <option value="">Root folder</option>
          {collections.map((collection) => (
            <option key={collection.id} value={collection.id}>
              Under: {collection.name}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy === "create"}>
          {busy === "create" ? "Creating..." : "Create"}
        </button>
      </form>
      {tree.length === 0 ? <p className="muted-small">No collections yet.</p> : null}
      <ul className="collection-tree-list">{tree.map((node) => renderNode(node))}</ul>
    </div>
  );
}
